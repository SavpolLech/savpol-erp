// Jednorazowa pomoc: łączy się do konkretnej bazy (domyślnie "worek") i
// wypisuje wszystkie tabele + ich kolumny, żeby sprawdzić, czy coś już tam
// pasuje pod dane WZ. Nic nie zmienia, tylko czyta INFORMATION_SCHEMA.
//
// Uruchomienie: node list-tables.js [nazwa_bazy]
// (bez argumentu bierze "worek")

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w .env — uzupełnij automatyzacje/wz/.env');
  }

  const database = process.argv[2] || 'worek';

  const config = {
    server: DB_HOST,
    port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER,
    password: DB_PASSWORD,
    database,
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15000
  };

  console.log('[db] Łączę z bazą "' + database + '" na ' + DB_HOST + ':' + config.port + ' jako ' + DB_USER + ' ...');
  const pool = await sql.connect(config);

  const tables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);

  if (tables.recordset.length === 0) {
    console.log('[db] Baza "' + database + '" jest pusta — brak tabel.');
    await pool.close();
    return;
  }

  console.log('[db] Tabele w "' + database + '" (' + tables.recordset.length + '):');
  for (const t of tables.recordset) {
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${t.TABLE_SCHEMA}' AND TABLE_NAME = '${t.TABLE_NAME}'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('\n  === ' + t.TABLE_SCHEMA + '.' + t.TABLE_NAME + ' ===');
    cols.recordset.forEach(c => {
      console.log('    ' + c.COLUMN_NAME + ' : ' + c.DATA_TYPE + (c.IS_NULLABLE === 'NO' ? ' NOT NULL' : ''));
    });
  }

  await pool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
