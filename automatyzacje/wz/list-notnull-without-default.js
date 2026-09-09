// Jednorazowa pomoc: listuje kolumny NOT NULL bez wartości domyślnej w
// tabelach testowych (te, których NIE wypełniamy przy scrapowaniu WZ) —
// to one blokują INSERT, bo SQL Server wymaga dla nich wartości, a my ich
// nie mamy z ERP. Tylko odczyt, nic nie zmienia.
//
// Uruchomienie: node list-notnull-without-default.js [nazwa_tabeli]
// (bez argumentu sprawdza obie: csDocsHeaders_test i csDocsItemsPositions_test)

require('dotenv').config();
const sql = require('mssql');
const F = require('./lib/fields');

async function checkTable(pool, tableName, ourFields) {
  const result = await pool.request()
    .input('table', sql.NVarChar, tableName)
    .query(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = 'dbo' AND c.TABLE_NAME = @table
        AND c.IS_NULLABLE = 'NO'
        AND NOT EXISTS (
          SELECT 1 FROM sys.default_constraints dc
          JOIN sys.columns sc ON sc.object_id = dc.parent_object_id AND sc.column_id = dc.parent_column_id
          WHERE dc.parent_object_id = OBJECT_ID('dbo.' + @table) AND sc.name = c.COLUMN_NAME
        )
        AND NOT EXISTS (
          SELECT 1 FROM sys.columns sc2
          WHERE sc2.object_id = OBJECT_ID('dbo.' + @table) AND sc2.name = c.COLUMN_NAME AND sc2.is_computed = 1
        )
      ORDER BY c.COLUMN_NAME
    `);

  const blocking = result.recordset.filter(r => !ourFields.includes(r.COLUMN_NAME));
  console.log('\n=== ' + tableName + ' ===');
  console.log('NOT NULL bez defaultu, spoza naszej listy pól (blokują INSERT): ' + blocking.length);
  blocking.forEach(r => console.log('  ' + r.COLUMN_NAME + ' : ' + r.DATA_TYPE));
}

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  const pool = await sql.connect(config);

  const headerFieldsAll = F.HEADER_FIELDS.concat(F.HEADER_FIELDS_FROM_FIRST_POSITION, F.HEADER_FIXED_FIELDS);
  const positionFieldsAll = F.POSITION_FIELDS.concat(F.POSITION_FIXED_FIELDS);
  await checkTable(pool, F.TEST_TABLE_HEADERS, headerFieldsAll);
  await checkTable(pool, F.TEST_TABLE_POSITIONS, positionFieldsAll);

  await pool.close();
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
