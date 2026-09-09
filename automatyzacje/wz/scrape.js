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
const { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES } = require('./lib/fixed-values');

// Dopisuje stałe wartości (Michał, 2026-09-09) do rekordów paczki PRZED
// zapisem — te pola nie są scrapowane z ERP, to wewnętrzne flagi zależne od
// typu dokumentu (dla WZ zawsze te same). createdDate pozycji = DocDate jej
// nagłówka (reguła, nie stała — stąd osobna obsługa).
function applyFixedValues(batch) {
  const docDateByHeaderId = new Map(batch.headers.map(h => [h.csDocsHeadersId, h.DocDate]));
  batch.headers.forEach(h => Object.assign(h, HEADER_FIXED_VALUES));
  batch.positions.forEach(p => {
    Object.assign(p, POSITION_FIXED_VALUES);
    p.createdDate = docDateByHeaderId.get(p.csDocsHeadersId) || null;
  });
}
const { loadState, saveState, appendRunLog } = require('./lib/state');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const WZ_LIST_URL = process.env.WZ_LIST_URL ||
  'https://erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '5', 10); // tak samo ostrożnie jak w userscripcie na start

// Długość sesji jest LOSOWANA w tym przedziale przy każdym uruchomieniu —
// stała wartość (poprzednio sztywne 25 min) jest sama w sobie sygnałem
// automatyzacji: człowiek loguje się, robi swoje, wylogowuje po zmiennym
// czasie, nie co do minuty tak samo. Jeśli jeden "job" (np. 10 dni
// backfillu) nie mieści się w jednej sesji, dzielimy go na kilka —
// każde kolejne uruchomienie to nowa, osobna sesja (nowe logowanie).
const MIN_SESSION_MINUTES = parseInt(process.env.MIN_SESSION_MINUTES || '30', 10);
const MAX_SESSION_MINUTES = parseInt(process.env.MAX_SESSION_MINUTES || '60', 10);

// Ile dokumentów na jedną "paczkę" — po każdej paczce zapisujemy postęp
// (baza + plik stanu), więc padnięcie procesu w połowie kosztuje najwyżej
// jedną paczkę, nie cały przebieg. Krótszy odstęp niż kiedyś (dawniej zapis
// był tylko raz, na sam koniec całego przebiegu).
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '15', 10);

// Opcjonalny filtr daty. FILTER_DATE=YYYY-MM-DD ustawia "Od"/"Do" na TĘ SAMĄ
// datę. FILTER_DATE_FROM/FILTER_DATE_TO pozwalają ustawić różne granice
// (przydatne, dopóki nie wiemy, czy "Do" jest inkluzywne czy nie — patrz
// setDateFilter). Bez żadnej z tych zmiennych skrypt bierze cokolwiek
// pokazuje domyślny, niefiltrowany widok listy.
const FILTER_DATE_FROM = process.env.FILTER_DATE_FROM || process.env.FILTER_DATE || null;
const FILTER_DATE_TO = process.env.FILTER_DATE_TO || process.env.FILTER_DATE || null;

// Zapisany filtr ERP "WZ" — mniej stron do przewijania (patrz setDocTypeFilter).
// DOC_TYPES w scrapeWzInPage zostaje jako druga linia obrony niezależnie od tego.
const USE_DOC_TYPE_FILTER = process.env.USE_DOC_TYPE_FILTER !== 'false';

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
  const { maxDocs, headerFields, headerFieldsFromPositions, positionFields, maxSessionMs, alreadyProcessed } = opts;

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
  const completedDocNumbers = [];
  // Wznowienie: dokumenty z poprzedniego (przerwanego) przebiegu na ten sam
  // zakres dat są od razu w processedDocs — pętla ich nie otworzy ponownie,
  // tylko przewinie strony aż trafi na pierwszy, którego jeszcze nie ma.
  const processedDocs = new Set(alreadyProcessed || []);
  let consecutiveFailures = 0;
  let processed = 0;
  let pageNum = 1;

  while (processed < maxDocs && pageNum <= MAX_PAGES) {
    if (sessionTimeUp()) {
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'session_time_limit' };
    }
    if (targetRows().length === 0) {
      await waitFor(() => targetRows().length > 0, 20, 300);
    }

    const docsOnPage = targetRows().map(rowDocNumber).filter(doc => doc && !processedDocs.has(doc));

    for (const targetDoc of docsOnPage) {
      if (processed >= maxDocs) break;
      if (sessionTimeUp()) {
        return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'session_time_limit' };
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
          return { headers, positions, completedDocNumbers, docs: processed, partial: true };
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
      completedDocNumbers.push(targetDoc);
      processed++;

      const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (closeBtn) closeBtn.click();
      await waitFor(() => getVisibleListGrid());
      await humanPause(DELAY_AFTER_CLOSE);
    }

    if (processed >= maxDocs) {
      // Limit TEJ PACZKI osiągnięty — to NIE znaczy, że lista się skończyła.
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'batch_limit' };
    }

    const pager = getVisiblePager();
    if (!pagerHasNextPage(pager)) {
      // Naturalny koniec: pager mówi, że nie ma kolejnej strony. To JEDYNE
      // miejsce, gdzie wolno ustawić allPagesExhausted — reszta wyjść z tej
      // funkcji (limit paczki, limit czasu, błędy) NIE oznacza końca listy.
      return { headers, positions, completedDocNumbers, docs: processed, partial: false, allPagesExhausted: true };
    }
    if (!await goToNextPage(pager)) {
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'pagination_stuck' };
    }
    pageNum++;
  }

  // Tu trafiamy TYLKO gdy pageNum przekroczył MAX_PAGES (bezpiecznik) — to
  // NIE jest naturalny koniec listy, tylko rezygnacja z dalszego przewijania.
  return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'max_pages_safety_limit' };
}

