// Jednorazowy test: bierze JEDEN już zescrapowany dokument z istniejącego
// CSV (nie wymaga żywej sesji przeglądarki/ERP), dokłada stałe wartości
// (lib/fixed-values.js) i próbuje go naprawdę wstawić do bazy testowej.
// Sprawdza, czy poprawka od Michała faktycznie odblokowała zapis.
//
// Uruchomienie: node test-insert-from-csv.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const F = require('./lib/fields');
const { mssqlType, coerceValue } = require('./lib/schema');
const { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES } = require('./lib/fixed-values');

// Prosty parser CSV zgodny z appendCsv() w scrape.js (średnik, cudzysłów
// tylko gdy trzeba, podwojony cudzysłów jako ucieczka).
function parseCsv(text) {
  const lines = text.split('\n').filter(l => l.length > 0);
  const parseLine = (line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ';') { cells.push(cur); cur = ''; }
        else cur += c;
      }
    }
    cells.push(cur);
    return cells;
  };
  const cols = parseLine(lines[0]);
  return lines.slice(1).map(l => {
    const vals = parseLine(l);
    const rec = {};
    cols.forEach((c, i) => { rec[c] = vals[i]; });
    return rec;
  });
}

async function insertRows(pool, tableName, columnsMeta, rows) {
  if (!rows.length) return 0;
  const insertableColumns = columnsMeta.filter(c => !c.IS_COMPUTED);
  let inserted = 0;
  for (const row of rows) {
    const request = pool.request();
    const colNames = [];
    const paramNames = [];
    insertableColumns.forEach((col, i) => {
      const paramName = 'p' + i;
      const value = coerceValue(row[col.COLUMN_NAME], col);
      request.input(paramName, mssqlType(col), value);
      colNames.push('[' + col.COLUMN_NAME + ']');
      paramNames.push('@' + paramName);
    });
    await request.query(
      'INSERT INTO dbo.' + tableName + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')'
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  const headersCsv = parseCsv(fs.readFileSync(path.join(__dirname, 'results-headers_2026-08-03_2026-08-03.csv'), 'utf8'));
  const positionsCsv = parseCsv(fs.readFileSync(path.join(__dirname, 'results-positions_2026-08-03_2026-08-03.csv'), 'utf8'));

  const header = headersCsv[0];
  const positions = positionsCsv.filter(p => p.csDocsHeadersId === header.csDocsHeadersId);

  console.log('[test] Testowy dokument:', header.DocNumber, '| csDocsHeadersId:', header.csDocsHeadersId, '| pozycji:', positions.length);

  // Te same stałe co w scrape.js.
  Object.assign(header, HEADER_FIXED_VALUES);
  positions.forEach(p => {
    Object.assign(p, POSITION_FIXED_VALUES);
    p.createdDate = header.DocDate;
  });

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  const pool = await sql.connect(config);
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema-test-tables.json'), 'utf8'));

    // Sprawdź, czy ten dokument już tam jest (np. z poprzedniego testu) —
    // żeby nie próbować wstawić duplikatu i dostać mylący błąd klucza.
    const headerIdCol = schema.headers.find(c => c.COLUMN_NAME === 'csDocsHeadersId');
    const check = await pool.request()
      .input('id', mssqlType(headerIdCol), coerceValue(header.csDocsHeadersId, headerIdCol))
      .query('SELECT COUNT(*) AS n FROM dbo.' + F.TEST_TABLE_HEADERS + ' WHERE csDocsHeadersId = @id');
    if (check.recordset[0].n > 0) {
      console.log('[test] Ten dokument już jest w bazie (z poprzedniego testu) — pomijam insert, to i tak potwierdza że działa.');
      return;
    }

    const insertedHeaders = await insertRows(pool, F.TEST_TABLE_HEADERS, schema.headers, [header]);
    const insertedPositions = await insertRows(pool, F.TEST_TABLE_POSITIONS, schema.positions, positions);
    console.log('[test] SUKCES: wstawiono', insertedHeaders, 'nagłówek,', insertedPositions, 'pozycji do "' + DB_NAME + '".');
  } finally {
    await pool.close();
  }
}

main().catch(err => {
  console.error('[test] BŁĄD:', err.message);
  process.exit(1);
});
