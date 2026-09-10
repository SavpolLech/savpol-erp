// Zbiorczy import: bierze już zescrapowany CSV dla jednego dnia i wstawia
// WSZYSTKIE jego dokumenty do bazy (nie tylko jeden testowy jak
// test-insert-from-csv.js). Dokłada te same stałe wartości co scrape.js
// (lib/fixed-values.js) i ma tę samą ochronę przed duplikatem (sprawdza
// csDocsHeadersId w bazie przed insertem, jednym zapytaniem dla całej paczki).
//
// Uruchomienie: node import-csv-to-db.js 2026-08-03

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const F = require('./lib/fields');
const { mssqlType, coerceValue } = require('./lib/schema');
const { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES } = require('./lib/fixed-values');

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

async function findExistingHeaderIds(pool, headerIdCol, rows) {
  if (!rows.length) return new Set();
  const ids = rows.map(r => coerceValue(r.csDocsHeadersId, headerIdCol)).filter(v => v !== null);
  if (!ids.length) return new Set();
  const request = pool.request();
  const placeholders = ids.map((id, i) => { request.input('id' + i, mssqlType(headerIdCol), id); return '@id' + i; });
  const result = await request.query(
    'SELECT [csDocsHeadersId] AS id FROM dbo.' + F.TEST_TABLE_HEADERS + ' WHERE [csDocsHeadersId] IN (' + placeholders.join(', ') + ')'
  );
  return new Set(result.recordset.map(r => String(r.id)));
}

async function main() {
  const dateArg = process.argv[2];
  if (!dateArg) throw new Error('Podaj datę: node import-csv-to-db.js 2026-08-03');
  const label = dateArg + '_' + dateArg;

  const headersPath = path.join(__dirname, 'results-headers_' + label + '.csv');
  const positionsPath = path.join(__dirname, 'results-positions_' + label + '.csv');
  const headers = parseCsv(fs.readFileSync(headersPath, 'utf8'));
  const positions = parseCsv(fs.readFileSync(positionsPath, 'utf8'));
  console.log('[import] Wczytano z CSV: ' + headers.length + ' nagłówków, ' + positions.length + ' pozycji (' + dateArg + ').');

  headers.forEach(h => Object.assign(h, HEADER_FIXED_VALUES));
  positions.forEach(p => {
    Object.assign(p, POSITION_FIXED_VALUES);
    // createdDate = DocDate nagłówka — w CSV positions.csDocsHeadersId już
    // wiąże z headers.csDocsHeadersId, ale prościej wziąć z samego CSV pozycji
    // jeśli tam jest DocDate; inaczej dociągamy z mapy nagłówków.
  });
  const docDateByHeaderId = new Map(headers.map(h => [h.csDocsHeadersId, h.DocDate]));
  positions.forEach(p => { p.createdDate = docDateByHeaderId.get(p.csDocsHeadersId) || null; });

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });
  try {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema-test-tables.json'), 'utf8'));
    const headerIdCol = schema.headers.find(c => c.COLUMN_NAME === 'csDocsHeadersId');

    const existingIds = await findExistingHeaderIds(pool, headerIdCol, headers);
    const newHeaders = headers.filter(h => !existingIds.has(String(coerceValue(h.csDocsHeadersId, headerIdCol))));
    const newPositions = positions.filter(p => !existingIds.has(String(coerceValue(p.csDocsHeadersId, headerIdCol))));

    if (existingIds.size) {
      console.log('[import] Pominięto ' + existingIds.size + ' dokumentów już obecnych w bazie.');
    }

    console.log('[import] Wstawiam ' + newHeaders.length + ' nagłówków, ' + newPositions.length + ' pozycji...');
    const insertedHeaders = await insertRows(pool, F.TEST_TABLE_HEADERS, schema.headers, newHeaders);
    const insertedPositions = await insertRows(pool, F.TEST_TABLE_POSITIONS, schema.positions, newPositions);
    console.log('[import] SUKCES: ' + insertedHeaders + ' nagłówków, ' + insertedPositions + ' pozycji wstawionych do "' + DB_NAME + '".');
  } finally {
    await pool.close();
  }
}

main().catch(err => {
  console.error('[import] BŁĄD:', err.message);
  process.exit(1);
});
