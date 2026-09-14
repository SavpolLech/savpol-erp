// Playwright: loguje się do ERP, otwiera katalog, wyszukuje produkt po SKU,
// wchodzi w jego kartę (EDYCJA) i przechwytuje odpowiedź API karty produktu
// (DictIdent: csItemsOneBro, OperationName: RefreshDataSetSQL_Synchronous).
//
// Analogicznie do automatyzacje/wz/scrape.js, z jedną zasadniczą różnicą:
// dane karty produktu NIE są w widocznych komórkach siatki (jak przy WZ),
// tylko wracają jednym zapytaniem API spakowanym jako base64(ZIP+deflate).
// Dlatego zamiast czytać DOM, PODSŁUCHUJEMY odpowiedź sieciową i dekodujemy
// ją w Node (lib/decode.js) — to ta sama droga, którą namierzyły sondy w
// diagnostyka/podsluch-danych-produktu.js i eksport-csv-produktu.js.
//
// Logika sterowania UI (wyszukanie w katalogu, klik w ItemDesc, "Edycja")
// jest przeniesiona 1:1 z savpol-historia-faktur.user.js (otworzKarteDoEdycji).
//
// Uruchomienie:  node scrape.js 0000031
//                node scrape.js 0000031 0000045 ...   (kilka SKU po kolei)
// Bez argumentu bierze SKU z SKUS w .env albo domyślnie 0000031.

const path = require('path');
const fs = require('fs');

// Zależności bierzemy z lokalnego node_modules, a jak go nie ma — z ../wz
// (żeby nie instalować Playwrighta i nie ściągać przeglądarki drugi raz na tę
// samą maszynę). Docelowo produkty/ dostanie własne node_modules przez
// `npm install` w tym folderze.
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const dotenv = req('dotenv');

// .env: najpierw lokalny (produkty/.env), a jak go nie ma — współdzielony z
// wz/.env (te same dane logowania do ERP). Oba są w .gitignore.
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', 'wz', '.env') });

const { decodeJsonResult, extractCardRecord } = require('./lib/decode');
const F = require('./lib/fields');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const CATALOG_URL = process.env.CATALOG_URL || 'https://erp.savpol.pl/pl/katalog/csitems/';

const OUT_DIR = path.join(__dirname, 'wynik');

// Z sondy diagnostyka/sonda-login-form.js (2026-09-07), tak samo jak w WZ:
// oba pola logowania mają zduplikowane id="Input", więc idziemy po `name`;
// przycisku "Zaloguj" nie ma w DOM — submit przez Enter w polu hasła.
const LOGIN_SELECTORS = {
  username: 'input[name="username"]',
  password: 'input[name="password"]'
};

// ---------- Logowanie (1:1 z wz/scrape.js) ----------

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });

  const user = process.env.ERP_LOGIN;
  const pass = process.env.ERP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Brak ERP_LOGIN / ERP_PASSWORD — uzupełnij automatyzacje/produkty/.env ' +
      '(albo automatyzacje/wz/.env, z którego ten skrypt korzysta zapasowo).');
  }

  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, user);
  await page.fill(LOGIN_SELECTORS.password, pass);

  // Jak w WZ: NIE czekamy na 'networkidle' (ERP non-stop odbudowuje WebSocket
  // w tle), tylko na realny sygnał — adres przestaje zawierać "/logowanie/".
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 20000 });
  console.log('[login] Zalogowano. URL:', page.url());
}

// ---------- Otwarcie karty produktu w UI (logika z userscriptu) ----------
// Wstrzykiwane do strony przez page.evaluate — działa w kontekście ERP,
// dokładnie jak savpol-historia-faktur.user.js: wyszukaj w katalogu, kliknij
// wiersz (ItemDesc), kliknij "Edycja". Samo otwarcie karty każe stronie
// wysłać zapytanie csItemsOneBro — łapie je nasz page.on('response').