// ---------- Zapis wyniku ----------

function loadSchemaMeta() {
  const p = path.join(__dirname, 'schema-test-tables.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Zabezpieczenie w SAMEJ BAZIE przed duplikatami — niezależnie od pliku
// stanu (lib/state.js). Jeśli coś pójdzie nie tak z plikiem stanu (albo
// ktoś odpali scraper ręcznie na ten sam zakres dwa razy), baza i tak nie
// dostanie tego samego csDocsHeadersId drugi raz. Zwraca ID-ki, które JUŻ
// są w tabeli — wywołujący filtruje nimi zarówno nagłówki, jak i pozycje
// (pozycja bez swojego nagłówka w tym przebiegu też jest pomijana, bo
// zakładamy, że trafiła do bazy razem z nim poprzednim razem).
async function findExistingHeaderIds(pool, headerIdColMeta, rows) {
  if (!rows.length) return new Set();
  const ids = rows.map(r => coerceValue(r.csDocsHeadersId, headerIdColMeta)).filter(v => v !== null);
  if (!ids.length) return new Set();
  const request = pool.request();
  const placeholders = ids.map((id, i) => { request.input('id' + i, mssqlType(headerIdColMeta), id); return '@id' + i; });
  const result = await request.query(
    'SELECT [csDocsHeadersId] AS id FROM dbo.' + F.TEST_TABLE_HEADERS + ' WHERE [csDocsHeadersId] IN (' + placeholders.join(', ') + ')'
  );
  return new Set(result.recordset.map(r => String(r.id)));
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
// DOPISUJE do pliku (nagłówek tylko przy pierwszym zapisie) — bo teraz
// zapisujemy PACZKAMI w trakcie przebiegu, nie raz na koniec; nadpisywanie
// skasowałoby wcześniejsze paczki tego samego przebiegu.
function appendCsv(filePath, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  if (!fs.existsSync(filePath)) lines.push(cols.join(';'));
  rows.forEach(r => lines.push(cols.map(c => esc(r[c])).join(';')));
  fs.appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// `label` = zakres dat (np. "2026-08-03_2026-08-03") — osobne pliki na
// zakres, żeby wznowienie tego samego dnia dopisywało do właściwego pliku,
// a nie mieszało się z danymi z zupełnie innego dnia/testu.
async function saveResult(result, label) {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const forceCsv = process.argv.includes('--csv');
  const schema = loadSchemaMeta();
  const suffix = label ? '_' + label : '';

  if (forceCsv || !DB_NAME || !schema) {
    const headersPath = path.join(__dirname, 'results-headers' + suffix + '.csv');
    const positionsPath = path.join(__dirname, 'results-positions' + suffix + '.csv');
    appendCsv(headersPath, result.headers);
    appendCsv(positionsPath, result.positions);
    console.log('[wynik]', forceCsv ? '--csv wymuszone' : (!DB_NAME ? 'DB_NAME nie ustawione' : 'brak schema-test-tables.json'),
      '— dopisano do', headersPath, 'i', positionsPath,
      '(+' + result.headers.length + ' WZ, +' + result.positions.length + ' pozycji w tej paczce, partial=' + result.partial + ')');
    return;
  }

  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  const pool = await sql.connect(config);
  try {
    const headerIdCol = schema.headers.find(c => c.COLUMN_NAME === 'csDocsHeadersId');
    const existingIds = headerIdCol ? await findExistingHeaderIds(pool, headerIdCol, result.headers) : new Set();

    const newHeaders = result.headers.filter(h => !existingIds.has(String(coerceValue(h.csDocsHeadersId, headerIdCol))));
    const newPositions = result.positions.filter(p => !existingIds.has(String(coerceValue(p.csDocsHeadersId, headerIdCol))));

    if (existingIds.size) {
      console.log('[wynik] Pominięto ' + existingIds.size + ' dokumentów, które już były w bazie (ochrona przed duplikatem).');
    }

    const insertedHeaders = await insertRows(pool, F.TEST_TABLE_HEADERS, schema.headers, newHeaders);
    const insertedPositions = await insertRows(pool, F.TEST_TABLE_POSITIONS, schema.positions, newPositions);
    console.log('[wynik] Zapisano do bazy "' + DB_NAME + '": ' + insertedHeaders + ' wierszy w ' +
      F.TEST_TABLE_HEADERS + ', ' + insertedPositions + ' wierszy w ' + F.TEST_TABLE_POSITIONS + '.');
  } finally {
    await pool.close();
  }
}

// ---------- Filtr typu dokumentu (zapisany filtr "WZ") ----------
// Domyślna lista miesza WZ z WZZ/WZZR i pewnie innymi typami — dotąd
// odsiewaliśmy to WYŁĄCZNIE po naszej stronie (DOC_TYPES w scrapeWzInPage).
// ERP ma gotowy zapisany filtr "WZ", który robi to samo po stronie serwera —
// mniej stron do przewijania, więc stosujemy oba: ten filtr ZMNIEJSZA to, co
// w ogóle trzeba pobrać, a DOC_TYPES zostaje jako druga linia obrony (gdyby
// zapisany filtr kiedyś zniknął/zmienił nazwę, scraper nadal nie weźmie
// niewłaściwego typu). Sekwencja ustalona przez nagranie kliknięć użytkownika
// (diagnostyka/sonda-klikniecia.js), nie zgadywanie.
async function setDocTypeFilter(page, label) {
  await humanClickDelay(page);
  const advFilterBtn = page.locator('.csButtonAdvancedFilter:visible').first();
  await advFilterBtn.waitFor({ timeout: 10000 });
  await advFilterBtn.click();

  await humanClickDelay(page);
  const dropdown = page.locator('.FilterList.FilterListPopupCombo:visible, .FilterList:visible').first();
  await dropdown.waitFor({ timeout: 10000 });
  await dropdown.click();

  await humanClickDelay(page);
  const option = page.locator('li.k-item:visible', { hasText: label }).first();
  await option.waitFor({ timeout: 10000 });
  await option.click();

  await humanClickDelay(page);
  const applyBtn = page.locator('.caption[title="Zastosuj"]:visible').first();
  await applyBtn.waitFor({ timeout: 10000 });

  const pagerCountBefore = await readPagerCount(page);
  await applyBtn.click();

  await page.waitForFunction((before) => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    const e = p && p.querySelector('.ResultsCountValue');
    const now = e ? (e.value || e.textContent || '').trim() : null;
    return now !== null && now !== before;
  }, pagerCountBefore, { timeout: 15000 }).catch(() => {
    console.warn('[filtr-typ] Licznik rekordów nie zmienił się w 15s po "Zastosuj" — możliwe, że filtr "' + label + '" się nie zastosował.');
  });
  await page.waitForTimeout(500);

  const pagerCountAfter = await readPagerCount(page);
  console.log('[filtr-typ] Zastosowano zapisany filtr "' + label + '". Rekordów: przed=' + pagerCountBefore + ', po=' + pagerCountAfter);
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

  // Przycisk zatwierdzający filtr NIE jest żadnym z dwóch "Pokaż" (te otwierają
  // dokument) — to ".ButtonRefresh", mała ikona (lupa) obok pola "Szukaj" w
  // panelu "ZAWĘŻANIE WYNIKÓW". Ustalone przez nagranie realnych kliknięć
  // użytkownika (diagnostyka/sonda-klikniecia.js), nie zgadywanie.
  await humanClickDelay(page);
  const pagerCountBefore = await readPagerCount(page);

  const refreshBtn = page.locator('.ButtonRefresh:visible').first();
  await refreshBtn.waitFor({ timeout: 10000 });
  await refreshBtn.click();

  await page.waitForFunction((before) => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    const e = p && p.querySelector('.ResultsCountValue');
    const now = e ? (e.value || e.textContent || '').trim() : null;
    return now !== null && now !== before;
  }, pagerCountBefore, { timeout: 15000 }).catch(() => {
    console.warn('[filtr] Licznik rekordów nie zmienił się w 15s po kliknięciu ".ButtonRefresh" — możliwe, że filtr się nie zastosował.');
  });
  await page.waitForTimeout(500);

  const pagerCountAfter = await readPagerCount(page);
  console.log('[filtr] Ustawiono zakres ' + isoDateFrom + '..' + isoDateTo + ', kliknięto ".ButtonRefresh". ' +
    'Rekordów: przed=' + pagerCountBefore + ', po=' + pagerCountAfter);
}

async function readPagerCount(page) {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    const e = p && p.querySelector('.ResultsCountValue');
    return e ? (e.value || e.textContent || '').trim() : null;
  });
}

