// Playwright: loguje się do ERP, otwiera listę PRZYJĘĆ ZEWNĘTRZNYCH (PZ) i
// klika po dokumentach — TA SAMA logika DOM co scraper WZ (automatyzacje/wz),
// tylko inny URL listy, inny typ dokumentu i inne wartości stałe per typ.
//
// Scrapuje SUROWE TEKSTY dokładnie pod nazwy kolumn dbo.csDocsHeaders /
// dbo.csDocsItemsPositions (lista pól: lib/fields.js, uzasadnienie:
// mapowanie-pol.md). Typowanie (int/decimal/data/tekst) i INSERT do MSSQL
// są sterowane metadanymi ze schema-test-tables.json (wygenerowanym przez
// generate-test-tables.js z PRAWDZIWEGO schematu tabel testowych w worek) —
// nie zgadujemy typów ręcznie w tym pliku.
//
// Bez DB_NAME / bez schema-test-tables.json wynik leci do results-*.csv
// zamiast do bazy, żeby dało się sprawdzić dane przed podpięciem zapisu.
//
// Uruchomienie:  npm install                        (raz)
//                node generate-test-tables.js         (raz, po ustaleniu DB_NAME)
//                npm run scrape

// .env: lokalny (jeśli jest) ma pierwszeństwo, wspólny automatyzacje/.env
// uzupełnia brak — jedno źródło danych DB/ERP dla wszystkich automatyzacji.
require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const F = require('./lib/fields');
const { mssqlType, coerceValue } = require('./lib/schema');
const { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES } = require('./lib/fixed-values');

// Dopisuje stałe wartości (Michał, PZ: 2026-09-17) do rekordów paczki PRZED
// zapisem — te pola nie są scrapowane z ERP (albo są scrapowane, ale
// świadomie nadpisywane — patrz lib/fields.js), to wewnętrzne flagi zależne
// od typu dokumentu (dla PZ zawsze te same). createdDate pozycji = DocDate
// jej nagłówka (reguła, nie stała — stąd osobna obsługa).
function applyFixedValues(batch) {
  const docDateByHeaderId = new Map(batch.headers.map(h => [h.csDocsHeadersId, h.DocDate]));
  batch.headers.forEach(h => Object.assign(h, HEADER_FIXED_VALUES));
  batch.positions.forEach(p => {
    Object.assign(p, POSITION_FIXED_VALUES);
    p.createdDate = docDateByHeaderId.get(p.csDocsHeadersId) || null;
  });
}
const { loadState, saveState, appendRunLog } = require('../lib-wspolne/state')(__dirname, 'pz');
const { pushLogs } = require('../lib-wspolne/git-log-push');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
// UWAGA: w przeciwieństwie do WZ/MM nie ma tu stałej *_LIST_URL — bezpośrednia
// nawigacja page.goto() na adres listy PZ zawsze ląduje z powrotem na
// dashboardzie (odkryte 2026-09-18). Dotarcie do listy wymaga kliknięcia w
// menu tak jak robi to człowiek — patrz navigateToPzList().
// TRYB OSTROŻNY: próbka 5 dokumentów do weryfikacji przez koordynatora, ZANIM
// podniesiemy limit. Po zatwierdzeniu próbki MAX_DOCS wraca do ~900 (tak samo
// jak przy WZ/MM) — ustawiane przez zmienną środowiskową, bez zmiany kodu.
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '5', 10);

// Długość sesji jest LOSOWANA w tym przedziale przy każdym uruchomieniu —
// stała wartość jest sama w sobie sygnałem automatyzacji: człowiek loguje się,
// robi swoje, wylogowuje po zmiennym czasie, nie co do minuty tak samo.
const MIN_SESSION_MINUTES = parseInt(process.env.MIN_SESSION_MINUTES || '30', 10);
const MAX_SESSION_MINUTES = parseInt(process.env.MAX_SESSION_MINUTES || '60', 10);

// Ile dokumentów na jedną "paczkę" — po każdej paczce zapisujemy postęp
// (baza + plik stanu), więc padnięcie procesu w połowie kosztuje najwyżej
// jedną paczkę, nie cały przebieg.
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '15', 10);