async function openProductCardInPage(opts) {
  const { sku } = opts;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, tries = 60, interval = 250) {
    for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(interval); }
    return null;
  }

  function visiblePanels() {
    return Array.from(document.querySelectorAll('.csDBEditSearch'))
      .filter(w => w.offsetParent !== null);
  }
  function catalogSearchInput() {
    const w = visiblePanels()[0];
    return w ? w.querySelector('input.Input') : null;
  }
  function visibleCatalogGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .find(t => t.offsetParent !== null && t.querySelector('td[data-datafield="Item"]')) || null;
  }
  function rowForSku() {
    const grid = visibleCatalogGrid();
    if (!grid) return null;
    return Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row')).find(r => {
      const c = r.querySelector('td[data-datafield="Item"]');
      return c && c.getAttribute('title') === sku;
    }) || null;
  }

  // --- Wyszukanie w katalogu ---
  const input = await waitFor(catalogSearchInput);
  if (!input) return { ok: false, blad: 'nie znalazłem pola wyszukiwania katalogu' };

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(input, sku);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
  await sleep(500);

  const row = await waitFor(rowForSku, 40, 250);
  if (!row) {
    const grid = visibleCatalogGrid();
    const widoczne = grid
      ? Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row'))
          .map(r => { const c = r.querySelector('td[data-datafield="Item"]'); return c ? c.getAttribute('title') : '?'; })
          .slice(0, 8)
      : [];
    return { ok: false, blad: 'nie znalazłem ' + sku + ' w katalogu (widzę: ' + widoczne.join(', ') + ')' };
  }

  // --- Zaznacz wiersz i otwórz EDYCJĘ ---
  const descCell = row.querySelector('td[data-datafield="ItemDesc"]') || row.querySelector('td[data-datafield="Item"]');
  if (descCell) descCell.click();
  await sleep(300);

  const editBtn = Array.from(document.querySelectorAll('[title="Edycja"]'))
    .find(b => b.offsetParent !== null);
  if (!editBtn) return { ok: false, blad: 'nie widzę przycisku „Edycja" (uprawnienia? inny widok?)' };
  editBtn.click();

  // Karta poznaje się po formularzu .csDictBaseForm.csItemsOneBro (tak samo
  // jak w userscripcie, znajdzOtwartaKarte). Nie jest to warunek sukcesu
  // przechwycenia — dane łapiemy z sieci — ale potwierdza, że karta ruszyła.
  const karta = await waitFor(() =>
    document.querySelector('.csDictBaseForm.csItemsOneBro') ||
    Array.from(document.querySelectorAll('li.k-item[aria-controls]')).some(li => /csItemsOneBro_\d+/i.test(li.id || '')),
    60, 500);

  return { ok: true, kartaWidoczna: !!karta };
}

// ---------- Zapis wyniku ----------

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Dwa CSV-y (średnik — spójnie z resztą repo, PL Excel) + JSON z pełnym
// rekordem i metadanymi. CSV nazwane results-* → łapie je istniejąca reguła
// .gitignore (automatyzacje/**/results-*.csv), więc dane handlowe nie wejdą
// do repo. Nazwy pól w nagłówku, wartości w jednym wierszu (jeden produkt).
function saveResult(sku, rekord, fieldNames) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const id = String(rekord.Item || sku).replace(/[^A-Za-z0-9_-]/g, '_');

  const csvWszystkie = fieldNames.map(escCsv).join(';') + '\n'
    + fieldNames.map(n => escCsv(rekord[n])).join(';');
  const csvDopasowane = F.DOPASOWANE.map(escCsv).join(';') + '\n'
    + F.DOPASOWANE.map(n => escCsv(rekord[n])).join(';');

  const wszystkiePath = path.join(OUT_DIR, 'results-produkt_' + id + '_wszystkie-pola-api.csv');
  const dopasowanePath = path.join(OUT_DIR, 'results-produkt_' + id + '_dopasowane-kolumny.csv');
  const jsonPath = path.join(OUT_DIR, 'results-produkt_' + id + '.json');

  fs.writeFileSync(wszystkiePath, '﻿' + csvWszystkie, 'utf8');
  fs.writeFileSync(dopasowanePath, '﻿' + csvDopasowane, 'utf8');

  const dopasowaneRekord = {};
  F.DOPASOWANE.forEach(n => { dopasowaneRekord[n] = (n in rekord) ? rekord[n] : null; });
  const brakujaceDopasowane = F.DOPASOWANE.filter(n => !(n in rekord));

  fs.writeFileSync(jsonPath, JSON.stringify({
    sku,
    item: rekord.Item,
    itemDesc: rekord.ItemDesc,
    pobrano: new Date().toISOString(),
    liczbaPolApi: fieldNames.length,
    liczbaPolDopasowanych: F.DOPASOWANE.length - brakujaceDopasowane.length,
    brakujaceDopasowane,
    dopasowane: dopasowaneRekord,
    wszystkie: rekord
  }, null, 2), 'utf8');

  console.log('[wynik] Zapisano:');
  console.log('  ' + jsonPath);
  console.log('  ' + dopasowanePath + '  (' + F.DOPASOWANE.length + ' kolumn, ' + brakujaceDopasowane.length + ' pustych/brakujących)');
  console.log('  ' + wszystkiePath + '  (' + fieldNames.length + ' pól API)');
  if (brakujaceDopasowane.length) {
    console.log('[wynik] Pola z listy dopasowanych, których to zapytanie NIE zwróciło: ' +
      brakujaceDopasowane.join(', '));
  }
}

