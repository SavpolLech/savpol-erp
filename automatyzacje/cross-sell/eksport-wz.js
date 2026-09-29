// Eksport koszyków WZ z bazy "worek" dla bazy powiązań cross-sell (repo esavpol-pdp,
// tools/pdp-generator/scripts/baza-powiazan/wz.mjs). Zastępuje scrapowanie historii faktur
// per SKU w savpol-historia-faktur.user.js: worek to replika ERP (WZ ciągłe od 01.2024, od
// 25.07.2026 dosypuje je automatyzacje/wz), więc wszystkie koszyki są w jednym zapytaniu.
//
// TYLKO ODCZYT (SELECT). Dane klientów nie wychodzą z tego skryptu: klient = kolejny numer
// nadany w tym przebiegu (k1, k2, …), bez ID z ERP; zostaje tylko flaga sieci/marketu.
//
// Wyjście (kontrakt z wz.mjs):
//   <plik>.tsv         — linia "# klucz=wartość …" (metadane), potem: dok \t klient \t siec \t sku
//                        dok = kolejny numer dokumentu, siec = 1 dla grup ODB\FRANCZYZA\* i ODB\MARKETY\*
//   <plik>.nazwy.json  — { sku: nazwa z ERP } dla produktów z koszyków
//
// Uruchomienie: node eksport-wz.js [plik.tsv] [--miesiecy=24]
// Domyślny plik: %TEMP%/baza-powiazan/koszyki-wz.tsv (katalog roboczy odswiez.mjs).
const path = require('path');
const fs = require('fs');
const os = require('os');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const sql = req('mssql');
req('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const WZ_TYPE = 213217939; // csDocsTypesId dokumentów WZ (sprawdzone 2026-09-28: 2026/WZ/…)
const arg = (n) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const MIESIECY = parseInt(arg('miesiecy') || '24', 10);
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ||
  path.join(os.tmpdir(), 'baza-powiazan', 'koszyki-wz.tsv');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

(async () => {
  const e = process.env;
  const pool = await sql.connect({
    server: e.DB_HOST, port: parseInt(e.DB_PORT || '1433', 10), user: e.DB_USER, password: e.DB_PASSWORD,
    database: 'worek', options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 0,
  });
  // Okno kroczące; DocDate <= dziś, bo w replice są też dokumenty z datą w przyszłości.
  const WHERE = `h.csDocsTypesId=${WZ_TYPE} AND h.DocDate>=DATEADD(month,-${MIESIECY},CAST(GETDATE() AS date)) AND h.DocDate<=CAST(GETDATE() AS date)`;

  const siecRows = (await pool.request().query(`SELECT DISTINCT gc.csCustomersId c FROM dbo.csCustomersGroupsCustomers gc
    JOIN dbo.csCustomersGroups g ON g.csCustomersGroupsId=gc.csCustomersGroupsId
    WHERE g.CustomersGroup LIKE 'ODB_FRANCZYZA%' OR g.CustomersGroup LIKE 'ODB_MARKETY%'`)).recordset;
  const siec = new Set(siecRows.map((r) => String(r.c)));
  if (siec.size < 100) throw new Error('tylko ' + siec.size + ' klientów sieci/marketów — zmienione nazwy grup w ERP?');

  const tmp = OUT + '.part';
  const out = fs.createWriteStream(tmp);
  const dokNr = new Map(), klNr = new Map(), skus = new Set();
  let n = 0, od = null, do_ = null;
  await new Promise((resolve, reject) => {
    const r = pool.request(); r.stream = true;
    r.query(`SELECT h.csDocsHeadersId d, h.csCustomersId c, CONVERT(char(10),h.DocDate,120) dt, RTRIM(i.Item) s
      FROM dbo.csDocsHeaders h JOIN dbo.csDocsItemsPositions p ON p.csDocsHeadersId=h.csDocsHeadersId
      JOIN dbo.csItems i ON i.csItemsId=p.csItemsId WHERE ${WHERE}`);
    r.on('row', (x) => {
      const c = String(x.c);
      if (!dokNr.has(x.d)) dokNr.set(x.d, dokNr.size + 1);
      if (!klNr.has(c)) klNr.set(c, klNr.size + 1);
      skus.add(x.s);
      if (!od || x.dt < od) od = x.dt;
      if (!do_ || x.dt > do_) do_ = x.dt;
      const ok = out.write(dokNr.get(x.d) + '\t' + 'k' + klNr.get(c) + '\t' + (siec.has(c) ? 1 : 0) + '\t' + x.s + '\n');
      if (!ok) { r.pause(); out.once('drain', () => r.resume()); }
      n++;
    });
    r.on('error', reject);
    r.on('done', resolve);
  });
  await new Promise((r) => out.end(r));
  if (dokNr.size < 100000) throw new Error('tylko ' + dokNr.size + ' dokumentów WZ — plik bez zmian');

  const nazwy = {};
  const lista = [...skus];
  for (let i = 0; i < lista.length; i += 1000) {
    const rq = pool.request();
    const ph = lista.slice(i, i + 1000).map((s, j) => { rq.input('s' + j, sql.VarChar(40), s); return '@s' + j; });
    for (const row of (await rq.query(`SELECT RTRIM(Item) s, ItemDesc n FROM dbo.csItems WHERE Item IN (${ph.join(',')})`)).recordset) nazwy[row.s] = row.n;
  }
  await pool.close();

  const meta = `# zrodlo=worek typ=WZ od=${od} do=${do_} miesiecy=${MIESIECY} dok=${dokNr.size} klientow=${klNr.size} pozycji=${n} wygenerowano=${new Date().toISOString()}\n`;
  fs.writeFileSync(OUT, meta);
  fs.appendFileSync(OUT, fs.readFileSync(tmp));
  fs.unlinkSync(tmp);
  fs.writeFileSync(OUT.replace(/\.tsv$/, '') + '.nazwy.json', JSON.stringify(nazwy));
  console.log(meta.trim());
  console.log('zapisano ' + OUT);
})().catch((x) => { console.error('BLAD', x.message); process.exit(1); });