// Opcjonalny filtr daty. FILTER_DATE=YYYY-MM-DD ustawia "Od"/"Do" na TĘ SAMĄ
// datę. FILTER_DATE_FROM/FILTER_DATE_TO pozwalają ustawić różne granice.
// Bez żadnej z tych zmiennych skrypt bierze cokolwiek pokazuje domyślny,
// niefiltrowany widok listy. "wczoraj" jako wartość specjalna — do codziennego
// uruchamiania bez wpisywania konkretnej daty.
function resolveDateKeyword(v) {
  if (v !== 'wczoraj' && v !== 'yesterday') return v;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
const FILTER_DATE_FROM = resolveDateKeyword(process.env.FILTER_DATE_FROM || process.env.FILTER_DATE || null);
const FILTER_DATE_TO = resolveDateKeyword(process.env.FILTER_DATE_TO || process.env.FILTER_DATE || null);

// Zapisany filtr ERP typu dokumentu (jak "WZ" przy wydaniach). Sonda
// (2026-09-17) NIE znalazła zapisanego filtra o nazwie "PZ" — wtedy jedyne
// zapisane filtry na liście to "Przychody zewnętrzne" (miesza WSZYSTKIE
// podtypy: PZ, PZW, PZI, PZK, PZT, PZUE, PZZ...) i dwa "xx..." (widoki
// administracyjne). Użytkownik zapisał filtr "PZ" w ERP 2026-09-23 —
// potwierdzone na żywo: zawęża 2581 -> 2175 rekordów, wszystkie DocType="PZ".
// DOMYŚLNIE WŁĄCZONY (jak WZ) — mniej stron do przewijania. DocType w
// scanCurrentPageForDocs zostaje jako druga linia obrony niezależnie od tego
// (gdyby zapisany filtr kiedyś zniknął/zmienił nazwę).
const USE_DOC_TYPE_FILTER = process.env.USE_DOC_TYPE_FILTER !== 'false';
const PZ_DOC_TYPE_FILTER_LABEL = process.env.PZ_DOC_TYPE_FILTER_LABEL || 'PZ';

// Godziny "pracy" — poza tym oknem (i w weekendy) skrypt się NIE uruchamia,
// nawet jeśli coś go odpali (harmonogram, ręcznie, źle skonfigurowany cron).
const BUSINESS_HOURS_START = parseInt(process.env.BUSINESS_HOURS_START || '7', 10);
const BUSINESS_HOURS_END = parseInt(process.env.BUSINESS_HOURS_END || '17', 10);
const IGNORE_BUSINESS_HOURS = process.env.IGNORE_BUSINESS_HOURS === 'true';
const ALLOW_WEEKEND = process.env.ALLOW_WEEKEND === 'true'; // serwer scrapuje tez weekendy — sob/nd bywaja niepuste (patrz serwer/uruchom.bat)

function checkBusinessHours() {
  if (IGNORE_BUSINESS_HOURS) return { ok: true, reason: 'IGNORE_BUSINESS_HOURS=true — pominięto sprawdzenie' };
  const now = new Date();
  const day = now.getDay(); // 0=niedziela, 6=sobota
  const hour = now.getHours();
  if ((day === 0 || day === 6) && !ALLOW_WEEKEND) {
    return { ok: false, reason: 'weekend (dzień tygodnia=' + day + ')' };
  }
  if (hour < BUSINESS_HOURS_START || hour >= BUSINESS_HOURS_END) {
    return { ok: false, reason: 'poza godzinami ' + BUSINESS_HOURS_START + '-' + BUSINESS_HOURS_END + ' (teraz: ' + hour + ':' + String(now.getMinutes()).padStart(2, '0') + ')' };
  }
  return { ok: true, reason: null };
}

// Z sondy diagnostyka/sonda-login-form.js (2026-09-07): oba pola mają
// zduplikowane id="Input" (nieunikalne w DOM), więc idziemy po `name` —
// to jest unikalne. Przycisku logowania NIE MA w DOM — formularz łapie Enter
// w polu hasła, więc submitujemy klawiszem, nie klikiem.
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
    throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w .env — uzupełnij plik automatyzacje/pz/.env (albo wspólny automatyzacje/.env)');
  }

  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, user);
  await page.fill(LOGIN_SELECTORS.password, pass);

  // NIE czekamy na 'networkidle' — ERP non-stop odbudowuje WebSocket
  // (socket.io) w tle, więc sieć nigdy nie jest naprawdę bezczynna.
  // Czekamy na realny sygnał: adres przestaje zawierać "/logowanie/".
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(
    () => !location.href.includes('/logowanie/'),
    { timeout: 20000 }
  );

  console.log('[login] Zalogowano. URL:', page.url());
}