// ---------- Główny przebieg ----------

async function scrapeOneProduct(page, captured, sku) {
  console.log('\n[produkt] === ' + sku + ' ===');
  captured.length = 0; // czyścimy bufor przechwyceń przed każdym SKU

  const wynik = await page.evaluate(openProductCardInPage, { sku });
  if (!wynik.ok) {
    console.warn('[produkt] ' + sku + ': ' + wynik.blad);
    return false;
  }
  console.log('[produkt] ' + sku + ': karta otwarta (widoczna=' + wynik.kartaWidoczna + '), czekam na odpowiedź API...');

  // Odpowiedź jest dekodowana asynchronicznie w handlerze page.on('response').
  // Czekamy, aż w buforze pojawi się rekord karty tego SKU. Rozpoznajemy go po:
  // - dataSetIdent 'csitems' (albo dużej liczbie pól, >150 — karta ma ~314),
  // - obecności pola Item równego szukanemu SKU.
  let trafienie = null;
  for (let i = 0; i < 60 && !trafienie; i++) {
    trafienie = pickCardRecord(captured, sku);
    if (!trafienie) await page.waitForTimeout(300);
  }

  if (!trafienie) {
    console.warn('[produkt] ' + sku + ': nie przechwyciłem odpowiedzi karty. ' +
      'Przechwycone zestawy: ' + captured.map(c => (c.dataSetIdent || '?') + '(' + c.fieldNames.length + ' pól)').join(', '));
    captured.forEach((c, i) => {
      const items = c.records.map(r => JSON.stringify(r.Item)).slice(0, 5);
      console.warn('  [' + i + '] ' + (c.dataSetIdent || '?') + ' pól=' + c.fieldNames.length +
        ' wierszy=' + c.records.length + ' Item=' + items.join(',') +
        ' maItem=' + c.fieldNames.includes('Item'));
    });
    return false;
  }

  saveResult(sku, trafienie.rekord, trafienie.fieldNames);
  return true;
}

// Wybiera z bufora rekord KARTY produktu dla danego SKU. Uwaga: siatka
// katalogu też ma DataSetSQLIdent 'csitems' i pole Item, ale zwraca ~58 pól i
// wiele wierszy — karta zwraca ~314 pól i jeden wiersz. Rozróżniamy po liczbie
// pól (próg 150 czysto oddziela oba przypadki), więc nie bierzemy siatki
// zamiast karty tylko dlatego, że przyszła pierwsza.
const CARD_MIN_FIELDS = 150;
function pickCardRecord(captured, sku) {
  let best = null;
  for (const c of captured) {
    if (c.fieldNames.length < CARD_MIN_FIELDS) continue; // to nie karta, tylko siatka/inny zestaw
    const rec = c.records.find(r => String(r.Item) === sku);
    if (!rec) continue;
    if (!best || c.fieldNames.length > best.fieldNames.length) {
      best = { rekord: rec, fieldNames: c.fieldNames };
    }
  }
  return best;
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const skus = args.length ? args
    : (process.env.SKUS ? process.env.SKUS.split(/[,\s]+/).filter(Boolean) : ['0000031']);

  console.log('[start] SKU do zescrapowania: ' + skus.join(', ') + (HEADLESS ? ' (headless)' : ' (widoczna przeglądarka)'));

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  // Podsłuch odpowiedzi: każdy POST z polem JSONResult próbujemy zdekodować i
  // wyciągnąć DataTable. To odpowiedniki fetch/XHR łapane w przeglądarce przez
  // podsluch-danych-produktu.js — tu robimy to samo od strony Playwrighta.
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
    } catch (e) { /* odpowiedź nieczytelna/binarna — pomijamy */ }
  });

  let ok = 0;
  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    console.log('[katalog] Załadowany.');

    for (const sku of skus) {
      if (await scrapeOneProduct(page, captured, sku)) ok++;
    }
  } catch (err) {
    console.error('[BŁĄD]', err.message);
    try { await page.screenshot({ path: path.join(__dirname, 'debug-blad.png'), fullPage: true }); } catch (e) {}
    throw err;
  } finally {
    await browser.close();
  }

  console.log('\n[koniec] Zescrapowano ' + ok + '/' + skus.length + ' produktów.');
}

main().catch(err => { console.error(err); process.exit(1); });