// Sam odczyt bywa "0" albo pusty przez ułamek sekundy w trakcie przeładowania
// siatki po zmianie filtra — czekamy, aż wartość się USTABILIZUJE (dwa
// odczyty z rzędu takie same, i niezerowe), zamiast ufać pierwszemu odczytowi.
async function readPagerCountStable(page, { tries = 15, intervalMs = 400 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const now = await readPagerCount(page);
    if (now && now !== '0' && now === last) return now;
    last = now;
    await page.waitForTimeout(intervalMs);
  }
  return last; // niech i tak zwróci coś (z ostrzeżeniem u wywołującego), zamiast wisieć w nieskończoność
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
  const runStarted = Date.now();
  const dateFrom = FILTER_DATE_FROM || FILTER_DATE_TO;
  const dateTo = FILTER_DATE_TO || FILTER_DATE_FROM;
  const csvLabel = (dateFrom || dateTo) ? (dateFrom + '_' + dateTo) : null;

  // Długość TEJ sesji — losowana raz, na starcie procesu (patrz komentarz
  // przy MIN/MAX_SESSION_MINUTES).
  const sessionMinutes = MIN_SESSION_MINUTES + Math.random() * (MAX_SESSION_MINUTES - MIN_SESSION_MINUTES);
  const sessionDeadline = runStarted + sessionMinutes * 60 * 1000;
  console.log('[sesja] Długość tej sesji: ' + sessionMinutes.toFixed(1) + ' min (losowo z przedziału ' +
    MIN_SESSION_MINUTES + '-' + MAX_SESSION_MINUTES + ').');

  // Wznowienie: co już zebraliśmy dla TEGO SAMEGO zakresu dat w poprzednich
  // (być może przerwanych) przebiegach — te numery WZ nie zostaną otwarte
  // ponownie. Bez filtra dat nie ma sensownego "zakresu" do wznawiania —
  // każdy przebieg bierze cokolwiek pokazuje bieżący widok.
  const priorState = (dateFrom || dateTo) ? loadState(dateFrom, dateTo) : null;
  if (priorState && priorState.processedDocNumbers.length) {
    console.log('[wznowienie] Znaleziono stan dla ' + dateFrom + '..' + dateTo + ': ' +
      priorState.processedDocNumbers.length + ' dok. już zebranych wcześniej' +
      (priorState.complete ? ' (zakres oznaczony jako KOMPLETNY — ten przebieg nic nowego nie znajdzie).' : '.'));
  }
  const processedThisRun = new Set(priorState ? priorState.processedDocNumbers : []);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('[strona]', msg.text()));
  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  let totalHeaders = 0;
  let totalPositions = 0;
  let allPagesExhausted = false;
  let lastStoppedReason = null;
  let expectedTotal = null;
  let errorMsg = null;

  try {
    await login(page);

    await page.goto(WZ_LIST_URL, { waitUntil: 'domcontentloaded' });
    // Tak samo jak w scrapeWzInPage: siatka ładuje się asynchronicznie, więc
    // czekamy na realny sygnał (wiersz z DocNumber), nie na stan sieci.
    await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });

    if (USE_DOC_TYPE_FILTER) {
      await setDocTypeFilter(page, 'WZ');
    }

    if (dateFrom || dateTo) {
      await setDateFilter(page, dateFrom, dateTo);
    }

    // Ile ERP twierdzi, że jest dokumentów dla tego filtra — do porównania
    // na koniec z tym, ile faktycznie zebraliśmy (łącznie, przez wszystkie
    // sesje na ten zakres, nie tylko tę jedną).
    const expectedRaw = await readPagerCountStable(page);
    expectedTotal = expectedRaw ? parseInt(expectedRaw.replace(/[\s ]/g, ''), 10) : null;
    if (!expectedTotal) {
      console.warn('[wz] UWAGA: nie udało się odczytać liczby dokumentów z pagera (dostałem "' + expectedRaw + '") — kontrola na koniec przebiegu będzie pominięta.');
    }
    console.log('[wz] ERP zgłasza ' + (expectedTotal ?? '?') + ' dokumentów dla tego filtra.' +
      (priorState ? ' Mamy już ' + priorState.processedDocNumbers.length + ' z poprzednich sesji.' : ''));

    console.log('[wz] Lista załadowana. Startuję zbieranie w paczkach po ' + BATCH_SIZE + ' dok. ' +
      '(max ' + MAX_DOCS + ' łącznie w tej sesji)...');

    let collectedThisSession = 0;
    while (collectedThisSession < MAX_DOCS) {
      const remainingMs = sessionDeadline - Date.now();
      if (remainingMs <= 0) {
        lastStoppedReason = 'session_time_limit';
        break;
      }

      const batchMaxDocs = Math.min(BATCH_SIZE, MAX_DOCS - collectedThisSession);
      const batch = await page.evaluate(scrapeWzInPage, {
        maxDocs: batchMaxDocs,
        headerFields: F.HEADER_FIELDS,
        headerFieldsFromPositions: F.HEADER_FIELDS_FROM_FIRST_POSITION,
        positionFields: F.POSITION_FIELDS,
        maxSessionMs: remainingMs,
        alreadyProcessed: Array.from(processedThisRun)
      });

      applyFixedValues(batch);

      // ZAPIS OD RAZU — nie czekamy do końca sesji. Padnięcie procesu teraz
      // kosztuje najwyżej tę jedną paczkę, nie cały przebieg.
      await saveResult(batch, csvLabel);

      batch.completedDocNumbers.forEach(d => processedThisRun.add(d));
      totalHeaders += batch.headers.length;
      totalPositions += batch.positions.length;
      collectedThisSession += batch.headers.length;
      allPagesExhausted = !!batch.allPagesExhausted;
      lastStoppedReason = batch.stoppedReason || null;

      if (dateFrom || dateTo) {
        const saved = saveState(dateFrom, dateTo, {
          newDocNumbers: batch.completedDocNumbers,
          complete: allPagesExhausted,
          runSummary: {
            ts: new Date().toISOString(),
            paczkaDok: batch.headers.length,
            partial: batch.partial,
            stoppedReason: batch.stoppedReason || null
          }
        });
        console.log('[paczka] +' + batch.headers.length + ' WZ (łącznie w stanie: ' +
          saved.processedDocNumbers.length + (expectedTotal ? '/' + expectedTotal : '') + '), complete=' + saved.complete);
      }

      if (allPagesExhausted) break;
      if (batch.headers.length === 0 && !batch.partial) break; // bezpiecznik: nic nowego, a nie "koniec" — nie kręćmy się w kółko
      if (lastStoppedReason && lastStoppedReason !== 'batch_limit') break; // błąd/limit inny niż "zwykły koniec paczki" — kończymy sesję
    }

    console.log('[wz] Koniec sesji. Zebrano w tej sesji: ' + totalHeaders + ' WZ, ' + totalPositions + ' pozycji.' +
      (lastStoppedReason ? ' Powód zatrzymania: ' + lastStoppedReason + '.' : ' (lista wyczerpana).'));

    if (expectedTotal) {
      const haveTotal = processedThisRun.size;
      if (haveTotal >= expectedTotal) {
        console.log('[kontrola] ZGADZA SIĘ: mamy ' + haveTotal + ' dok., ERP zgłaszał ' + expectedTotal + '.');
      } else {
        console.warn('[kontrola] NIEKOMPLETNE: mamy ' + haveTotal + ' z ' + expectedTotal +
          ' zgłaszanych przez ERP (brakuje ' + (expectedTotal - haveTotal) + '). ' +
          (allPagesExhausted ? 'Lista była wyczerpana mimo to — sprawdź ręcznie, coś się nie zgadza.' :
            'Uruchom ponownie z tym samym filtrem, żeby dociągnąć resztę.'));
      }
    }
  } catch (err) {
    errorMsg = err.message;
    throw err;
  } finally {
    appendRunLog({
      filterDateFrom: dateFrom, filterDateTo: dateTo,
      sessionMinutes: Number(sessionMinutes.toFixed(1)),
      maxDocs: MAX_DOCS, batchSize: BATCH_SIZE,
      docsZebraneWTejSesji: totalHeaders,
      pozycjeZebraneWTejSesji: totalPositions,
      docsLacznieDlaZakresu: (dateFrom || dateTo) ? processedThisRun.size : null,
      expectedTotal,
      allPagesExhausted,
      stoppedReason: lastStoppedReason,
      czasTrwaniaMs: Date.now() - runStarted,
      blad: errorMsg
    });

    await browser.close();
    releaseLock();
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
