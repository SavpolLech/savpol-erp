// Jednorazowa pomoc: pobiera pełną listę kolumn tabeli dbo.csItems z bazy
// "worek" i porównuje z automatyzacje/produkty/info/kolumny.txt (lista od
// Michała), żeby sprawdzić, czy to dosłownie ta sama tabela.
//
// Uruchomienie: node sprawdz-csitems.js [nazwa_bazy]

require('dotenv').config();
const sql = require('mssql');
const fs = require('fs');
const path = require('path');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
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

  console.log('[db] Łączę z bazą "' + database + '" ...');
  const pool = await sql.connect(config);

  const cols = await pool.request().query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'csItems'
    ORDER BY ORDINAL_POSITION
  `);

  console.log('[db] dbo.csItems ma ' + cols.recordset.length + ' kolumn.');

  const kolumnyPath = path.join(__dirname, '..', 'produkty', 'info', 'kolumny.txt');
  const kolumnyRaw = fs.readFileSync(kolumnyPath, 'utf8');
  const michalCols = [...kolumnyRaw.matchAll(/^\s*\[([A-Za-z0-9_]+)\]/gm)].map(m => m[1]);
  const dbColsSet = new Set(cols.recordset.map(c => c.COLUMN_NAME));

  const brakujace = michalCols.filter(c => !dbColsSet.has(c));
  console.log('\n[cmp] Kolumn od Michała: ' + michalCols.length);
  console.log('[cmp] Z tego NIE znaleziono w dbo.csItems: ' + brakujace.length);
  if (brakujace.length) console.log('  ' + brakujace.join(', '));

  const michalSet = new Set(michalCols);
  const dodatkowe = cols.recordset.filter(c => !michalSet.has(c.COLUMN_NAME));
  console.log('\n[cmp] Kolumn w dbo.csItems, których NIE ma na liście Michała: ' + dodatkowe.length);

  await pool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
