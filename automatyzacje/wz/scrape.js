// Playwright: loguje się do ERP, otwiera listę WZ i klika po dokumentach —
// TA SAMA logika DOM co savpol-wz-eksport.user.js (Tampermonkey), tylko
// sterowana z Node zamiast z ręcznego kliknięcia w przeglądarce.
//
// Na razie (brak DB_NAME w .env) wynik NIE idzie do bazy — leci do
// results.json obok tego pliku, żeby dało się sprawdzić dane przed
// podpięciem zapisu do MSSQL.
//
// SELEKTORY LOGOWANIA SĄ PLACEHOLDEREM — patrz LOGIN_SELECTORS niżej.
// Zanim to zadziała, trzeba je podmienić na realne z sondy
// diagnostyka/sonda-login-form.js.
//
// Uruchomienie:  npm install   (raz)
//                npm run scrape

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const WZ_LIST_URL = process.env.WZ_LIST_URL ||
  'https://erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '5', 10); // tak samo ostrożnie jak w userscripcie na start

// PLACEHOLDER — DO PODMIANY na podstawie wyniku diagnostyka/sonda-login-form.js.
// Pierwsze dopasowanie na stronie wygrywa; jeśli selektor nie trafi, skrypt
// rzuci czytelny błąd zamiast cicho utknąć.
const LOGIN_SELECTORS = {
  username: '#TODO-username-selector',
  password: '#TODO-password-selector',
  submit: '#TODO-submit-selector'
};

// ---------- Logowanie do ERP ----------

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });

  const user = process.env.ERP_LOGIN;
  const pass = process.env.ERP_PASSWORD;
  if (!user || !pass) {
    throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w .env — uzupełnij plik automatyzacje/wz/.env');
  }

  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, user);
  await page.fill(LOGIN_SELECTORS.password, pass);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click(LOGIN_SELECTORS.submit)
  ]);

  console.log('[login] Zalogowano (albo przynajmniej strona się przeładowała). URL:', page.url());
}

// ---------- Scraping WZ (logika 1:1 z savpol-wz-eksport.user.js) ----------
// Ta funkcja jest wstrzykiwana do przeglądarki przez page.evaluate — działa
// więc w kontekście strony ERP, dokładnie jak userscript.

