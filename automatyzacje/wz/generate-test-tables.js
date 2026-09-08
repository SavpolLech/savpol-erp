// Tabele dbo.csDocsHeaders_test / dbo.csDocsItemsPositions_test w DB_NAME
// (worek) już ISTNIEJĄ — stworzył je Michał, pełny schemat 1:1 z cs06.
// Ten skrypt NIC nie tworzy — czyta z nich prawdziwe typy kolumn
// (INFORMATION_SCHEMA na worek, nie na cs06 — tam ten login nie ma dostępu
// i nie musi mieć), ogranicza do pól z lib/fields.js i zapisuje
// schema-test-tables.json, którym scrape.js typuje INSERT.
//
// Uruchomienie: node generate-test-tables.js

require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');
const { fetchColumnsMeta } = require('./lib/schema');
const F = require('./lib/fields');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w .env');
  }
  if (!DB_NAME) {
    throw new Error('Brak DB_NAME w .env (np. worek).');
  }

  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  console.log('[schema] Czytam typy kolumn z "' + DB_NAME + '" (tabele testowe Michała)...');
  const pool = await sql.connect(config);

  const headerFieldsAll = F.HEADER_FIELDS.concat(F.HEADER_FIELDS_FROM_FIRST_POSITION);
  const headers = await fetchColumnsMeta(pool, 'dbo', F.TEST_TABLE_HEADERS, headerFieldsAll);
  const positions = await fetchColumnsMeta(pool, 'dbo', F.TEST_TABLE_POSITIONS, F.POSITION_FIELDS);

  await pool.close();

  if (headers.missing.length) {
    console.warn('[schema] UWAGA: brak w ' + F.TEST_TABLE_HEADERS + ': ' + headers.missing.join(', '));
  }
  if (positions.missing.length) {
    console.warn('[schema] UWAGA: brak w ' + F.TEST_TABLE_POSITIONS + ': ' + positions.missing.join(', '));
  }
  console.log('[schema] Nagłówek: ' + headers.found.length + '/' + headerFieldsAll.length + ' pól znalezionych.');
  console.log('[schema] Pozycje: ' + positions.found.length + '/' + F.POSITION_FIELDS.length + ' pól znalezionych.');

  fs.writeFileSync(path.join(__dirname, 'schema-test-tables.json'), JSON.stringify({
    headers: headers.found,
    positions: positions.found
  }, null, 2), 'utf8');
  console.log('[schema] Zapisano schema-test-tables.json (typy z prawdziwych tabel testowych w "' + DB_NAME + '").');
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
