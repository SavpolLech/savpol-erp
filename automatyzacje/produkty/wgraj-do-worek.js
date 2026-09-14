// Wgrywa zescrapowane produkty (JSON z wynik/) do bazy "worek", TABELI
// TESTOWEJ (dbo.csItems_test) — analogicznie do automatyzacje/wz, które też
// pisze do csDocsHeaders_test/csDocsItemsPositions_test, nie do prawdziwych
// tabel. Powód: worek jest replikowana pod migrację do Odoo — nie chcemy
// wstawiać testowych/scrapowanych danych do tabeli, którą kiedyś wypełni
// właściwa synchronizacja produkcyjna.
//
// Kolumny i typy biorą wzorzec z RZECZYWISTEJ dbo.csItems (INFORMATION_SCHEMA),
// więc csItems_test ma dokładnie te typy, co produkcja — tylko ograniczone do
// pól z listy DOPASOWANE (te, które faktycznie umiemy wypełnić ze scrapera).
//
// Uruchomienie: node wgraj-do-worek.js [SKU...]
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
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', 'wz', '.env') });

const { fetchColumnsMeta, buildCreateTableSQL, mssqlType, coerceValue } =
  require(path.join(__dirname, '..', 'wz', 'lib', 'schema'));
const F = require('./lib/fields');

const TEST_TABLE = 'csItems_test';
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

async function insertRows(pool, columnsMeta, rows) {
  let inserted = 0;
  for (const row of rows) {
    const request = pool.request();
    const colNames = [];
    const paramNames = [];
    columnsMeta.forEach((col, i) => {
      const paramName = 'p' + i;
      const value = coerceValue(row.dopasowane[col.COLUMN_NAME], col);
      request.input(paramName, mssqlType(col), value);
      colNames.push('[' + col.COLUMN_NAME + ']');
      paramNames.push('@' + paramName);
    });
    await request.query(
      'INSERT INTO dbo.' + TEST_TABLE + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')'
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  const skuFilter = process.argv.slice(2);
  const results = loadResults(skuFilter);
  if (!results.length) throw new Error('Brak wyników do wgrania w ' + OUT_DIR + ' (uruchom najpierw scrape.js).');
  console.log('[wgraj] Znaleziono ' + results.length + ' zescrapowanych produktów do wgrania: ' +
    results.map(r => r.sku).join(', '));

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const database = process.env.DB_NAME || 'worek';
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });

  try {
    // 1. Tabela testowa: jeśli już istnieje (np. zbudowana przez inną sesję —
    // tak było tu, wątek scrapera ją stworzył z WSZYSTKICH 141 kolumn
    // dbo.csItems, nie tylko DOPASOWANE), bierzemy metadane z NIEJ, żeby nie
    // rozjeżdżać się z tym, co już istnieje. Tworzymy od zera tylko, gdy
    // faktycznie jeszcze nie istnieje.
    const istnieje = await pool.request().query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + TEST_TABLE + "'"
    );
    let columnsMeta;
    if (istnieje.recordset[0].n > 0) {
      const { found, missing } = await fetchColumnsMeta(pool, 'dbo', TEST_TABLE, F.DOPASOWANE);
      if (missing.length) {
        console.warn('[wgraj] UWAGA: ' + missing.length + ' kolumn z DOPASOWANE nie ma w istniejącej dbo.' +
          TEST_TABLE + ' — pomijam je: ' + missing.join(', '));
      }
      columnsMeta = found.filter(c => !c.IS_COMPUTED);
      console.log('[wgraj] Tabela dbo.' + TEST_TABLE + ' już istnieje — wstawiam do niej (' +
        columnsMeta.length + '/' + F.DOPASOWANE.length + ' kolumn z DOPASOWANE znaleziono).');
    } else {
      const { found, missing } = await fetchColumnsMeta(pool, 'dbo', F.PROD_TABLE, F.DOPASOWANE);
      if (missing.length) {
        console.warn('[wgraj] UWAGA: ' + missing.length + ' kolumn z DOPASOWANE nie znalazłem w dbo.' +
          F.PROD_TABLE + ' — pomijam je: ' + missing.join(', '));
      }
      columnsMeta = found.filter(c => !c.IS_COMPUTED);
      const createSql = buildCreateTableSQL(TEST_TABLE, columnsMeta);
      await pool.request().query(createSql);
      console.log('[wgraj] Tabela dbo.' + TEST_TABLE + ' utworzona (' + columnsMeta.length + ' kolumn).');
    }

    // 3. Pomijamy duplikaty po csItemsId, jeśli tabela już coś ma z wcześniejszych przebiegów.
    const idCol = columnsMeta.find(c => c.COLUMN_NAME === 'csItemsId');
    let existing = new Set();
    if (idCol) {
      const ids = results.map(r => coerceValue(r.dopasowane.csItemsId, idCol)).filter(v => v !== null);
      if (ids.length) {
        const req2 = pool.request();
        const placeholders = ids.map((id, i) => { req2.input('id' + i, mssqlType(idCol), id); return '@id' + i; });
        const exist = await req2.query(
          'SELECT [csItemsId] AS id FROM dbo.' + TEST_TABLE + ' WHERE [csItemsId] IN (' + placeholders.join(', ') + ')'
        );
        existing = new Set(exist.recordset.map(r => String(r.id)));
      }
    }
    const nowe = results.filter(r => !existing.has(String(r.dopasowane.csItemsId)));
    if (existing.size) console.log('[wgraj] Pominięto ' + existing.size + ' już obecnych (ten sam csItemsId).');

    const wstawione = await insertRows(pool, columnsMeta, nowe);
    console.log('[wgraj] SUKCES: wstawiono ' + wstawione + ' produktów do dbo.' + TEST_TABLE + ' w bazie "' + database + '".');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj] BŁĄD:', err.message); process.exit(1); });
