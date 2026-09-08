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

// Górny limit czasu jednej sesji — człowiek nie siedzi w ERP klikając to
// samo bez przerwy godzinami. Po przekroczeniu kończymy przebieg (wynik
// częściowy, jak przy limicie dokumentów), zamiast ciągnąć w nieskończoność.
const MAX_SESSION_MINUTES = parseInt(process.env.MAX_SESSION_MINUTES || '25', 10);

// Opcjonalny filtr daty. FILTER_DATE=YYYY-MM-DD ustawia "Od"/"Do" na TĘ SAMĄ
// datę. FILTER_DATE_FROM/FILTER_DATE_TO pozwalają ustawić różne granice
// (przydatne, dopóki nie wiemy, czy "Do" jest inkluzywne czy nie — patrz
// setDateFilter). Bez żadnej z tych zmiennych skrypt bierze cokolwiek
// pokazuje domyślny, niefiltrowany widok listy.
const FILTER_DATE_FROM = process.env.FILTER_DATE_FROM || process.env.FILTER_DATE || null;
const FILTER_DATE_TO = process.env.FILTER_DATE_TO || process.env.FILTER_DATE || null;

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
  const { maxDocs, headerFields, headerFieldsFromPositions, positionFields, maxSessionMs } = opts;

  const DOC_TYPES = ['WZ'];
  const MAX_PAGES = 100;
  const MAX_CONSECUTIVE_FAILURES = 3;

  // Przedziały zamiast stałych wartości — identyczne opóźnienie powtórzone
  // na każdym kroku jest samo w sobie sygnałem "to nie jest człowiek".
  // Losowość + od czasu do czasu dłuższa pauza (jakby ktoś czytał dokument)
  // ma to rozmyć, nie tylko spowolnić.
  const DELAY_AFTER_OPEN = [400, 1100];
  const DELAY_AFTER_CLOSE = [350, 900];
  const DELAY_AFTER_PAGE = [500, 1400];
  const LONG_PAUSE_CHANCE = 0.12; // ok. co 8. dokument dłuższa "przerwa na czytanie"
  const LONG_PAUSE_RANGE = [2000, 5000];

  const started = Date.now();
  function sessionTimeUp() {
    return maxSessionMs && (Date.now() - started) > maxSessionMs;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function jitter([min, max]) { return min + Math.random() * (max - min); }
  async function humanPause(range) {
    await sleep(jitter(range));
    if (Math.random() < LONG_PAUSE_CHANCE) await sleep(jitter(LONG_PAUSE_RANGE));
  }
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
        await humanPause(DELAY_AFTER_PAGE);
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
    if (sessionTimeUp()) {
      return { headers, positions, docs: processed, partial: true, stoppedReason: 'session_time_limit' };
    }
    if (targetRows().length === 0) {
      await waitFor(() => targetRows().length > 0, 20, 300);
    }

    const docsOnPage = targetRows().map(rowDocNumber).filter(doc => doc && !processedDocs.has(doc));

    for (const targetDoc of docsOnPage) {
      if (processed >= maxDocs) break;
      if (sessionTimeUp()) {
        return { headers, positions, docs: processed, partial: true, stoppedReason: 'session_time_limit' };
      }

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
        // Narastający backoff: pierwsza porażka to zwykła pauza, kolejne z
        // rzędu czekają coraz dłużej — jak przy realnym problemie po stronie
        // człowieka (zawieszenie, ponowna próba), nie mechaniczne "bang bang bang".
        await sleep(jitter(DELAY_AFTER_CLOSE) * consecutiveFailures);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return { headers, positions, docs: processed, partial: true };
        }
        continue;
      }

      consecutiveFailures = 0;
      await humanPause(DELAY_AFTER_OPEN);

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
      await humanPause(DELAY_AFTER_CLOSE);
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

// Prosty CSV (średnik jako separator — spójnie z resztą narzędzi w repo,
// PL Excel domyślnie oczekuje średnika). Ucieczka cudzysłowów wg RFC4180.
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(';')];
  rows.forEach(r => lines.push(cols.map(c => esc(r[c])).join(';')));
  return lines.join('\n');
}

