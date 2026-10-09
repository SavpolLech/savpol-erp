// BRAKUJĄCE PRODUKTY — csItemsId, które występują na pozycjach dokumentów
// w worek (WZ, MM, PZ, FA, PAR…), a nie mają kartoteki w csItems. To jest ta
// sama lista, którą Michał dotąd przysyłał ręcznie do dobij-produkty-po-id.js
// (2026-09-29). Nowy towar wchodzi najpierw na PZ, więc jego karta dochodzi
// po pierwszym dokumencie, na którym się pojawi.
//
// Id, dla których scrape-po-id.js w ostatnich DNI_PRZERWY dniach nie znalazł
// karty (wpis bez „ok” w produkty/wynik/id-sku-mapa.csv), są pomijane — żeby
// beznadziejne przypadki nie zjadały codziennie czasu ERP. Ponowna próba po
// tym czasie.
//
// Użycie (podgląd, nic nie scrapuje):  node brakujace-produkty.js
// Orkiestrator woła listaBrakujacych() i przekazuje id do lib-wspolne/produkty-po-id.

const fs = require('fs');
const path = require('path');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, 'wz', 'node_modules', name)); }
}
const sql = req('mssql');
const dotenv = req('dotenv');

const PROD_DIR = path.join(__dirname, 'produkty');
const localEnv = path.join(PROD_DIR, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '.env') });

const MAPA_CSV = path.join(PROD_DIR, 'wynik', 'id-sku-mapa.csv');
const DNI_PRZERWY = parseInt(process.env.PRODUKTY_DNI_PRZERWY || '7', 10);

// id → true, jeśli ostatnio (DNI_PRZERWY) była nieudana próba i nie było sukcesu.
function niedawnoNieudane() {
  const wynik = new Set();
  let tekst = '';
  try { tekst = fs.readFileSync(MAPA_CSV, 'utf8'); } catch { return wynik; }
  const granica = new Date(Date.now() - DNI_PRZERWY * 86400000).toISOString().slice(0, 10);
  const ok = new Set();
  for (const linia of tekst.split(/\r?\n/).slice(1)) {
    const [id, , status, data] = linia.split(';');
    if (!id) continue;
    if (status === 'ok') ok.add(id);
    else if (data >= granica) wynik.add(id);
  }
  for (const id of ok) wynik.delete(id);
  return wynik;
}

async function listaBrakujacych() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: process.env.DB_NAME || 'worek',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 120000
  });
  try {
    const q = await pool.request().query(
      'SELECT CAST(p.csItemsId AS varchar(30)) AS id, COUNT(*) AS pozycji, ' +
      'CONVERT(varchar(10), MIN(h.DocDate), 120) AS pierwszy, CONVERT(varchar(10), MAX(h.DocDate), 120) AS ostatni ' +
      'FROM dbo.csDocsItemsPositions p JOIN dbo.csDocsHeaders h ON h.csDocsHeadersId = p.csDocsHeadersId ' +
      'WHERE p.csItemsId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.csItems i WHERE i.csItemsId = p.csItemsId) ' +
      'GROUP BY p.csItemsId ORDER BY MAX(h.DocDate) DESC'
    );
    const pomin = niedawnoNieudane();
    const wszystkie = q.recordset;
    return {
      wszystkie,
      doZrobienia: wszystkie.filter(w => !pomin.has(w.id)),
      pominiete: wszystkie.filter(w => pomin.has(w.id))
    };
  } finally {
    await pool.close();
  }
}

module.exports = { listaBrakujacych };

if (require.main === module) {
  // --zapisz=<plik> [--limit=N]: id do pobrania (najświeższe dokumenty najpierw)
  // do pliku dla scrape-po-id.js --plik=…; tak woła to orkiestrator.
  const zapisz = process.argv.find(a => a.startsWith('--zapisz='));
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : Infinity;
  listaBrakujacych().then(({ wszystkie, doZrobienia, pominiete }) => {
    if (zapisz) {
      const idy = doZrobienia.slice(0, limit).map(w => w.id);
      fs.mkdirSync(path.dirname(zapisz.slice('--zapisz='.length)), { recursive: true });
      fs.writeFileSync(zapisz.slice('--zapisz='.length), idy.join('\n') + (idy.length ? '\n' : ''), 'utf8');
      console.log(`[brakujące produkty] w worek: ${wszystkie.length}, pominięte (nieudane < ${DNI_PRZERWY} dni): ${pominiete.length}, w tym biegu: ${idy.length}`);
      return;
    }
    console.log(`Brakujące kartoteki (na dokumentach, nie ma w csItems): ${wszystkie.length}`);
    console.log(`  do pobrania: ${doZrobienia.length}, pominięte (nieudane w ostatnich ${DNI_PRZERWY} dniach): ${pominiete.length}`);
    for (const w of wszystkie.slice(0, 40)) {
      console.log(`  ${w.id}  pozycji: ${w.pozycji}  dokumenty ${w.pierwszy}..${w.ostatni}${pominiete.includes(w) ? '  (pominięte)' : ''}`);
    }
    if (wszystkie.length > 40) console.log(`  … i ${wszystkie.length - 40} więcej`);
  }).catch((e) => { console.error('BŁĄD:', e.message); process.exit(1); });
}