// ---------- Nawigacja do listy PZ (WYŁĄCZNIE przez menu, NIE przez page.goto) ----------
// Odkryte debugowaniem 2026-09-18: w przeciwieństwie do WZ i MM, bezpośrednia
// nawigacja page.goto() na adres listy PZ (nawet po "rozgrzaniu" SPA inną
// stroną) KAŻDORAZOWO ląduje z powrotem na dashboardzie (panel-sterowania/
// csdashboard) — grid się nie renderuje. Ta sama strona działa poprawnie,
// gdy dotrzeć do niej klikając w menu tak jak robi to człowiek: Logistyka -> "Przychody
// zewnętrzne" (pozycja menu Kendo, li[role="menuitem"], nie zwykły <a href>).
// Adres URL zmienia się na docelowy z opóźnieniem (asynchroniczny router) —
// stąd waitForFunction na treść URL, a nie tylko na klik.
async function navigateToPzList(page) {
  const logistykaItem = page.locator('li[role="menuitem"]', { hasText: 'Logistyka' }).first();
  await logistykaItem.waitFor({ timeout: 15000 });
  await logistykaItem.click();
  await humanClickDelay(page);

  // Wśród wielu li z tekstem "Przychody zewnętrzne" (nagłówek "Logistyka" w
  // Kendo Menu zawiera sklejony tekst WSZYSTKICH swoich pozycji potomnych)
  // wybieramy liść, którego WŁASNY tekst to dokładnie ta fraza.
  const pzItem = page.locator('li[role="menuitem"]').filter({ hasText: /^Przychody zewnętrzne$/ }).first();
  await pzItem.waitFor({ state: 'visible', timeout: 10000 });
  await pzItem.click();

  await page.waitForFunction(
    () => location.href.includes('csdocsheaders4goodsreceivednotes'),
    { timeout: 15000 }
  );
  await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });
}

// ---------- Scraping PZ (logika DOM 1:1 ze scraperem WZ) ----------
// Ta funkcja jest wstrzykiwana do przeglądarki przez page.evaluate — działa
// w kontekście strony ERP. Zwraca SUROWE STRINGI (dokładnie to, co jest w
// atrybucie title komórki) — bez parsowania liczb/dat, to robi Node po stronie,
// metadanymi ze schematu bazy.

// BŁĄD naprawiony 2026-09-18 (PZ): wcześniej JEDNO wywołanie page.evaluate()
// robiło całą wielostronicową pętlę (skanuj stronę -> otwórz pasujące ->
// kliknij "dalej" -> powtórz), potrafiąc trwać wiele minut w tej niestabilnej
// sesji ERP (ciągłe błędy WebSocket/socket.io w tle). W praktyce taki
// długo działający, ciągły skrypt w przeglądarce kończył się przedwcześnie
// (funkcja zwracała allPagesExhausted mimo dalszych stron z dziesiątkami
// pasujących dokumentów) — powtarzalne na żywym ERP, przyczyna nieustalona
// (podejrzenie: coś w środowisku psuje długo trwające page.evaluate).
// Niezależne, KRÓTKIE wywołania page.evaluate() z Node (jedno na stronę)
// działały niezawodnie w tych samych warunkach. Dlatego funkcja jest
// rozbita na dwie: scanCurrentPageForDocs (skanuje/otwiera dokumenty
// WYŁĄCZNIE na aktualnie załadowanej stronie, nic nie klika w pagerze) i
// advanceToNextPage (osobne, krótkie wywołanie — tylko klik "dalej" +
// czekanie na zmianę treści). Node (main()) woła je na przemian w pętli.
//
// Dodatkowy błąd naprawiony przy okazji: `rowsChanged` w dawnym
// goToNextPage porównywał tylko wiersze typu PZ (targetRows()), nie
// wszystkie wiersze strony (listRows()) — na stronie bez żadnego "PZ"
// (lista miesza PZ/PZK/PZUE/PZZ/...) dawało to fałszywe "brak zmiany"
// (''===''), mimo realnego przejścia strony.