async function saveResult(result) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const forceCsv = process.argv.includes('--csv');
  const schema = loadSchemaMeta();

  if (forceCsv || !DB_NAME || !schema) {
    const headersPath = path.join(__dirname, 'results-headers.csv');
    const positionsPath = path.join(__dirname, 'results-positions.csv');
    fs.writeFileSync(headersPath, toCsv(result.headers), 'utf8');
    fs.writeFileSync(positionsPath, toCsv(result.positions), 'utf8');
    console.log('[wynik]', forceCsv ? '--csv wymuszone' : (!DB_NAME ? 'DB_NAME nie ustawione' : 'brak schema-test-tables.json'),
      '— zapisano do', headersPath, 'i', positionsPath,
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

// ---------- Filtr daty (Od/Do) ----------
// Automatyzacja startuje w OSOBNEJ, świeżej sesji przeglądarki — filtr
// ustawiony ręcznie przez człowieka w jego własnej karcie jej nie dotyczy.
// Pola "Od"/"Do" to prawdziwy Kendo UI DatePicker (klasy k-widget/k-datepicker
// w DOM, patrz diagnostyka/sonda-filtr-daty.js) — ustawiamy przez jego JS API
// (kendo.widgetInstance), nie przez wpisywanie tekstu w nieznanym formacie.

async function setDateFilter(page, isoDateFrom, isoDateTo) {
  // Programowe wywołanie API Kendo (widget.value()) NIE wystarczyło — pole
  // się zmieniało wizualnie, ale ERP i tak wracał do poprzedniego widoku po
  // "Pokaż" (ten ERP owija Kendo we WŁASNY control z osobnym systemem
  // eventów — surowy 'change' z Kendo do niego nie dociera). Wpisujemy więc
  // tekst NAPRAWDĘ, klawiaturą — tak jak zrobiłby to człowiek, i tak jak
  // reaguje realny handler inputa.
  async function typeInto(placeholder, text) {
    const locator = page.locator('input[placeholder="' + placeholder + '"]');
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await locator.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text, { delay: 40 + Math.random() * 60 });
    await page.keyboard.press('Tab');
  }

  await typeInto('Od', isoDateFrom);
  await humanClickDelay(page);
  await typeInto('Do', isoDateTo);
  await humanClickDelay(page);

  const readBack = await page.evaluate(() => {
    const read = (ph) => {
      const el = Array.from(document.querySelectorAll('input[placeholder="' + ph + '"]')).find(e => e.offsetParent !== null);
      return el ? el.value : null;
    };
    return { od: read('Od'), do: read('Do') };
  });
  console.log('[filtr] Wartości pól po wpisaniu:', JSON.stringify(readBack));
  if (readBack.od !== isoDateFrom || readBack.do !== isoDateTo) {
    throw new Error('Pola dat nie przyjęły wpisanej wartości: ' + JSON.stringify(readBack) +
      ' (oczekiwano od=' + isoDateFrom + ', do=' + isoDateTo + ')');
  }

  // UWAGA: title="Pokaż" występuje TEŻ wewnątrz komórek wiersza (np. "Pokaż
  // Nr dok.", widoczne w sondzie listy WZ) — złapanie pierwszego pasującego
  // elementu na całej stronie ryzykuje kliknięcie czegoś zupełnie innego niż
  // przycisk zatwierdzenia filtra. Zawężamy do widocznego #ToolBarPanel.
  //
  // KLIKAMY PRAWDZIWĄ MYSZĄ (locator.click()), nie JS-owym element.click() —
  // ten framework najwyraźniej nasłuchuje realnych zdarzeń wskaźnika
  // (mousedown/pointerdown), których syntetyczny .click() nie generuje.
  // Pierwsza próba przez page.evaluate + .click() nie odświeżała siatki
  // mimo poprawnie wypełnionych pól — to jest bardziej "ludzkie" i naprawia problem.
  await humanClickDelay(page);
  const rowsBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll('td[data-datafield="DocNumber"]')).map(td => td.getAttribute('title')).join('|'));

  // DIAGNOSTYKA: ile pasujących #ToolBarPanel/przycisków "Pokaż" w ogóle jest
  // w DOM (widzieliśmy już duplikaty paneli w tym ERP — może to ten sam problem).
  const toolbarInfo = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('#ToolBarPanel'));
    return panels.map((p, i) => ({
      idx: i,
      visible: p.offsetParent !== null,
      hasPokaz: !!p.querySelector('.caption[title="Pokaż"]')
    }));
  });
  console.log('[filtr] #ToolBarPanel w DOM:', JSON.stringify(toolbarInfo));

  await page.screenshot({ path: path.join(__dirname, 'debug-przed-pokaz.png') });

  const showButton = page.locator('#ToolBarPanel:visible .caption[title="Pokaż"]').first();
  await showButton.waitFor({ timeout: 10000 });
  const box = await showButton.boundingBox();
  console.log('[filtr] Pozycja przycisku "Pokaż":', JSON.stringify(box));
  await showButton.click();

  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(__dirname, 'debug-po-pokaz.png') });

  const pagerCount = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    const e = p && p.querySelector('.ResultsCountValue');
    return e ? (e.value || e.textContent || '').trim() : null;
  });
  console.log('[filtr] Licznik rekordów w pagerze po kliknięciu:', pagerCount);

  const rowsAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('td[data-datafield="DocNumber"]')).map(td => td.getAttribute('title')).slice(0, 3));
  const changed = rowsAfter.join('|') !== rowsBefore;

  if (!changed) {
    console.warn('[filtr] UWAGA: siatka nie zmieniła zawartości po kliknięciu "Pokaż" — filtr prawdopodobnie NIE zadziałał.');
  }
  console.log('[filtr] Ustawiono zakres ' + isoDateFrom + '..' + isoDateTo + ', kliknięto "Pokaż" (zmiana siatki: ' + changed +
    '). Pierwsze wiersze teraz: ' + JSON.stringify(rowsAfter));
}

