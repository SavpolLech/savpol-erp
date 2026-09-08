// Playwright: loguje się do ERP, otwiera listę WZ i klika po dokumentach —
// TA SAMA logika DOM co savpol-wz-eksport.user.js (Tampermonkey), tylko
// sterowana z Node zamiast z ręcznego kliknięcia w przeglądarce.
//
// Scrapuje SUROWE TEKSTY dokładnie pod nazwy kolumn dbo.csDocsHeaders /
// dbo.csDocsItemsPositions (lista pól: lib/fields.js, uzasadnienie:
// mapowanie-pol.md). Typowanie (int/decimal/data/tekst) i INSERT do MSSQL
// są sterowane metadanymi ze schema-test-tables.json (wygenerowanym przez
// generate-test-tables.js z PRAWDZIWEGO schematu cs06) — nie zgadujemy typów
// ręcznie w tym pliku.
//
// Bez DB_NAME / bez schema-test-tables.json wynik leci do results.json
// zamiast do bazy, żeby dało się sprawdzić dane przed podpięciem zapisu.
//
// Uruchomienie:  npm install                        (raz)
//                node generate-test-tables.js --apply (raz, po ustaleniu DB_NAME)
//                npm run scrape

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const F = require('./lib/fields');
const { mssqlType, coerceValue } = require('./lib/schema');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const WZ_LIST_URL = process.env.WZ_LIST_URL ||
  'https://erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '5', 10); // tak samo ostrożnie jak w userscripcie na start

// Z sondy diagnostyka/sonda-login-form.js (2026-09-07): oba pola mają
// zduplikowane id="Input" (nieunikalne w DOM), więc idziemy po `name` —
// to jest unikalne. Przycisku logowania NIE MA w DOM (0 widocznych
// <button>/[type=submit]/[role=button]) — formularz łapie Enter w polu
// hasła, więc submitujemy klawiszem, nie klikiem.
const LOGIN_SELECTORS = {
  username: 'input[name="username"]',
  password: 'input[name="password"]'
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

  // NIE czekamy na 'networkidle' — ERP non-stop odbudowuje WebSocket
  // (socket.io) w tle, więc sieć nigdy nie jest naprawdę bezczynna i to
  // czekanie potrafi wisieć aż do timeoutu nawet po udanym logowaniu.
  // Czekamy na realny sygnał: adres przestaje zawierać "/logowania/".
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(
    () => !location.href.includes('/logowanie/'),
    { timeout: 20000 }
  );

  console.log('[login] Zalogowano. URL:', page.url());
}

// ---------- Scraping WZ (logika 1:1 z savpol-wz-eksport.user.js) ----------
// Ta funkcja jest wstrzykiwana do przeglądarki przez page.evaluate — działa
// więc w kontekście strony ERP, dokładnie jak userscript. Zwraca SUROWE
// STRINGI (dokładnie to, co jest w atrybucie title komórki) — bez parsowania
// liczb/dat, to robi Node po stronie, metadanymi ze schematu bazy.

async function scrapeWzInPage(opts) {
  const { maxDocs, headerFields, headerFieldsFromPositions, positionFields } = opts;

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

  // Rekord nagłówka: surowe stringi pod dokładnie te nazwy pól, które
  // dostaliśmy z Node (headerFields — 23 pól wprost z gridu listy).
  function extractHeaderRaw(row) {
    const rec = {};
    headerFields.forEach(f => { rec[f] = cellTitle(row, f); });
    return rec;
  }

  // Pozycje: surowe stringi pod nazwy z positionFields. csDocsHeadersId
  // pozycji NADPISUJEMY wartością z nagłówka (link do dokumentu) — w gridzie
  // pozycji bywa puste/inne niż oczekiwane, a musi się zgadzać z rekordem
  // nagłówka 1:1, żeby FK się trzymał.
  function extractPositionsRaw(headerId) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      // Filtr "czy to realny wiersz pozycji": musi mieć SKU (pogrubiony
      // fragment w ItemDesc) — puste/techniczne wiersze siatki pomijamy.
      const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
      const skuEl = descCell ? descCell.querySelector('.cs-style-text-bold') : null;
      if (!skuEl || !(skuEl.textContent || '').trim()) return null;

      const rec = {};
      positionFields.forEach(f => { rec[f] = cellTitle(row, f); });
      rec.csDocsHeadersId = headerId;
      return rec;
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

  const headers = [];
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
      const headerRec = extractHeaderRaw(row);
      const headerId = headerRec.csDocsHeadersId;

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
          return { headers, positions, docs: processed, partial: true };
        }
        continue;
      }

      consecutiveFailures = 0;
      await sleep(DELAY_AFTER_OPEN);

      const posRows = extractPositionsRaw(headerId);

      // Pola nagłówka, których nie ma w gridzie listy, ale są w gridzie
      // pozycji (ExchangeRate, csCurrenciesId, S01/S02Amount, DocWeight,
      // DocGrossWeight) — bierzemy z PIERWSZEJ pozycji, to samo dla całego dok.
      const posGridRow = grid.querySelector('tr.cs-grid-data-row');
      if (posGridRow) {
        headerFieldsFromPositions.forEach(f => { headerRec[f] = cellTitle(posGridRow, f); });
      }

      headers.push(headerRec);
      positions.push(...posRows);
      processed++;

      const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (closeBtn) closeBtn.click();
      await waitFor(() => getVisibleListGrid());
      await sleep(DELAY_AFTER_CLOSE);
    }

    if (processed >= maxDocs) break;

    const pager = getVisiblePager();
    if (!pagerHasNextPage(pager)) break;
    if (!await goToNextPage(pager)) {
      return { headers, positions, docs: processed, partial: true };
    }
    pageNum++;
  }

  return { headers, positions, docs: processed, partial: false };
}

