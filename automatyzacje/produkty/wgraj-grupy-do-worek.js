// Wgrywa zescrapowane grupy produktowe (csItemsGroupsItems) z JSON-ów w
// wynik/ do bazy "worek", tabeli TESTOWEJ dbo.csItemsGroupsItems_test —
// ten sam wzorzec co wgraj-jednostki-do-worek.js (typy 1:1 z realną
// tabelą, dedup po kluczu głównym, ograniczenie skali decimal do 15 —
// bug sterownika mssql/tedious na NUMERIC_SCALE=16, patrz komentarz niżej).
//
// Michał, 2026-09-18: poprosił o grupy produktowe przypisane do produktu,
// bez listy kolumn (był w wyjeździe) — tylko nazwa tabeli docelowej,
// csItemsGroupsItems. Namierzone samodzielnie: zakładka "Grupy" na karcie,
// 15/15 kolumn realnej tabeli pasuje 1:1 po nazwie do API.
//
// Uruchomienie: node wgraj-grupy-do-worek.js [SKU...]
// Bez argumentów bierze wszystkie pliki wynik/results-produkt_*.json.

const path = require('path');
const fs = require('fs');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const sql = req('mssql');
const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const { fetchColumnsMeta, mssqlType, coerceValue } =
  require(path.join(__dirname, '..', 'wz', 'lib', 'schema'));
const F = require('./lib/fields');

const TEST_TABLE = F.GRUPY_TABLE + '_test';
const OUT_DIR = path.join(__dirname, 'wynik');

function loadResults(skuFilter) {
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('results-produkt_') && f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const dane = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    if (skuFilter && skuFilter.length && !skuFilter.includes(String(dane.sku))) continue;
    out.push(dane);
  }
  return out;
}

async function main() {
  const skuFilter = process.argv.slice(2);
  const produkty = loadResults(skuFilter);
  const wszystkieGrupy = [];
  produkty.forEach(p => (p.grupy || []).forEach(g => wszystkieGrupy.push(g)));
  if (!wszystkieGrupy.length) throw new Error('Brak grup do wgrania w ' + OUT_DIR + ' (uruchom najpierw scrape.js z aktualną wersją, która zbiera grupy).');
  console.log('[wgraj-grupy] Znaleziono ' + wszystkieGrupy.length + ' grup z ' + produkty.length + ' produktów.');

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const database = process.env.DB_NAME || 'worek';
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });

  try {
    const { found, missing } = await fetchColumnsMeta(pool, 'dbo', F.GRUPY_TABLE, F.DOPASOWANE_GRUPY);
    if (missing.length) console.warn('[wgraj-grupy] Nie znalazłem w dbo.' + F.GRUPY_TABLE + ': ' + missing.join(', '));
    const columnsMeta = found.filter(c => !c.IS_COMPUTED);

    const istnieje = await pool.request().query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + TEST_TABLE + "'"
    );
    if (istnieje.recordset[0].n === 0) {
      const lines = columnsMeta.map(c => {
        let t = c.DATA_TYPE;
        if (t === 'nvarchar' || t === 'varchar') t += '(' + (c.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : c.CHARACTER_MAXIMUM_LENGTH) + ')';
        else if (t === 'decimal' || t === 'numeric') t += '(' + (c.NUMERIC_PRECISION || 18) + ',' + Math.min(c.NUMERIC_SCALE || 4, 15) + ')';
        return '  [' + c.COLUMN_NAME + '] ' + t + ' NULL';
      });
      await pool.request().query('CREATE TABLE dbo.' + TEST_TABLE + ' (\n' + lines.join(',\n') + '\n);');
      console.log('[wgraj-grupy] Utworzono dbo.' + TEST_TABLE + ' (' + columnsMeta.length + ' kolumn).');
    } else {
      console.log('[wgraj-grupy] Tabela dbo.' + TEST_TABLE + ' już istnieje — wstawiam do niej.');
    }

    const idColMeta = columnsMeta.find(c => c.COLUMN_NAME === 'csItemsGroupsItemsId');
    let existing = new Set();
    if (idColMeta) {
      const ids = wszystkieGrupy.map(g => coerceValue(g.csItemsGroupsItemsId, idColMeta)).filter(v => v !== null);
      if (ids.length) {
        const req2 = pool.request();
        const placeholders = ids.map((id, i) => { req2.input('id' + i, mssqlType(idColMeta), id); return '@id' + i; });
        const exist = await req2.query(
          'SELECT [csItemsGroupsItemsId] AS id FROM dbo.' + TEST_TABLE + ' WHERE [csItemsGroupsItemsId] IN (' + placeholders.join(', ') + ')'
        );
        existing = new Set(exist.recordset.map(r => String(r.id)));
      }
    }
    const nowe = wszystkieGrupy.filter(g => !existing.has(String(g.csItemsGroupsItemsId)));
    if (existing.size) console.log('[wgraj-grupy] Pominięto ' + existing.size + ' już obecnych.');

    let wstawione = 0;
    for (const g of nowe) {
      const request = pool.request();
      const colNames = [];
      const paramNames = [];
      columnsMeta.forEach((col, i) => {
        const paramName = 'p' + i;
        let value = coerceValue(g[col.COLUMN_NAME], col);
        // Bug sterownika mssql/tedious: sql.Decimal(precyzja, 16) rzuca
        // "could not be validated" niezależnie od wartości (potwierdzone
        // przy wgraj-jednostki-do-worek.js) — ograniczamy skalę do 15.
        if ((col.DATA_TYPE === 'decimal' || col.DATA_TYPE === 'numeric') && col.NUMERIC_SCALE >= 16) {
          request.input(paramName, sql.Decimal(col.NUMERIC_PRECISION || 18, 15),
            typeof value === 'number' ? Number(value.toFixed(15)) : value);
        } else {
          if ((col.DATA_TYPE === 'decimal' || col.DATA_TYPE === 'numeric') && typeof value === 'number') {
            value = Number(value.toFixed(Math.min(col.NUMERIC_SCALE || 4, 15)));
          }
          request.input(paramName, mssqlType(col), value);
        }
        colNames.push('[' + col.COLUMN_NAME + ']');
        paramNames.push('@' + paramName);
      });
      await request.query('INSERT INTO dbo.' + TEST_TABLE + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')');
      wstawione++;
    }
    console.log('[wgraj-grupy] SUKCES: wstawiono ' + wstawione + ' grup do dbo.' + TEST_TABLE + ' w bazie "' + database + '".');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj-grupy] BŁĄD:', err.message); process.exit(1); });