async function scrapeWzInPage(maxDocs) {
  const DOC_TYPES = ['WZ'];
  const MAX_PAGES = 100;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const DELAY_AFTER_OPEN = 300;
  const DELAY_AFTER_CLOSE = 300;
  const DELAY_AFTER_PAGE = 400;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function waitFor(fn, tries = 40, interval = 250) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }
  function parsePl(raw) {
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[\s ]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function visibleGrids() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table')).filter(t => t.offsetParent !== null);
  }
  function getVisibleListGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }
  function getVisiblePositionsGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="ItemDesc"]')
      && t.querySelector('td[data-datafield="QuantityUnits"]')) || null;
  }
  function cellTitle(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    return c ? (c.getAttribute('title') || '') : '';
  }
  function cellBold(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    if (!c) return [];
    return Array.from(c.querySelectorAll('.cs-style-text-bold')).map(b => (b.textContent || '').trim());
  }
  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }
  function rowDocType(row) {
    const bold = cellBold(row, 'DocNumber');
    return bold.length ? bold[0] : null;
  }
  function rowDocNumber(row) { return cellTitle(row, 'DocNumber') || null; }
  function targetRows() { return listRows().filter(r => DOC_TYPES.includes(rowDocType(r))); }

  function extractHeader(row) {
    return {
      docNumber: cellTitle(row, 'DocNumber'),
      docNumberExt: cellTitle(row, 'DocNumberExt'),
      docDate: (cellTitle(row, 'DocDate') || '').split(' ')[0],
      warehouseCode: cellTitle(row, 'Warehouse'),
      warehouseName: cellTitle(row, 'WarehouseDesc_PL'),
      wzn: cellTitle(row, 'DocNumberExtAdd2'),
      headerId: cellTitle(row, 'csDocsHeadersId'),
      warehouseId: cellTitle(row, 'csWarehousesId')
    };
  }

  function extractPositions(header) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
      if (!descCell) return null;
      const skuEl = descCell.querySelector('.cs-style-text-bold');
      const sku = skuEl ? (skuEl.textContent || '').trim() : '';
      if (!sku) return null;
      const lineWarehouseCode = cellTitle(row, 'Warehouse');
      return Object.assign({}, header, {
        warehouseCode: lineWarehouseCode || header.warehouseCode,
        sku: sku,
        name: (descCell.getAttribute('title') || '').trim(),
        unit: cellTitle(row, 'Unit'),
        qty: parsePl(cellTitle(row, 'QuantityUnits')),
        unitPrice: parsePl(cellTitle(row, 'StockUnitPrice')),
        lineValue: parsePl(cellTitle(row, 'FStock')),
        csItemsId: cellTitle(row, 'csItemsId'),
        csItemsUnitsId: cellTitle(row, 'csItemsUnitsId')
      });
    }).filter(Boolean);
  }

  function getVisiblePager() {
    return Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null) || null;
  }
  function pagerHasNextPage(pager) {
    if (!pager) return false;
    const next = pager.querySelector('.NextPageButton');
    return !!next && !next.className.split(/\s+/).includes('inactive');
  }
  async function goToNextPage(pager) {
    const pageNoBefore = pager.querySelector('.ActivePageNoInput');
    const beforeVal = pageNoBefore ? pageNoBefore.value : null;
    const pageChanged = () => {
      const p = getVisiblePager();
      const inp = p && p.querySelector('.ActivePageNoInput');
      return inp && inp.value !== beforeVal;
    };
    const next = pager.querySelector('.NextPageButton');
    if (next) {
      next.click();
      if (await waitFor(pageChanged, 40, 250)) {
        await sleep(DELAY_AFTER_PAGE);
        return true;
      }
    }
    return false;
  }

  const positions = [];
  const processedDocs = new Set();
  let consecutiveFailures = 0;
  let processed = 0;
  let pageNum = 1;

  while (processed < maxDocs && pageNum <= MAX_PAGES) {
    if (targetRows().length === 0) {
      await waitFor(() => targetRows().length > 0, 20, 300);
    }

    const docsOnPage = targetRows().map(rowDocNumber).filter(doc => doc && !processedDocs.has(doc));

    for (const targetDoc of docsOnPage) {
      if (processed >= maxDocs) break;

      const row = targetRows().find(r => rowDocNumber(r) === targetDoc);
      if (!row) continue;

      processedDocs.add(targetDoc);
      const header = extractHeader(row);

      const btn = row.querySelector('td[data-datafield="DocNumber"] .csButtonAction');
      if (!btn) continue;

      btn.click();

      const grid = await waitFor(() => getVisiblePositionsGrid());
      if (!grid) {
        consecutiveFailures++;
        const stray = document.querySelector('li.k-state-active .csCloseButton_span');
        if (stray) stray.click();
        await waitFor(() => getVisibleListGrid());
        await sleep(DELAY_AFTER_CLOSE);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return { positions, docs: processed, partial: true };
        }
        continue;
      }

      consecutiveFailures = 0;
      await sleep(DELAY_AFTER_OPEN);

      const rows = extractPositions(header);
      processed++;
      positions.push(...rows);

      const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (closeBtn) closeBtn.click();
      await waitFor(() => getVisibleListGrid());
      await sleep(DELAY_AFTER_CLOSE);
    }

    if (processed >= maxDocs) break;

    const pager = getVisiblePager();
    if (!pagerHasNextPage(pager)) break;
    if (!await goToNextPage(pager)) {
      return { positions, docs: processed, partial: true };
    }
    pageNum++;
  }

  return { positions, docs: processed, partial: false };
}

// ---------- Zapis wyniku ----------

async function saveResult(result) {
  const dbName = process.env.DB_NAME;
  if (!dbName) {
    const outPath = path.join(__dirname, 'results.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('[wynik] DB_NAME nie ustawione w .env — zapisano do', outPath,
      '(' + result.positions.length + ' wierszy, ' + result.docs + ' WZ, partial=' + result.partial + ')');
    return;
  }

  // TODO: zapis do MSSQL, jak dojdzie DB_NAME i wiadomo, do jakiej tabeli
  // (patrz mssql w package.json — połączenie z process.env.DB_HOST/PORT/USER/PASSWORD/NAME).
  throw new Error('DB_NAME jest ustawione, ale zapis do MSSQL nie jest jeszcze zaimplementowany.');
}

// ---------- Główny przebieg ----------

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Konsola strony (i błędy JS) widoczne w terminalu Node — przydatne przy
  // debugowaniu, bo w trybie headed i tak widać ekran, ale logi łatwiej czytać tu.
  page.on('console', msg => console.log('[strona]', msg.text()));
  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  try {
    await login(page);

    await page.goto(WZ_LIST_URL, { waitUntil: 'networkidle' });
    console.log('[wz] Lista załadowana. Startuję zbieranie (max ' + MAX_DOCS + ' dok.)...');

    const result = await page.evaluate(scrapeWzInPage, MAX_DOCS);
    console.log('[wz] Zebrano', result.docs, 'WZ,', result.positions.length, 'pozycji. partial=' + result.partial);

    await saveResult(result);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
