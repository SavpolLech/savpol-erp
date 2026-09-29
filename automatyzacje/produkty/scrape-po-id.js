// Scrapuje produkty wskazane po csItemsId (identyfikator bazodanowy), nie po
// SKU — tak przysyła je Michał (produkty z WZ, których brakuje w csItems).
//
// Katalog ERP nie wyszukuje po csItemsId (filtr csItemsFilter ma tylko
// SearchText), a feed GMC ani tabele pomocnicze w worek nie mają pary
// id↔SKU dla tych produktów. Dlatego:
//   1. nazwę produktu bierzemy z pozycji WZ w worek (csDocsItemsPositions.
//      PositionDesc — tam te id występują, bo właśnie z WZ wynika brak),
//   2. szukamy w katalogu po nazwie i wiersz wybieramy po csItemsId
//      z przechwyconej odpowiedzi API siatki — NIE po nazwie, bo pod jedną
//      nazwą bywa kilka kartotek (podstawowa + dodatkowe -R/-S),
//   3. mając SKU, scrapujemy kartę zwykłym scrapeOneProduct w tej samej
//      sesji, więc wynik/ i wgraj-*.js działają bez zmian.
//
// Uruchomienie:
//   node scrape-po-id.js 30290482005 30190004991 ...
//   node scrape-po-id.js --plik=lista-id.txt      (id rozdzielone białymi znakami/przecinkami)
// Id, dla których w wynik/ jest już JSON z tym csItemsId, są pomijane.
// Mapa id→SKU (z statusem) dopisywana do wynik/id-sku-mapa.csv.

const path = require('path');
const fs = require('fs');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const sql = req('mssql');
const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const { login, CATALOG_URL, HEADLESS, decodeJsonResult, extractCardRecord, scrapeOneProduct } = require('./scrape');

const OUT_DIR = path.join(__dirname, 'wynik');
const MAPA_CSV = path.join(OUT_DIR, 'id-sku-mapa.csv');

function wczytajIdy() {
  const args = process.argv.slice(2);
  const plikArg = args.find(a => a.startsWith('--plik='));
  const surowe = plikArg
    ? fs.readFileSync(plikArg.slice('--plik='.length).replace(/^"|"$/g, ''), 'utf8')
    : args.filter(a => !a.startsWith('--')).join(' ');
  return Array.from(new Set(surowe.split(/[\s,;]+/).filter(s => /^\d+$/.test(s))));
}

function juzZescrapowaneIdy() {
  const idy = new Set();
  if (!fs.existsSync(OUT_DIR)) return idy;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.startsWith('results-produkt_') || !f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
      if (d.dopasowane && d.dopasowane.csItemsId) idy.add(String(d.dopasowane.csItemsId));
    } catch (e) { /* uszkodzony plik — nie blokuje */ }
  }
  return idy;
}

async function nazwyZWorek(idy) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: process.env.DB_NAME || 'worek',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 120000
  });
  try {
    const r = pool.request();
    const ph = idy.map((id, i) => { r.input('id' + i, sql.BigInt, id); return '@id' + i; });
    const q = await r.query(
      'SELECT CAST(csItemsId AS varchar(30)) AS id, PositionDesc AS nazwa, COUNT(*) AS n FROM dbo.csDocsItemsPositions ' +
      'WHERE csItemsId IN (' + ph.join(',') + ') AND PositionDesc IS NOT NULL GROUP BY csItemsId, PositionDesc ORDER BY n DESC'
    );
    const mapa = new Map();
    for (const w of q.recordset) {
      if (!mapa.has(w.id)) mapa.set(w.id, []);
      mapa.get(w.id).push(w.nazwa.trim());
    }
    return mapa;
  } finally {
    await pool.close();
  }
}

// Kolejne, coraz krótsze frazy — pełna nazwa, bez końcowego "(kod)", pierwsze
// 4 słowa. Wyszukiwarka ERP bywa wrażliwa na znaki specjalne w długiej nazwie.
function frazyDlaNazw(nazwy) {
  const frazy = [];
  for (const n of nazwy) {
    frazy.push(n);
    const bezNawiasu = n.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (bezNawiasu !== n) frazy.push(bezNawiasu);
    const krotka = bezNawiasu.split(/\s+/).slice(0, 4).join(' ');
    if (krotka !== bezNawiasu) frazy.push(krotka);
  }
  return Array.from(new Set(frazy.filter(f => f.length >= 3)));
}