async function scanCurrentPageForDocs(opts) {
  const { maxDocs, headerFields, headerFieldsFromPositions, positionFields, maxSessionMs, alreadyProcessed } = opts;

  // Lista "przychody-zewnetrzne" miesza podtypy (PZ, PZW, PZI, PZK, PZT,
  // PZUE, PZZ, PZZk, PZZR...) — bierzemy TYLKO "PZ" (Przyjęcie zewnętrzne),
  // dokładnie jak WZ brało tylko "WZ", nie "WZZ". Filtrujemy po kolumnie
  // `DocType` (potwierdzone sondą 2026-09-17: DocType="PZ" na przykładowym
  // dokumencie, DocTypeTranslatedDesc="Przyjęcie zewnętrzne") — czystszy
  // sygnał niż pogrubiony tekst (WZ) albo csDocsTypesId (MM), bo to gotowy
  // tekstowy skrót typu, nie wymaga normalizacji ani stałej per instalację.
  const DOC_TYPE = 'PZ';
  const MAX_CONSECUTIVE_FAILURES = 3;

  const DELAY_AFTER_OPEN = [400, 1100];
  const DELAY_AFTER_CLOSE = [350, 900];
  const LONG_PAUSE_CHANCE = 0.12;
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
  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }
  function rowDocType(row) { return cellTitle(row, 'DocType'); }
  function rowDocNumber(row) { return cellTitle(row, 'DocNumber') || null; }
  function targetRows() { return listRows().filter(r => rowDocType(r) === DOC_TYPE); }

  function extractHeaderRaw(row) {
    const rec = {};
    headerFields.forEach(f => { rec[f] = cellTitle(row, f); });
    return rec;
  }

  function extractPositionsRaw(headerId) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      // Filtr "czy to realny wiersz pozycji": jak przy WZ, musi mieć SKU
      // (pogrubiony fragment w ItemDesc) — potwierdzone sondą 2026-09-17.
      const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
      const skuEl = descCell ? descCell.querySelector('.cs-style-text-bold') : null;
      if (!skuEl || !(skuEl.textContent || '').trim()) return null;

      const rec = {};
      positionFields.forEach(f => { rec[f] = cellTitle(row, f); });
      rec.csDocsHeadersId = headerId;
      return rec;
    }).filter(Boolean);
  }

  function pagerHasNextPageOnce() {
    const pager = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    if (!pager) return false;
    const next = pager.querySelector('.NextPageButton');
    return !!next && !next.className.split(/\s+/).includes('inactive');
  }
  // Odczyt pagera bywa niestabilny (chwilowy stan DOM w tej ciężkiej siatce,
  // 378 pól/wiersz) — POJEDYNCZY odczyt "false" potrafi być fałszywy, co
  // przedwcześnie kończyłoby skanowanie z allPagesExhausted mimo dalszych
  // stron. Dwa zgodne odczyty z rzędu (z krótką przerwą) zamiast jednego.
  async function pagerHasNextPage() {
    const first = pagerHasNextPageOnce();
    if (first) return true;
    await sleep(400);
    return pagerHasNextPageOnce();
  }

  const headers = [];
  const positions = [];
  const completedDocNumbers = [];
  const processedDocs = new Set(alreadyProcessed || []);
  let consecutiveFailures = 0;
  let processed = 0;

  if (targetRows().length === 0) {
    await waitFor(() => listRows().length > 0, 20, 300);
  }

  const docsOnPage = targetRows().map(rowDocNumber).filter(doc => doc && !processedDocs.has(doc));

  for (const targetDoc of docsOnPage) {
    if (processed >= maxDocs) break;
    if (sessionTimeUp()) {
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'session_time_limit', hasNextPage: await pagerHasNextPage() };
    }

    const row = targetRows().find(r => rowDocNumber(r) === targetDoc);
    if (!row) continue;

    processedDocs.add(targetDoc);
    const headerRec = extractHeaderRaw(row);
    const headerId = headerRec.csDocsHeadersId;

    // BŁĄD naprawiony 2026-09-18: przycisk otwierający dokument NIE jest w
    // komórce DocNumber (ta jest zwykłym tekstem, bez elementu klikalnego w
    // tym widoku) — jest w komórce DocDate, pierwszy .csButtonAction (drugi
    // .csButtonAction w tej samej komórce to link "Nr dok.", inna akcja).
    // Potwierdzone zrzutem HTML: <td data-datafield="DocDate">...<div
    // class="...csButtonAction...">2026/PZZR/.../000139 [Pokaż]</div>
    // <div class="...csButtonAction...">Nr dok. [Pokaż]</div>...</td>.
    const btn = row.querySelector('td[data-datafield="DocDate"] .csButtonAction');
    if (!btn) continue;

    btn.click();

    const grid = await waitFor(() => getVisiblePositionsGrid());
    if (!grid) {
      consecutiveFailures++;
      const stray = document.querySelector('li.k-state-active .csCloseButton_span');
      if (stray) stray.click();
      await waitFor(() => getVisibleListGrid());
      await sleep(jitter(DELAY_AFTER_CLOSE) * consecutiveFailures);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return { headers, positions, completedDocNumbers, docs: processed, partial: true, hasNextPage: await pagerHasNextPage() };
      }
      continue;
    }

    consecutiveFailures = 0;
    await humanPause(DELAY_AFTER_OPEN);

    const posRows = extractPositionsRaw(headerId);

    // Dla PZ headerFieldsFromPositions jest PUSTE (wszystkie pola nagłówka
    // są wprost w gridzie listy — patrz lib/fields.js) — ta pętla nic nie
    // dokłada, zostaje jako punkt zaczepienia wspólny z WZ.
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

  return {
    headers, positions, completedDocNumbers, docs: processed,
    partial: processed >= maxDocs,
    stoppedReason: processed >= maxDocs ? 'batch_limit' : null,
    hasNextPage: await pagerHasNextPage()
  };
}

