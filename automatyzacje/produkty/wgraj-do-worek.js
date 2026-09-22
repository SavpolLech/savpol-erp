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
// Uruchomienie: node wgraj-do-worek.js [SKU...] [--realne]
// Bez argumentów bierze wszystkie pliki wynik/results-produkt_*.json.
// Flaga --realne: pisz do PRAWDZIWEJ dbo.csItems (bez _test) — Michał,
// 2026-09-22, potwierdził że dane są dobre. Bez tej flagi — domyślnie,
// bezpiecznie — nadal csItems_test.

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

const { fetchColumnsMeta, buildCreateTableSQL, mssqlType, coerceValue } =
  require(path.join(__dirname, '..', 'wz', 'lib', 'schema'));
const F = require('./lib/fields');
const { ITEMS_FIXED_VALUES, ITEMS_SQL_NOW_COLUMNS, ITEMS_FIXED_FIELDS } = require('./lib/fixed-values');

const REALNE = process.argv.includes('--realne');
const TEST_TABLE = REALNE ? F.PROD_TABLE : 'csItems_test';
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

async function insertRows(pool, columnsMeta, fixedColumnsMeta, rows) {
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
    // Kolumny od Michała (2026-09-14), których API karty nie zwraca w
    // ogóle — stałe wartości / SYSDATETIME() liczone w SQL, patrz
    // lib/fixed-values.js.
    fixedColumnsMeta.forEach((col, i) => {
      colNames.push('[' + col.COLUMN_NAME + ']');
      if (ITEMS_SQL_NOW_COLUMNS.includes(col.COLUMN_NAME)) {
        paramNames.push('SYSDATETIME()');
      } else {
        const paramName = 'f' + i;
        request.input(paramName, mssqlType(col), ITEMS_FIXED_VALUES[col.COLUMN_NAME]);
        paramNames.push('@' + paramName);
      }
    });
    await request.query(
      'INSERT INTO dbo.' + TEST_TABLE + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')'
    );
    inserted++;
  }
  return inserted;
}

async function main() {
  const skuFilter = process.argv.slice(2).filter(a => !a.startsWith('--'));
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

    // Kolumny od Michała, których nie ma na liście DOPASOWANE (bo API ich
    // nie zwraca) — pobieramy metadane osobno.
    const { found: fixedFound, missing: fixedMissing } = await fetchColumnsMeta(pool, 'dbo', TEST_TABLE, ITEMS_FIXED_FIELDS);
    if (fixedMissing.length) {
      console.warn('[wgraj] UWAGA: nie znalazłem w dbo.' + TEST_TABLE + ': ' + fixedMissing.join(', '));
    }
    const fixedColumnsMeta = fixedFound.filter(c => !c.IS_COMPUTED);

    const wstawione = await insertRows(pool, columnsMeta, fixedColumnsMeta, nowe);
    console.log('[wgraj] SUKCES: wstawiono ' + wstawione + ' produktów do dbo.' + TEST_TABLE + ' w bazie "' + database + '".');

    // Wiersze już wcześniej wgrane (przed dodaniem tych 5 kolumn do
    // insertu) — dopełniamy je teraz, żeby nie zostały z NULL-ami. Warunek
    // "createdDate IS NULL" chroni przed nadpisywaniem daty utworzenia przy
    // każdym kolejnym uruchomieniu tego skryptu.
    if (fixedColumnsMeta.length) {
      const setClauses = fixedColumnsMeta.map(col =>
        '[' + col.COLUMN_NAME + '] = ' + (ITEMS_SQL_NOW_COLUMNS.includes(col.COLUMN_NAME) ? 'SYSDATETIME()' : ITEMS_FIXED_VALUES[col.COLUMN_NAME])
      );
      const upd = await pool.request().query(
        'UPDATE dbo.' + TEST_TABLE + ' SET ' + setClauses.join(', ') + ' WHERE createdDate IS NULL'
      );
      if (upd.rowsAffected[0]) {
        console.log('[wgraj] Dopełniono ' + upd.rowsAffected[0] + ' wcześniej wgranych wierszy (DefSort/IsPhoto/IsPhotoPrev/daty).');
      }
    }
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj] BŁĄD:', err.message); process.exit(1); });
