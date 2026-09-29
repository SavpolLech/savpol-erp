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
// Gdy pozycja WZ nie ma nazwy (PositionDesc NULL — bywają całe takie
// dokumenty), otwieramy ten WZ w ERP i bierzemy SKU z jego siatki pozycji;
// kandydatów (bez SKU już obecnych w worek.csItems) sprawdzamy w katalogu,
// aż któryś ma szukane csItemsId.
//
// W katalogu odznaczamy "Bez wyc." — Michał, 2026-09-29: wycofane kartoteki
// też muszą być w bazie, bo występują na dokumentach.
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
const WZ_LIST_URL = process.env.WZ_LIST_URL || 'https://erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';

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

function inIdy(r, idy) {
  return idy.map((id, i) => { r.input('id' + i, sql.BigInt, id); return '@id' + i; }).join(',');
}

// Nazwy z pozycji WZ, a dla id bez nazwy — dokumenty, na których występują
// (do otwarcia w ERP), plus SKU już znane w csItems (do odrzucenia kandydatów).
async function daneZWorek(idy) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: process.env.DB_NAME || 'worek',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000, requestTimeout: 120000
  });
  try {
    let r = pool.request();
    const q = await r.query(
      'SELECT CAST(csItemsId AS varchar(30)) AS id, PositionDesc AS nazwa, COUNT(*) AS n FROM dbo.csDocsItemsPositions ' +
      'WHERE csItemsId IN (' + inIdy(r, idy) + ') AND PositionDesc IS NOT NULL GROUP BY csItemsId, PositionDesc ORDER BY n DESC'
    );
    const nazwy = new Map();
    for (const w of q.recordset) {
      if (!nazwy.has(w.id)) nazwy.set(w.id, []);
      nazwy.get(w.id).push(w.nazwa.trim());
    }

    const bezNazwy = idy.filter(id => !nazwy.has(id));
    const dokumenty = new Map(); // id → [{ numer, data }]
    if (bezNazwy.length) {
      r = pool.request();
      const d = await r.query(
        'SELECT DISTINCT CAST(p.csItemsId AS varchar(30)) AS id, h.DocNumber AS numer, CONVERT(varchar(10), h.DocDate, 120) AS data ' +
        'FROM dbo.csDocsItemsPositions p JOIN dbo.csDocsHeaders h ON h.csDocsHeadersId = p.csDocsHeadersId ' +
        'WHERE p.csItemsId IN (' + inIdy(r, bezNazwy) + ") AND h.DocNumber LIKE '%/WZ/%'"
      );
      for (const w of d.recordset) {
        if (!dokumenty.has(w.id)) dokumenty.set(w.id, []);
        dokumenty.get(w.id).push({ numer: w.numer, data: w.data });
      }
    }
    const znane = await pool.request().query('SELECT Item FROM dbo.csItems');
    return { nazwy, dokumenty, znaneSku: new Set(znane.recordset.map(x => String(x.Item))) };
  } finally {
    await pool.close();
  }
}