// ---------- Zapis wyniku ----------

function loadSchemaMeta() {
  const p = path.join(__dirname, 'schema-test-tables.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Buduje jeden INSERT na tabelę + parametry otypowane wg metadanych kolumn
// (mssqlType/coerceValue z lib/schema.js) — żeby SQL Server dostawał
// prawdziwe int/decimal/date, nie surowe stringi z ekranu ERP.
async function insertRows(pool, tableName, columnsMeta, rows) {
  if (!rows.length) return 0;
  // Kolumny WYLICZANE (computed) — SQL Server liczy je sam, nie da się ich
  // wprost wstawić (błąd "cannot be modified because it is ... a computed
  // column"). Pomijamy je, resztę wstawiamy normalnie.
  const insertableColumns = columnsMeta.filter(c => !c.IS_COMPUTED);
  let inserted = 0;
  for (const row of rows) {
    const request = pool.request();
    const colNames = [];
    const paramNames = [];
    insertableColumns.forEach((col, i) => {
      const paramName = 'p' + i;
      const value = coerceValue(row[col.COLUMN_NAME], col);
      request.input(paramName, mssqlType(col), value);
      colNames.push('[' + col.COLUMN_NAME + ']');
      paramNames.push('@' + paramName);
    });
    await request.query(
      'INSERT INTO dbo.' + tableName + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')'
    );
    inserted++;
  }
  return inserted;
}

async function saveResult(result) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const schema = loadSchemaMeta();

  if (!DB_NAME || !schema) {
    const outPath = path.join(__dirname, 'results.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('[wynik]', !DB_NAME ? 'DB_NAME nie ustawione' : 'brak schema-test-tables.json (uruchom generate-test-tables.js --apply)',
      '— zapisano do', outPath,
      '(' + result.headers.length + ' WZ, ' + result.positions.length + ' pozycji, partial=' + result.partial + ')');
    return;
  }

  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  const pool = await sql.connect(config);
  try {
    const insertedHeaders = await insertRows(pool, F.TEST_TABLE_HEADERS, schema.headers, result.headers);
    const insertedPositions = await insertRows(pool, F.TEST_TABLE_POSITIONS, schema.positions, result.positions);
    console.log('[wynik] Zapisano do bazy "' + DB_NAME + '": ' + insertedHeaders + ' wierszy w ' +
      F.TEST_TABLE_HEADERS + ', ' + insertedPositions + ' wierszy w ' + F.TEST_TABLE_POSITIONS + '.');
  } finally {
    await pool.close();
  }
}

// ---------- Główny przebieg ----------

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('[strona]', msg.text()));
  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  try {
    await login(page);

    await page.goto(WZ_LIST_URL, { waitUntil: 'domcontentloaded' });
    // Tak samo jak w scrapeWzInPage: siatka ładuje się asynchronicznie, więc
    // czekamy na realny sygnał (wiersz z DocNumber), nie na stan sieci.
    await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });
    console.log('[wz] Lista załadowana. Startuję zbieranie (max ' + MAX_DOCS + ' dok.)...');

    const result = await page.evaluate(scrapeWzInPage, {
      maxDocs: MAX_DOCS,
      headerFields: F.HEADER_FIELDS,
      headerFieldsFromPositions: F.HEADER_FIELDS_FROM_FIRST_POSITION,
      positionFields: F.POSITION_FIELDS
    });
    console.log('[wz] Zebrano', result.headers.length, 'WZ,', result.positions.length, 'pozycji. partial=' + result.partial);

    await saveResult(result);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
