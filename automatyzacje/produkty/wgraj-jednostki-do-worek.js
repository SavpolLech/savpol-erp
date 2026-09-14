// Wgrywa zescrapowane jednostki (csItemsUnits) i kody kreskowe per jednostka
// (csItemsBarCodes) z JSON-ów w wynik/ do bazy "worek", tabel TESTOWYCH
// dbo.csItemsUnits_test / dbo.csItemsBarCodes_test — ten sam wzorzec co
// wgraj-do-worek.js / wgraj-zdjecia-do-worek.js (typy kolumn 1:1 z realnymi
// tabelami, dedup po kluczu głównym, insert dopiero po utworzeniu tabeli
// jeśli jeszcze nie istnieje).
//
// Michał, 2026-09-14: obie listy kolumn (68 dla csItemsUnits, 9 dla
// csItemsBarCodes) pasują 1:1 do pól zwracanych przez API — zero
// niedopasowanych, w przeciwieństwie do csItems.
//
// Uruchomienie: node wgraj-jednostki-do-worek.js [SKU...]
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

const { fetchColumnsMeta, mssqlType, coerceValue } =
  require(path.join(__dirname, '..', 'wz', 'lib', 'schema'));
const F = require('./lib/fields');

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

// Wspólna logika dla obu tabel (jednostki i kody kreskowe) — różnią się
// tylko nazwą tabeli, listą kolumn i kluczem głównym do dedupu.
async function wgrajTabele(pool, database, { realTable, testTable, dopasowaneCols, idCol, rekordy }) {
  if (!rekordy.length) { console.log('[wgraj-jednostki] Brak rekordów dla ' + testTable + ' — pomijam.'); return; }

  const { found, missing } = await fetchColumnsMeta(pool, 'dbo', realTable, dopasowaneCols);
  if (missing.length) console.warn('[wgraj-jednostki] Nie znalazłem w dbo.' + realTable + ': ' + missing.join(', '));
  const columnsMeta = found.filter(c => !c.IS_COMPUTED);

  const istnieje = await pool.request().query(
    "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + testTable + "'"
  );
  if (istnieje.recordset[0].n === 0) {
    const lines = columnsMeta.map(c => {
      let t = c.DATA_TYPE;
      if (t === 'nvarchar' || t === 'varchar') t += '(' + (c.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : c.CHARACTER_MAXIMUM_LENGTH) + ')';
      else if (t === 'decimal' || t === 'numeric') t += '(' + (c.NUMERIC_PRECISION || 18) + ',' + (c.NUMERIC_SCALE || 4) + ')';
      return '  [' + c.COLUMN_NAME + '] ' + t + ' NULL';
    });
    await pool.request().query('CREATE TABLE dbo.' + testTable + ' (\n' + lines.join(',\n') + '\n);');
    console.log('[wgraj-jednostki] Utworzono dbo.' + testTable + ' (' + columnsMeta.length + ' kolumn).');
  } else {
    console.log('[wgraj-jednostki] Tabela dbo.' + testTable + ' już istnieje — wstawiam do niej.');
  }

  const idColMeta = columnsMeta.find(c => c.COLUMN_NAME === idCol);
  let existing = new Set();
  if (idColMeta) {
    const ids = rekordy.map(r => coerceValue(r[idCol] && r[idCol].Item !== undefined ? r[idCol].Item : r[idCol], idColMeta)).filter(v => v !== null);
    if (ids.length) {
      const req2 = pool.request();
      const placeholders = ids.map((id, i) => { req2.input('id' + i, mssqlType(idColMeta), id); return '@id' + i; });
      const exist = await req2.query(
        'SELECT [' + idCol + '] AS id FROM dbo.' + testTable + ' WHERE [' + idCol + '] IN (' + placeholders.join(', ') + ')'
      );
      existing = new Set(exist.recordset.map(r => String(r.id)));
    }
  }

  let wstawione = 0, pominiete = 0;
  for (const r of rekordy) {
    const surowaWartosc = (k) => (r[k] && typeof r[k] === 'object' && 'Item' in r[k]) ? r[k].Item : r[k];
    if (idColMeta && existing.has(String(surowaWartosc(idCol)))) { pominiete++; continue; }
    const request = pool.request();
    const colNames = [];
    const paramNames = [];
    columnsMeta.forEach((col, i) => {
      const paramName = 'p' + i;
      let value = coerceValue(surowaWartosc(col.COLUMN_NAME), col);
      // Sterownik mssql/tedious ma błąd przy NUMERIC_SCALE = 16 dokładnie
      // (potwierdzone: 6..15 działa, 16 zawsze "could not be validated",
      // niezależnie od wartości — bug w bibliotece, nie w naszych danych).
      // csItemsUnits ma kilka kolumn typu numeric(28,16) (np. QuantityInUnit)
      // — ograniczamy zadeklarowaną skalę do 15, zero realnej utraty
      // precyzji dla naszych danych (nikt nie potrzebuje 16 miejsc po
      // przecinku przy wadze/ilości).
      let typ = mssqlType(col);
      if ((col.DATA_TYPE === 'decimal' || col.DATA_TYPE === 'numeric') && col.NUMERIC_SCALE >= 16) {
        typ = sql.Decimal(col.NUMERIC_PRECISION || 18, 15);
      }
      if ((col.DATA_TYPE === 'decimal' || col.DATA_TYPE === 'numeric') && typeof value === 'number') {
        value = Number(value.toFixed(Math.min(col.NUMERIC_SCALE || 4, 15)));
      }
      try {
        request.input(paramName, typ, value);
      } catch (e) {
        console.error('[wgraj-jednostki] BŁĄD walidacji kolumny ' + col.COLUMN_NAME +
          ' (typ ' + col.DATA_TYPE + '), surowa wartość=' + JSON.stringify(surowaWartosc(col.COLUMN_NAME)) +
          ', po coerceValue=' + JSON.stringify(value) + ', rekord=' + JSON.stringify(r).slice(0, 300));
        throw e;
      }
      colNames.push('[' + col.COLUMN_NAME + ']');
      paramNames.push('@' + paramName);
    });
    try {
      await request.query('INSERT INTO dbo.' + testTable + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')');
    } catch (e) {
      console.error('[wgraj-jednostki] BŁĄD INSERT dla rekordu: ' + JSON.stringify(r).slice(0, 500));
      throw e;
    }
    wstawione++;
  }
  if (pominiete) console.log('[wgraj-jednostki] ' + testTable + ': pominięto ' + pominiete + ' już obecnych.');
  console.log('[wgraj-jednostki] SUKCES: wstawiono ' + wstawione + ' do dbo.' + testTable + ' w bazie "' + database + '".');
}