// Otwiera WZ na liście dokumentów (zakres dat = dzień dokumentu + szukanie po
// numerze) i zwraca SKU z siatki pozycji (pogrubiony fragment ItemDesc).
async function skuZDokumentuWz(page, numer, data) {
  await page.goto(WZ_LIST_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 60000 });
  for (const ph of ['Od', 'Do']) {
    const pole = page.locator('input[placeholder="' + ph + '"]:visible').first();
    await pole.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(data, { delay: 50 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
  }
  await page.locator('.ButtonRefresh:visible').first().click();
  await page.waitForTimeout(2500);
  return page.evaluate(async (doc) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function waitFor(fn, n = 60) { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(250); } return null; }
    const grids = () => Array.from(document.querySelectorAll('.cs-grid-data-table')).filter(t => t.offsetParent !== null);
    const w = Array.from(document.querySelectorAll('.csDBEditSearch')).filter(x => x.offsetParent !== null)[0];
    const input = w && w.querySelector('input.Input');
    if (!input) return { blad: 'brak pola szukania na liście WZ' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, doc);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
    await sleep(1500);
    const row = await waitFor(() => {
      const g = grids().find(t => t.querySelector('td[data-datafield="DocNumber"]'));
      return g && Array.from(g.querySelectorAll('tr.cs-grid-data-row'))
        .find(x => (x.querySelector('td[data-datafield="DocNumber"]') || {}).title === doc);
    });
    if (!row) return { blad: 'nie znalazłem ' + doc + ' na liście WZ' };
    const btn = row.querySelector('td[data-datafield="DocNumber"] .csButtonAction');
    if (!btn) return { blad: 'brak przycisku otwarcia ' + doc };
    btn.click();
    const pos = await waitFor(() => grids().find(t => t.querySelector('td[data-datafield="ItemDesc"]') && t.querySelector('td[data-datafield="QuantityUnits"]')), 80);
    if (!pos) return { blad: 'nie otworzyła się siatka pozycji ' + doc };
    await sleep(1500);
    const sku = Array.from(pos.querySelectorAll('tr.cs-grid-data-row')).map(x => {
      const b = x.querySelector('td[data-datafield="ItemDesc"] .cs-style-text-bold');
      return b ? b.textContent.trim() : null;
    }).filter(Boolean);
    const close = document.querySelector('li.k-state-active .csCloseButton_span');
    if (close) close.click();
    return { sku };
  }, numer);
}

async function odznaczBezWycofanych(page) {
  const box = page.locator('.csDBCheckBox:visible', { hasText: 'Bez wyc.' }).first();
  await box.waitFor({ timeout: 15000 });
  const input = box.locator('input[type="checkbox"]');
  if (await input.isChecked()) {
    await box.locator('label.Label').click();
    await page.waitForTimeout(800);
  }
  if (await input.isChecked()) throw new Error('Nie udało się odznaczyć "Bez wyc." w katalogu.');
  console.log('[katalog] Odznaczono "Bez wyc." — widoczne także wycofane kartoteki.');
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

async function znajdzSkuPoId(page, captured, id, frazy) {
  for (const fraza of frazy) {
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

  const { nazwy, dokumenty, znaneSku } = await daneZWorek(idy);
  const bezNazwy = idy.filter(id => !nazwy.has(id));
  if (bezNazwy.length) console.log('[worek] Bez nazwy w pozycjach WZ (szukam przez dokument WZ): ' + bezNazwy.join(', '));

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

    // Kandydaci SKU z dokumentów WZ dla id bez nazwy — przed katalogiem, bo
    // przejście na listę WZ i z powrotem resetuje filtry katalogu.
    const kandydaci = new Map();
    const cacheDok = new Map();
    for (const id of bezNazwy) {
      const sku = new Set();
      for (const dok of (dokumenty.get(id) || [])) {
        if (!cacheDok.has(dok.numer)) {
          const w = await skuZDokumentuWz(page, dok.numer, dok.data);
          if (w.blad) console.warn('[wz] ' + w.blad);
          cacheDok.set(dok.numer, w.sku || []);
          console.log('[wz] ' + dok.numer + ': ' + (w.sku || []).length + ' pozycji.');
        }
        cacheDok.get(dok.numer).forEach(s => { if (!znaneSku.has(s)) sku.add(s); });
      }
      kandydaci.set(id, Array.from(sku));
    }

    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    console.log('[katalog] Załadowany.');
    await odznaczBezWycofanych(page);

    for (const id of idy) {
      const frazy = nazwy.has(id) ? frazyDlaNazw(nazwy.get(id)) : kandydaci.get(id);
      if (!frazy || !frazy.length) {
        const powod = nazwy.has(id) ? 'brak fraz' : 'brak nazwy i brak kandydatów z dokumentów WZ';
        console.warn('[id] ' + id + ': ' + powod);
        dopiszMape(id, '', powod);
        nieudane.push(id);
        continue;
      }
      const trafienie = await znajdzSkuPoId(page, captured, id, frazy);
      if (!trafienie) {
        console.warn('[id] ' + id + ': nie znalazłem w katalogu (' + (nazwy.has(id) ? 'nazwa: ' + nazwy.get(id)[0] : 'kandydaci z WZ: ' + frazy.join(', ')) + ')');
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