async function wyszukajWKatalogu(page, fraza) {
  await page.evaluate(async (t) => {
    const w = Array.from(document.querySelectorAll('.csDBEditSearch')).filter(x => x.offsetParent !== null)[0];
    const input = w && w.querySelector('input.Input');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
  }, fraza);
}

async function znajdzSkuPoId(page, captured, id, nazwy) {
  for (const fraza of frazyDlaNazw(nazwy)) {
    captured.length = 0;
    await wyszukajWKatalogu(page, fraza);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(300);
      for (const c of captured) {
        const r = c.records.find(x => String(x.csItemsId) === id);
        if (r && r.Item) return { sku: String(r.Item), fraza };
      }
    }
  }
  return null;
}

function dopiszMape(id, sku, status) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!fs.existsSync(MAPA_CSV)) fs.writeFileSync(MAPA_CSV, 'csItemsId;sku;status;data\n', 'utf8');
  fs.appendFileSync(MAPA_CSV, [id, sku || '', status, new Date().toISOString().slice(0, 10)].join(';') + '\n', 'utf8');
}

async function main() {
  const wszystkie = wczytajIdy();
  if (!wszystkie.length) throw new Error('Podaj id jako argumenty albo --plik=<ścieżka>.');
  const zrobione = juzZescrapowaneIdy();
  const idy = wszystkie.filter(id => !zrobione.has(id));
  console.log('[start] ' + wszystkie.length + ' id, ' + (wszystkie.length - idy.length) + ' już w wynik/ — do zrobienia ' + idy.length + '.');
  if (!idy.length) return;

  const nazwy = await nazwyZWorek(idy);
  const bezNazwy = idy.filter(id => !nazwy.has(id));
  if (bezNazwy.length) console.warn('[worek] Brak nazwy w csDocsItemsPositions dla: ' + bezNazwy.join(', '));

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', err => console.error('[błąd strony]', err.message));
  const captured = [];
  page.on('response', async (resp) => {
    try {
      if (resp.request().method() !== 'POST') return;
      const ct = (resp.headers()['content-type'] || '');
      if (ct && !/json|text/i.test(ct)) return;
      const body = await resp.text();
      if (!body || body.indexOf('JSONResult') === -1) return;
      const decoded = decodeJsonResult(body);
      if (!decoded) return;
      const rec = extractCardRecord(decoded);
      if (rec && rec.records.length) captured.push(rec);
    } catch (e) { /* nieczytelne — pomijamy */ }
  });

  const start = Date.now();
  let ok = 0;
  const nieudane = [];
  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    console.log('[katalog] Załadowany.');

    for (const id of idy) {
      if (!nazwy.has(id)) { dopiszMape(id, '', 'brak nazwy w worek'); nieudane.push(id); continue; }
      const trafienie = await znajdzSkuPoId(page, captured, id, nazwy.get(id));
      if (!trafienie) {
        console.warn('[id] ' + id + ': nie znalazłem w katalogu (nazwa: ' + nazwy.get(id)[0] + ')');
        dopiszMape(id, '', 'nie znaleziono w katalogu');
        nieudane.push(id);
        continue;
      }
      console.log('[id] ' + id + ' → SKU ' + trafienie.sku);
      if (await scrapeOneProduct(page, captured, trafienie.sku)) {
        ok++;
        dopiszMape(id, trafienie.sku, 'ok');
      } else {
        dopiszMape(id, trafienie.sku, 'znaleziono SKU, scrape karty nieudany');
        nieudane.push(id);
      }
    }
  } finally {
    await browser.close();
  }
  console.log('\n[koniec] Zescrapowano ' + ok + '/' + idy.length + ' w ' + ((Date.now() - start) / 1000).toFixed(0) + ' s.');
  if (nieudane.length) console.log('[koniec] Nieudane (' + nieudane.length + '): ' + nieudane.join(', '));
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
