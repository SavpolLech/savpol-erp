// Liczba nagłówków w bazie worek (dbo.csDocsHeaders) per typ i dzień DocDate —
// kolumna „w bazie” listy kontrolnej na stronie statusu. Tylko SELECT.
//
// Ręcznie (podgląd):  node status/liczniki-bazy.js 2026-10-01
//
// Brak .env / brak połączenia → null; strona wtedy pokazuje listę bez kolumny bazy.

const path = require('path');
// Zależności z wz/node_modules (jak kontrahenci/, produkty/ — bez osobnej instalacji).
const req = name => require(path.join(__dirname, '..', 'wz', 'node_modules', name));
req('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TYPY = {
  WZ: '213217939',
  MM: '269000798',
  PZ: '213217940',
  FA: '267302594',
  PAR: '218693742'
};
// MM „Do realizacji” scraper pomija od 2026-10-01 (starsze 37 zostały w tabeli —
// ROZBIEZNOSCI.md), więc nie liczymy ich do porównania z ERP.
const MM_DO_REALIZACJI = '213217726';

async function liczniki(od) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od)) throw new Error('zła data: ' + od);
  const sql = req('mssql');
  const pool = await new sql.ConnectionPool({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: process.env.DB_NAME || 'worek',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 60000
  }).connect();
  try {
    const ids = Object.values(TYPY).join(',');
    const rs = await pool.request().query(
      "SELECT CAST(csDocsTypesId AS varchar(20)) AS typ, CONVERT(char(10), DocDate, 23) AS dzien, COUNT(*) AS n " +
      'FROM dbo.csDocsHeaders WHERE csDocsTypesId IN (' + ids + ") AND DocDate >= '" + od + "' " +
      'AND NOT (csDocsTypesId = ' + TYPY.MM + ' AND csDocsHeadersStatusId = ' + MM_DO_REALIZACJI + ') ' +
      'GROUP BY csDocsTypesId, CONVERT(char(10), DocDate, 23)');
    const kod = Object.fromEntries(Object.entries(TYPY).map(([k, v]) => [v, k]));
    const out = {};
    for (const r of rs.recordset) out[kod[r.typ] + '|' + r.dzien] = r.n;
    return out;
  } finally {
    await pool.close();
  }
}

module.exports = { liczniki, TYPY };

if (require.main === module) {
  liczniki(process.argv[2] || '2026-07-01').then(o => {
    if (!o) return console.log('brak konfiguracji bazy (.env)');
    for (const k of Object.keys(o).sort()) console.log(k, o[k]);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