async function humanClickDelay(page) {
  await page.waitForTimeout(300 + Math.random() * 500);
}

// ---------- Główny przebieg ----------

// Jedna aktywna sesja na raz — nigdy dwie równoległe wobec tego samego ERP.
// Blokada wygasa sama po godzinie (na wypadek, gdyby poprzedni proces padł
// bez sprzątnięcia po sobie), żeby nie trzeba było jej ręcznie kasować.
const LOCK_PATH = path.join(__dirname, '.scrape.lock');
const LOCK_MAX_AGE_MS = 60 * 60 * 1000;

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < LOCK_MAX_AGE_MS) {
      throw new Error('Inna sesja scrapera już trwa (blokada z ' + Math.round(age / 1000) + 's temu) — kończę bez startu.');
    }
    console.warn('[lock] Stara blokada (' + Math.round(age / 60000) + ' min) — poprzedni proces prawdopodobnie padł. Nadpisuję.');
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (e) { /* już nie ma, trudno */ }
}

async function main() {
  acquireLock();
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

    if (FILTER_DATE_FROM || FILTER_DATE_TO) {
      await setDateFilter(page, FILTER_DATE_FROM || FILTER_DATE_TO, FILTER_DATE_TO || FILTER_DATE_FROM);
    }

    console.log('[wz] Lista załadowana. Startuję zbieranie (max ' + MAX_DOCS + ' dok.)...');

    const result = await page.evaluate(scrapeWzInPage, {
      maxDocs: MAX_DOCS,
      headerFields: F.HEADER_FIELDS,
      headerFieldsFromPositions: F.HEADER_FIELDS_FROM_FIRST_POSITION,
      positionFields: F.POSITION_FIELDS,
      maxSessionMs: MAX_SESSION_MINUTES * 60 * 1000
    });
    console.log('[wz] Zebrano', result.headers.length, 'WZ,', result.positions.length, 'pozycji. partial=' + result.partial +
      (result.stoppedReason === 'session_time_limit' ? ' (koniec: limit czasu sesji ' + MAX_SESSION_MINUTES + ' min)' : ''));

    await saveResult(result);
  } finally {
    await browser.close();
    releaseLock();
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
