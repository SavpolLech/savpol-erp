// Czyta metadane kolumn (typ, długość, precyzja) z INFORMATION_SCHEMA —
// TYLKO ODCZYT schematu, żadnych danych. Używane, żeby wiedzieć jak
// poprawnie stworzyć tabele testowe i jak typować parametry przy INSERT,
// zamiast zgadywać typy pole po polu ręcznie w kodzie.

const sql = require('mssql');

async function fetchColumnsMeta(pool, tableSchema, tableName, wantedFields) {
  // INFORMATION_SCHEMA nie mówi, czy kolumna jest WYLICZANA (computed) —
  // takich nie da się wprost wstawić przez INSERT (SQL Server liczy je sam).
  // Dołączamy sys.columns.is_computed, żeby scrape.js mógł je pominąć.
  const result = await pool.request()
    .input('schema', sql.NVarChar, tableSchema)
    .input('table', sql.NVarChar, tableName)
    .query(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE,
             sc.is_computed AS IS_COMPUTED
      FROM INFORMATION_SCHEMA.COLUMNS c
      JOIN sys.columns sc ON sc.object_id = OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME) AND sc.name = c.COLUMN_NAME
      WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
    `);
  const byName = new Map(result.recordset.map(r => [r.COLUMN_NAME, r]));
  const found = [];
  const missing = [];
  wantedFields.forEach(f => {
    if (byName.has(f)) found.push(byName.get(f));
    else missing.push(f);
  });
  return { found, missing };
}

function ddlType(col) {
  const t = col.DATA_TYPE;
  switch (t) {
    case 'varchar': case 'nvarchar': case 'char': case 'nchar': {
      const len = col.CHARACTER_MAXIMUM_LENGTH;
      return t + '(' + (len === -1 ? 'MAX' : len) + ')';
    }
    case 'decimal': case 'numeric':
      return t + '(' + col.NUMERIC_PRECISION + ',' + col.NUMERIC_SCALE + ')';
    default:
      return t;
  }
}

function buildCreateTableSQL(targetTable, columns) {
  const lines = columns.map(c => '  [' + c.COLUMN_NAME + '] ' + ddlType(c) + ' NULL');
  return `IF OBJECT_ID('dbo.${targetTable}', 'U') IS NULL\nCREATE TABLE dbo.${targetTable} (\n${lines.join(',\n')}\n);`;
}

// mssql (tedious) sql.* typ na podstawie DATA_TYPE z INFORMATION_SCHEMA —
// potrzebne do poprawnie otypowanego INSERT-a (zamiast wysyłać wszystko jako
// string i liczyć na niejawną konwersję).
function mssqlType(col) {
  switch (col.DATA_TYPE) {
    case 'int': return sql.Int;
    case 'bigint': return sql.BigInt;
    case 'smallint': return sql.SmallInt;
    case 'tinyint': return sql.TinyInt;
    case 'bit': return sql.Bit;
    case 'decimal': case 'numeric': return sql.Decimal(col.NUMERIC_PRECISION || 18, col.NUMERIC_SCALE || 4);
    case 'float': return sql.Float;
    case 'real': return sql.Real;
    case 'money': return sql.Money;
    case 'smallmoney': return sql.SmallMoney;
    case 'date': return sql.Date;
    case 'datetime': return sql.DateTime;
    case 'datetime2': return sql.DateTime2;
    case 'smalldatetime': return sql.SmallDateTime;
    case 'uniqueidentifier': return sql.UniqueIdentifier;
    case 'nvarchar': return sql.NVarChar(col.CHARACTER_MAXIMUM_LENGTH === -1 ? sql.MAX : col.CHARACTER_MAXIMUM_LENGTH);
    case 'varchar': return sql.VarChar(col.CHARACTER_MAXIMUM_LENGTH === -1 ? sql.MAX : col.CHARACTER_MAXIMUM_LENGTH);
    case 'nchar': return sql.NChar(col.CHARACTER_MAXIMUM_LENGTH);
    case 'char': return sql.Char(col.CHARACTER_MAXIMUM_LENGTH);
    default: return sql.NVarChar(sql.MAX); // bezpieczny fallback zamiast wywalenia się na nieznanym typie
  }
}

// Surowy string ze scrapowania (np. "29 949 305 133", "1 066,80", "2026-08-03")
// -> właściwa wartość JS pod dany typ kolumny. Puste/brak -> null (nie "" ani 0
// — puste pole ma zostać NULL w bazie, nie fałszywym zerem).
function coerceValue(raw, col) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  switch (col.DATA_TYPE) {
    case 'int': case 'bigint': case 'smallint': case 'tinyint': {
      const n = parseInt(s.replace(/[\s ]/g, ''), 10);
      return isNaN(n) ? null : n;
    }
    case 'decimal': case 'numeric': case 'float': case 'real': case 'money': case 'smallmoney': {
      const n = parseFloat(s.replace(/[\s ]/g, '').replace(',', '.'));
      return isNaN(n) ? null : n;
    }
    case 'bit':
      return (s === '1' || s.toLowerCase() === 'true') ? 1 : 0;
    case 'date': case 'datetime': case 'datetime2': case 'smalldatetime': {
      // ERP daje np. "2026-08-03 00:00:00" albo samo "2026-08-03".
      const datePart = s.split(' ')[0];
      const d = new Date(datePart);
      return isNaN(d.getTime()) ? null : d;
    }
    default:
      return s;
  }
}

module.exports = { fetchColumnsMeta, ddlType, buildCreateTableSQL, mssqlType, coerceValue };