// Osobne, KRÓTKIE wywołanie: tylko klik "dalej" + czekanie na realną zmianę
// treści strony (nie tylko numeru strony — ERP potrafi zaktualizować numer
// strony zanim doładuje wiersze, patrz historia WZ 2026-09-10). Porównanie
// idzie po WSZYSTKICH wierszach strony (nie tylko dopasowanych do filtra
// typu) — patrz komentarz nad scanCurrentPageForDocs wyżej.
async function advanceToNextPage() {
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
  function cellTitle(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    return c ? (c.getAttribute('title') || '') : '';
  }
  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }
  function rowDocNumber(row) { return cellTitle(row, 'DocNumber') || null; }
  function getVisiblePager() {
    return Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null) || null;
  }

  const pager = getVisiblePager();
  if (!pager) return false;
  const next = pager.querySelector('.NextPageButton');
  if (!next || next.className.split(/\s+/).includes('inactive')) return false;

  const pageNoBefore = pager.querySelector('.ActivePageNoInput');
  const beforeVal = pageNoBefore ? pageNoBefore.value : null;
  const rowsBefore = listRows().map(rowDocNumber).join('|');

  const pageChanged = () => {
    const p = getVisiblePager();
    const inp = p && p.querySelector('.ActivePageNoInput');
    return inp && inp.value !== beforeVal;
  };
  const rowsChanged = () => {
    const now = listRows().map(rowDocNumber).join('|');
    return now.length > 0 && now !== rowsBefore;
  };

  next.click();
  if (!await waitFor(pageChanged, 40, 250)) return false;
  if (!await waitFor(rowsChanged, 60, 250)) return false;

  await sleep(500 + Math.random() * 900);
  return true;
}

// ---------- Zapis wyniku ----------

