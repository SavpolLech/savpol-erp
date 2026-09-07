// Czyta PRAWDZIWE typy kolumn z żywej bazy ERP (cs06 — TYLKO ODCZYT
// INFORMATION_SCHEMA, żadnych danych) dla dbo.csDocsHeaders i
// dbo.csDocsItemsPositions, ogranicza do pól z mapowania (mapowanie-pol.md,
// lib/fields.js) i generuje CREATE TABLE pod tabele testowe w DB_NAME —
// żeby nie zgadywać typów kolumn ręcznie.
//
// Uruchomienie: node generate-test-tables.js
//   - domyślnie tylko WYPISUJE wygenerowane CREATE TABLE (nic nie tworzy)
//   - z flagą --apply faktycznie tworzy tabele w DB_NAME (CREATE TABLE IF NOT EXISTS)
//
// Zapisuje też schema-test-tables.json — metadane kolumn używane przez
// scrape.js do poprawnego typowania INSERT-a.

require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { fetchColumnsMeta, buildCreateTableSQL } = require('./lib/schema');
const F = require('./lib/fields');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w .env');
  }
  if (!DB_NAME) {
    throw new Error('Brak DB_NAME w .env — ustaw docelową bazę (np. worek) przed generowaniem tabel.');
  }

  const apply = process.argv.includes('--apply');

  const srcConfig = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: 'cs06',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  console.log('[schema] Czytam typy kolumn z cs06 (tylko INFORMATION_SCHEMA, bez danych)...');
  const srcPool = await sql.connect(srcConfig);

  const headers = await fetchColumnsMeta(srcPool, 'dbo', F.PROD_TABLE_HEADERS, F.HEADER_FIELDS);
  const positions = await fetchColumnsMeta(srcPool, 'dbo', F.PROD_TABLE_POSITIONS, F.POSITION_FIELDS);
  const fromPositions = await fetchColumnsMeta(srcPool, 'dbo', F.PROD_TABLE_POSITIONS, F.HEADER_FIELDS_FROM_FIRST_POSITION);

  await srcPool.close();

  const headerColumnsFinal = headers.found.concat(fromPositions.found);
  const positionColumnsFinal = positions.found;

  console.log('[schema] Nagłówek: ' + headers.found.length + '/' + F.HEADER_FIELDS.length + ' wprost' +
    (headers.missing.length ? ' (brak w cs06: ' + headers.missing.join(', ') + ')' : '') +
    ' + ' + fromPositions.found.length + '/' + F.HEADER_FIELDS_FROM_FIRST_POSITION.length + ' z pozycji' +
    (fromPositions.missing.length ? ' (brak w cs06: ' + fromPositions.missing.join(', ') + ')' : ''));
  console.log('[schema] Pozycje: ' + positions.found.length + '/' + F.POSITION_FIELDS.length +
    (positions.missing.length ? ', brak w cs06: ' + positions.missing.join(', ') : ''));

  const ddlHeader = buildCreateTableSQL(F.TEST_TABLE_HEADERS, headerColumnsFinal);
  const ddlPositions = buildCreateTableSQL(F.TEST_TABLE_POSITIONS, positionColumnsFinal);

  fs.writeFileSync(path.join(__dirname, 'schema-test-tables.sql'), ddlHeader + '\n\n' + ddlPositions + '\n', 'utf8');
  fs.writeFileSync(path.join(__dirname, 'schema-test-tables.json'), JSON.stringify({
    headers: headerColumnsFinal,
    positions: positionColumnsFinal
  }, null, 2), 'utf8');
  console.log('[schema] Zapisano schema-test-tables.sql i schema-test-tables.json');
  console.log('\n' + ddlHeader + '\n\n' + ddlPositions + '\n');

  if (!apply) {
    console.log('[schema] Tryb podglądu (bez --apply) — NIC nie utworzono w bazie "' + DB_NAME + '".');
    return;
  }

  const dstConfig = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  console.log('[schema] Tworzę tabele w bazie "' + DB_NAME + '"...');
  const dstPool = await sql.connect(dstConfig);
  await dstPool.request().query(ddlHeader);
  await dstPool.request().query(ddlPositions);
  console.log('[schema] Gotowe — dbo.' + F.TEST_TABLE_HEADERS + ' i dbo.' + F.TEST_TABLE_POSITIONS +
    ' utworzone (jeśli jeszcze nie istniały) w "' + DB_NAME + '".');
  await dstPool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