async function main() {
  const skuFilter = process.argv.slice(2);
  const produkty = loadResults(skuFilter);
  const wszystkieJednostki = [];
  const wszystkieEan = [];
  produkty.forEach(p => {
    (p.jednostki || []).forEach(j => wszystkieJednostki.push(j));
    (p.kodyKreskowe || []).forEach(k => wszystkieEan.push(k));
  });
  console.log('[wgraj-jednostki] Znaleziono ' + wszystkieJednostki.length + ' jednostek i ' +
    wszystkieEan.length + ' kodów EAN z ' + produkty.length + ' produktów.');

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const database = process.env.DB_NAME || 'worek';
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });

  try {
    await wgrajTabele(pool, database, {
      realTable: F.JEDNOSTKI_TABLE, testTable: F.JEDNOSTKI_TABLE + '_test',
      dopasowaneCols: F.DOPASOWANE_JEDNOSTKI, idCol: 'csItemsUnitsId', rekordy: wszystkieJednostki
    });
    await wgrajTabele(pool, database, {
      realTable: F.EAN_TABLE, testTable: F.EAN_TABLE + '_test',
      dopasowaneCols: F.DOPASOWANE_EAN, idCol: 'csItemsBarCodesId', rekordy: wszystkieEan
    });
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj-jednostki] BŁĄD:', err.message); process.exit(1); });