function loadSchemaMeta() {
  const p = path.join(__dirname, 'schema-test-tables.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Zabezpieczenie w SAMEJ BAZIE przed duplikatami — niezależnie od pliku
// stanu (lib/state.js).
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
// (mssqlType/coerceValue z lib/schema.js).
async function insertRows(pool, tableName, columnsMeta, rows) {
  if (!rows.length) return 0;
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

// Prosty CSV (średnik jako separator). DOPISUJE do pliku (nagłówek tylko przy
// pierwszym zapisie) — zapisujemy PACZKAMI w trakcie przebiegu.
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
      '(+' + result.headers.length + ' PZ, +' + result.positions.length + ' pozycji w tej paczce, partial=' + result.partial + ')');
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

// ---------- Filtr typu dokumentu (zapisany filtr) ----------
// Dla PZ domyślnie WYŁĄCZONY (sonda nie znalazła zapisanego filtra "PZ") —
// zostaje dostępny, gdyby ktoś kiedyś taki filtr dodał w ERP. Sekwencja
// kliknięć identyczna jak przy WZ (diagnostyka/sonda-klikniecia.js).
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

async function setDateFilter(page, isoDateFrom, isoDateTo) {
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

async function readPagerCountStable(page, { tries = 15, intervalMs = 400 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const now = await readPagerCount(page);
    if (now && now !== '0' && now === last) return now;
    last = now;
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

async function humanClickDelay(page) {
  await page.waitForTimeout(300 + Math.random() * 500);
}

// ---------- Główny przebieg ----------

// Jedna aktywna sesja na raz — nigdy dwie równoległe wobec tego samego ERP.
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
  const hours = checkBusinessHours();
  if (!hours.ok) {
    console.log('[godziny-pracy] Odmowa startu: ' + hours.reason + '. (Ustaw IGNORE_BUSINESS_HOURS=true, żeby świadomie to obejść.)');
    return;
  }

  acquireLock();
  const runStarted = Date.now();
  const dateFrom = FILTER_DATE_FROM || FILTER_DATE_TO;
  const dateTo = FILTER_DATE_TO || FILTER_DATE_FROM;
  const csvLabel = (dateFrom || dateTo) ? (dateFrom + '_' + dateTo) : null;

  const sessionMinutes = MIN_SESSION_MINUTES + Math.random() * (MAX_SESSION_MINUTES - MIN_SESSION_MINUTES);
  const sessionDeadline = runStarted + sessionMinutes * 60 * 1000;
  console.log('[sesja] Długość tej sesji: ' + sessionMinutes.toFixed(1) + ' min (losowo z przedziału ' +
    MIN_SESSION_MINUTES + '-' + MAX_SESSION_MINUTES + ').');

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

    await navigateToPzList(page);

    if (USE_DOC_TYPE_FILTER) {
      await setDocTypeFilter(page, PZ_DOC_TYPE_FILTER_LABEL);
    }

    if (dateFrom || dateTo) {
      await setDateFilter(page, dateFrom, dateTo);
    }

    // Ile ERP twierdzi, że jest dokumentów dla tego filtra — UWAGA: bez
    // zapisanego filtra typu ten licznik obejmuje WSZYSTKIE podtypy PZ*, nie
    // tylko "PZ" — kontrola na końcu przebiegu (haveTotal vs expectedTotal)
    // będzie więc zaniżona względem realnie zebranych "czystych" PZ. Zostaje
    // jako orientacyjny sygnał, nie twardy dowód kompletności.
    const expectedRaw = await readPagerCountStable(page);
    // Rozróżniamy "pager pokazał 0" (dzień pusty — poprawny wynik) od "nie
    // dało się odczytać pagera" (null — kontrola pominięta). Wcześniej oba
    // wpadały w to samo `!expectedTotal` i 0 udawało błąd odczytu.
    const expectedParsed = (expectedRaw != null && String(expectedRaw).trim() !== '')
      ? parseInt(String(expectedRaw).replace(/[\s ]/g, ''), 10) : NaN;
    expectedTotal = Number.isNaN(expectedParsed) ? null : expectedParsed;
    if (expectedTotal === null) {
      console.warn('[pz] UWAGA: nie udało się odczytać liczby dokumentów z pagera (dostałem "' + expectedRaw + '") — kontrola na koniec przebiegu będzie pominięta.');
    }
    console.log('[pz] ERP zgłasza ' + (expectedTotal ?? '?') + ' dokumentów dla tego filtra (WSZYSTKIE podtypy PZ*, bez zapisanego filtra typu).' +
      (priorState ? ' Mamy już ' + priorState.processedDocNumbers.length + ' z poprzednich sesji.' : ''));

    console.log('[pz] Lista załadowana. Startuję zbieranie w paczkach po ' + BATCH_SIZE + ' dok. ' +
      '(max ' + MAX_DOCS + ' łącznie w tej sesji)...');

    // Pętla iteruje PO STRONACH listy, nie po "paczkach" rozmiaru BATCH_SIZE —
    // każde wywołanie page.evaluate() ogranicza się do JEDNEJ, aktualnie
    // załadowanej strony (patrz komentarz nad scanCurrentPageForDocs), żeby
    // uniknąć długo trwających, niestabilnych wywołań w tej sesji ERP.
    // BATCH_SIZE nadal ogranicza, ile dokumentów otwieramy w JEDNYM
    // wywołaniu (dopóki starczy ich na bieżącej stronie).
    // Pusty dzień (ERP zgłasza 0 dokumentów) to KOMPLETNY wynik, nie błąd —
    // bez tego pętla poniżej kończyła się z 'pagination_stuck' na pustej
    // siatce i dzień raportował allPagesExhausted=false. Backfill (zewnętrzna
    // pętla ponawiająca do skutku) mielił wtedy pusty dzień w kółko. Pustkę
    // stwierdzamy z licznika ERP, nie z założenia o dniu tygodnia.
    if (expectedTotal === 0) {
      allPagesExhausted = true;
      console.log('[pz] ERP zgłasza 0 dokumentów dla tego filtra — dzień pusty, zaliczam jako kompletny.');
      if (dateFrom || dateTo) {
        saveState(dateFrom, dateTo, {
          complete: true,
          runSummary: { ts: new Date().toISOString(), paczkaDok: 0, partial: false, stoppedReason: null }
        });
      }
    }

    let collectedThisSession = 0;
    while (!allPagesExhausted && collectedThisSession < MAX_DOCS) {
      const remainingMs = sessionDeadline - Date.now();
      if (remainingMs <= 0) {
        lastStoppedReason = 'session_time_limit';
        break;
      }

      const batchMaxDocs = Math.min(BATCH_SIZE, MAX_DOCS - collectedThisSession);
      const batch = await page.evaluate(scanCurrentPageForDocs, {
        maxDocs: batchMaxDocs,
        headerFields: F.HEADER_FIELDS,
        headerFieldsFromPositions: F.HEADER_FIELDS_FROM_FIRST_POSITION,
        positionFields: F.POSITION_FIELDS,
        maxSessionMs: remainingMs,
        alreadyProcessed: Array.from(processedThisRun)
      });

      applyFixedValues(batch);
      await saveResult(batch, csvLabel);

      batch.completedDocNumbers.forEach(d => processedThisRun.add(d));
      totalHeaders += batch.headers.length;
      totalPositions += batch.positions.length;
      collectedThisSession += batch.headers.length;
      // "Wyczerpane" dopiero gdy bieżąca (ostatnia zeskanowana) strona nie ma
      // kolejnej — samo `docs===0` na TEJ stronie nic nie mówi o reszcie listy
      // (lista miesza podtypy, strona bez "PZ" jest normalna, patrz wyżej).
      allPagesExhausted = !batch.hasNextPage;
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
        console.log('[strona] +' + batch.headers.length + ' PZ (łącznie w stanie: ' +
          saved.processedDocNumbers.length + (expectedTotal ? '/' + expectedTotal : '') + '), complete=' + saved.complete);
      }

      if (collectedThisSession >= MAX_DOCS) { lastStoppedReason = 'batch_limit'; break; }
      if (lastStoppedReason === 'session_time_limit') break;
      if (allPagesExhausted) break;

      const advanced = await page.evaluate(advanceToNextPage);
      if (!advanced) { lastStoppedReason = 'pagination_stuck'; break; }
    }

    console.log('[pz] Koniec sesji. Zebrano w tej sesji: ' + totalHeaders + ' PZ, ' + totalPositions + ' pozycji.' +
      (lastStoppedReason ? ' Powód zatrzymania: ' + lastStoppedReason + '.' : ' (lista wyczerpana).'));

    if (expectedTotal) {
      const haveTotal = processedThisRun.size;
      if (haveTotal >= expectedTotal) {
        console.log('[kontrola] ZGADZA SIĘ: mamy ' + haveTotal + ' dok., ERP zgłaszał ' + expectedTotal + '.');
      } else {
        console.warn('[kontrola] NIEKOMPLETNE wg licznika ERP (uwzględnia WSZYSTKIE podtypy PZ*): mamy ' + haveTotal + ' z ' + expectedTotal +
          '. Jeśli lista zawiera dokumenty innych podtypów (PZW/PZI/PZK/...), różnica jest OCZEKIWANA — ' +
          'to nie musi być błąd. ' +
          (allPagesExhausted ? 'Lista była wyczerpana mimo to.' : 'Uruchom ponownie z tym samym filtrem, żeby dociągnąć resztę.'));
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
    pushLogs('pz', dateFrom ? (dateFrom + '..' + dateTo) : null);
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
