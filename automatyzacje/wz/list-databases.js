// Jednorazowa pomoc: łączy się do serwera MSSQL (bez wskazanej konkretnej
// bazy — DB_NAME może być puste) i wypisuje wszystkie bazy, do których ten
// login ma dostęp. Nie zapisuje nic, tylko czyta sys.databases.
//
// Uruchomienie: node list-databases.js

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
    throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w .env — uzupełnij automatyzacje/wz/.env');
  }

  const config = {
    server: DB_HOST,
    port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER,
    password: DB_PASSWORD,
    // Bez "database" — łączymy się na poziomie serwera, żeby zobaczyć WSZYSTKIE
    // bazy dostępne temu loginowi, a nie tylko jedną konkretną.
    options: {
      encrypt: true,               // Azure SQL / nowsze MSSQL tego wymagają
      trustServerCertificate: true // wewnętrzny serwer, zwykle bez zaufanego CA
    },
    connectionTimeout: 15000
  };

  console.log('[db] Łączę z', DB_HOST + ':' + config.port, 'jako', DB_USER, '...');
  const pool = await sql.connect(config);

  const result = await pool.request().query(`
    SELECT name, database_id, create_date, state_desc
    FROM sys.databases
    ORDER BY name
  `);

  console.log('[db] Bazy widoczne dla tego loginu:');
  result.recordset.forEach(r => {
    console.log('  - ' + r.name + '  (state=' + r.state_desc + ', utworzona=' + r.create_date.toISOString().slice(0, 10) + ')');
  });

  await pool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  console.error('Jeśli to błąd uprawnień/loginu nie mającego dostępu do sys.databases na poziomie');
  console.error('serwera, spytaj IT wprost o nazwę bazy — ten sposób nie zawsze zadziała, zależy');
  console.error('od uprawnień konta.');
  process.exit(1);
});
