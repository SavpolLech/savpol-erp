// Jednorazowa pomoc: sprawdza w bazie "worek", czy istnieje tabela
// podobna do csPhotos, oraz jak wygląda aktualna tabela produktów (kolumny
// dotyczące zdjęć: Photo, PhotoSmall, PhotoVersion, PhotoSmallVersion,
// IsPhoto, IsPhotoPrev). Nic nie zmienia, tylko czyta INFORMATION_SCHEMA.
//
// Uruchomienie: node sprawdz-tabele-foto.js [nazwa_bazy]
// (bez argumentu bierze "worek")

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w .env');
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

  console.log('[db] Łączę z bazą "' + database + '" na ' + DB_HOST + ':' + config.port + ' ...');
  const pool = await sql.connect(config);

  // 1. Tabele, które mogą dotyczyć zdjęć.
  const photoTables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE '%photo%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  console.log('\n[1] Tabele z "photo" w nazwie: ' + photoTables.recordset.length);
  for (const t of photoTables.recordset) {
    console.log('  - ' + t.TABLE_SCHEMA + '.' + t.TABLE_NAME);
  }

  // 2. Tabele, które mogą dotyczyć produktów/csItems.
  const itemTables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' AND (TABLE_NAME LIKE '%item%' OR TABLE_NAME LIKE '%produkt%')
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  console.log('\n[2] Tabele z "item"/"produkt" w nazwie: ' + itemTables.recordset.length);
  for (const t of itemTables.recordset) {
    console.log('  - ' + t.TABLE_SCHEMA + '.' + t.TABLE_NAME);
  }

  // 3. Kolumny dotyczące zdjęć w KAŻDEJ tabeli (nie tylko produktowej) —
  // żeby zobaczyć, czy Photo/PhotoSmall/PhotoVersion siedzą gdzieś w ogóle.
  const photoCols = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE COLUMN_NAME LIKE '%hoto%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
  `);
  console.log('\n[3] Kolumny z "hoto" w nazwie (w całej bazie): ' + photoCols.recordset.length);
  for (const c of photoCols.recordset) {
    console.log('  - ' + c.TABLE_SCHEMA + '.' + c.TABLE_NAME + '.' + c.COLUMN_NAME + ' (' + c.DATA_TYPE + ')');
  }

  await pool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
