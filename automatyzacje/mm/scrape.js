// Playwright: loguje się do ERP, otwiera listę PRZESUNIĘĆ MAGAZYNOWYCH (MM)
// i klika po dokumentach — TA SAMA logika DOM co scraper WZ (automatyzacje/wz),
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

// Dopisuje stałe wartości (Michał, MM: 2026-09-15) do rekordów paczki PRZED
// zapisem — te pola nie są scrapowane z ERP, to wewnętrzne flagi zależne od
// typu dokumentu (dla MM zawsze te same). createdDate pozycji = DocDate jej
// nagłówka (reguła, nie stała — stąd osobna obsługa).
function applyFixedValues(batch) {
  const docDateByHeaderId = new Map(batch.headers.map(h => [h.csDocsHeadersId, h.DocDate]));
  batch.headers.forEach(h => Object.assign(h, HEADER_FIXED_VALUES));
  batch.positions.forEach(p => {
    Object.assign(p, POSITION_FIXED_VALUES);
    p.createdDate = docDateByHeaderId.get(p.csDocsHeadersId) || null;
  });
}
const { loadState, saveState, appendRunLog } = require('../lib-wspolne/state')(__dirname, 'mm');
const { pushLogs } = require('../lib-wspolne/git-log-push');
const powiadomORozbieznosciach = require('../lib-wspolne/powiadom');

// ---------- Konfiguracja ----------

const HEADLESS = process.env.HEADLESS === 'true'; // domyślnie WIDOCZNA przeglądarka
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
// Lista przesunięć magazynowych. URL od Michała miał na końcu id konkretnego
// widoku (/213217693) — do listy wystarcza ścieżka typu dokumentu, bez id.
const MM_LIST_URL = process.env.MM_LIST_URL ||
  'https://erp.savpol.pl/pl/przesuniecia-magazynowe/csdocsheaders4goodstransfers';
// Limit dokumentów na sesję. Michał zatwierdził MM do produkcji 2026-09-29
// (próbka OK), więc limit produkcyjny 900 — jak WZ. Realny dzień MM to ~kilka-
// dziesiąt dok., więc 900 z zapasem domyka pełny dzień (complete=true), czego
// wymaga orkiestrator nadganiania (lib-wspolne/catchup.js). Próbkę na mniejszą
// liczbę robi się jawnie przez MAX_DOCS=5 w env.
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '900', 10);

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

// Zapisany filtr ERP typu dokumentu. Lista przesunięć MIESZA podtypy (MM +
// "Usunięcie blokady" + "Blokada"), więc bez tego filtra scraper przewija masę
// cudzych dokumentów, żeby wyłuskać MM. Użytkownik zapisał w ERP filtr "MM"
// (zawęża serwerowo do csDocsTypesId=269000798 — potwierdzone 2026-09-23:
// 2719 → 634 rekordów, strona czysto MM). DOMYŚLNIE WŁĄCZONY. Filtr po naszej
// stronie (csDocsTypesId w scrapeMmInPage) zostaje jako druga linia obrony,
// gdyby zapisany filtr kiedyś zniknął/zmienił nazwę.
const USE_DOC_TYPE_FILTER = process.env.USE_DOC_TYPE_FILTER !== 'false';
const MM_DOC_TYPE_FILTER_LABEL = process.env.MM_DOC_TYPE_FILTER_LABEL || 'MM';

// Lista przesunięć miesza podtypy — potwierdzone na żywym ERP (2026-09-15):
//   269000798 = "Przesunięcie magazynowe"        <- NASZE
//   410690539 = "Usunięcie blokady produktu"     <- odrzucamy
// Typ NIE jest pogrubiony w kolumnie DocNumber (jak przy WZ), więc filtrujemy
// po wartości csDocsTypesId (stabilne id, nie zlokalizowana nazwa). Wartość w
// gridzie ma spacje jako separatory tysięcy ("269 000 798") — normalizujemy.
const MM_DOC_TYPE_ID = (process.env.MM_DOC_TYPE_ID || '269000798').replace(/\s/g, '');

// Cel zapisu. DOMYŚLNIE tabele testowe (*_test) — bezpieczne. SCRAPE_TARGET=prod
// przełącza na produkcyjne csDocsHeaders/csDocsItemsPositions. Dla MM koordynator
// (Michał) zatwierdził produkcję 2026-09-29 (zakres 2026-07-25→dziś). Wzorzec
// 1:1 z wz/scrape.js.
const WRITE_TO_PROD = process.env.SCRAPE_TARGET === 'prod';
const TARGET_HEADERS = WRITE_TO_PROD ? F.PROD_TABLE_HEADERS : F.TEST_TABLE_HEADERS;
const TARGET_POSITIONS = WRITE_TO_PROD ? F.PROD_TABLE_POSITIONS : F.TEST_TABLE_POSITIONS;

// Godziny "pracy" — poza tym oknem (i w weekendy) skrypt się NIE uruchamia.
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
    throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w .env — uzupełnij plik automatyzacje/mm/.env');
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

// ---------- Scraping MM (logika DOM 1:1 ze scraperem WZ) ----------
// Ta funkcja jest wstrzykiwana do przeglądarki przez page.evaluate — działa
// w kontekście strony ERP. Zwraca SUROWE STRINGI (dokładnie to, co jest w
// atrybucie title komórki) — bez parsowania liczb/dat, to robi Node po stronie,
// metadanymi ze schematu bazy.

async function scrapeMmInPage(opts) {
  const { maxDocs, headerFields, headerFieldsFromPositions, positionFields, maxSessionMs, alreadyProcessed, docTypeId } = opts;

  const DOC_TYPE_ID = docTypeId; // csDocsTypesId dokumentów, które bierzemy (MM)
  const normId = s => (s || '').replace(/\s/g, '');
  const MAX_PAGES = 100;
  const MAX_CONSECUTIVE_FAILURES = 3;

  const DELAY_AFTER_OPEN = [400, 1100];
  const DELAY_AFTER_CLOSE = [350, 900];
  const DELAY_AFTER_PAGE = [500, 1400];
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
  // MM: typ dokumentu bierzemy z kolumny csDocsTypesId (NIE z pogrubionego
  // prefiksu DocNumber — w MM go nie ma). Porównujemy po znormalizowanym id.
  function rowDocTypeId(row) { return normId(cellTitle(row, 'csDocsTypesId')); }
  function rowDocNumber(row) { return cellTitle(row, 'DocNumber') || null; }
  function targetRows() { return listRows().filter(r => rowDocTypeId(r) === DOC_TYPE_ID); }

  // Rekord nagłówka: surowe stringi pod dokładnie te nazwy pól z Node.
  function extractHeaderRaw(row) {
    const rec = {};
    headerFields.forEach(f => { rec[f] = cellTitle(row, f); });
    return rec;
  }

  // Pozycje: surowe stringi pod nazwy z positionFields. csDocsHeadersId
  // pozycji NADPISUJEMY wartością z nagłówka (link do dokumentu), żeby FK się
  // trzymał 1:1.
  function extractPositionsRaw(headerId) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      // Filtr "czy to realny wiersz pozycji". W MM ItemDesc NIE ma pogrubienia
      // (inaczej niż WZ) — nazwa/SKU to zwykły tekst w atrybucie title. Realny
      // wiersz rozpoznajemy po niepustym ItemDesc + niepustym csItemsId
      // (technicznych/pustych wierszy siatki tak nie ma).
      const itemDesc = cellTitle(row, 'ItemDesc');
      const itemId = cellTitle(row, 'csItemsId');
      if (!itemDesc.trim() || !itemId.trim()) return null;

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
  // Czekamy, aż treść wierszy (nie tylko numer strony) FAKTYCZNIE się zmieni,
  // zanim uznamy przejście strony za zakończone (bug naprawiony przy WZ
  // 2026-09-10: ERP aktualizuje numer strony zanim doładuje wiersze).
  //
  // BŁĄD naprawiony 2026-09-18: porównanie musi iść po WSZYSTKICH wierszach
  // strony (listRows()), NIE po targetRows() (tylko dopasowane do
  // MM_DOC_TYPE_ID). Lista miesza "Przesunięcie magazynowe" z "Usunięcie
  // blokady produktu" — strona bez ŻADNEGO przesunięcia ma targetRows()===[]
  // PRZED i CZĘSTO TAKŻE PO przejściu, więc rowsChanged() oparte na
  // targetRows() fałszywie widziało "brak zmiany" (''===''), mimo realnego
  // przejścia strony — pętla kończyła się przedwcześnie z allPagesExhausted
  // i częściowym/zerowym wynikiem, bez błędu w logu. Znalezione i naprawione
  // przy analogicznym scraperze PZ (automatyzacje/pz/scrape.js), ten sam wzorzec
  // kodu tu i w automatyzacje/wz/scrape.js.
  async function goToNextPage(pager) {
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

    const next = pager.querySelector('.NextPageButton');
    if (!next) return false;

    next.click();
    if (!await waitFor(pageChanged, 40, 250)) return false;
    if (!await waitFor(rowsChanged, 60, 250)) {
      return false;
    }

    await humanPause(DELAY_AFTER_PAGE);
    return true;
  }

  const headers = [];
  const positions = [];
  const completedDocNumbers = [];
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
      // DocGrossWeight, csWarehousesIdDel) — bierzemy z PIERWSZEJ pozycji.
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
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'batch_limit' };
    }

    const pager = getVisiblePager();
    if (!pagerHasNextPage(pager)) {
      return { headers, positions, completedDocNumbers, docs: processed, partial: false, allPagesExhausted: true };
    }
    if (!await goToNextPage(pager)) {
      return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'pagination_stuck' };
    }
    pageNum++;
  }

  return { headers, positions, completedDocNumbers, docs: processed, partial: true, stoppedReason: 'max_pages_safety_limit' };
}

// ---------- Zapis wyniku ----------

function loadSchemaMeta() {
  const p = path.join(__dirname, 'schema-test-tables.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function findExistingHeaderIds(pool, headerIdColMeta, rows) {
  if (!rows.length) return new Set();
  const ids = rows.map(r => coerceValue(r.csDocsHeadersId, headerIdColMeta)).filter(v => v !== null);
  if (!ids.length) return new Set();
  const request = pool.request();
  const placeholders = ids.map((id, i) => { request.input('id' + i, mssqlType(headerIdColMeta), id); return '@id' + i; });
  const result = await request.query(
    'SELECT [csDocsHeadersId] AS id FROM dbo.' + TARGET_HEADERS + ' WHERE [csDocsHeadersId] IN (' + placeholders.join(', ') + ')'
  );
  return new Set(result.recordset.map(r => String(r.id)));
}

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

// ---------- Aktualizacja istniejących (dokument zmieniony w ERP po scrapie) ----------
// Wymaganie Lecha (2026-09-30): gdy dokument jest już w worku, a dane z ERP się
// różnią, AKTUALIZUJEMY rekord i wypisujemy zmianę w logu. Wcześniej dedup po
// csDocsHeadersId tylko dopisywał, więc edycja w ERP (np. zmiana DocDate)
// nie schodziła do worka. Patrz też: pamięć [[dedup-insert-only-edycje-erp]].

// Kolumny nagłówka do PORÓWNANIA/UPDATE: scrapowane, nie wyliczane, nie klucz i
// nie stałe (HEADER_FIXED_VALUES są stałe per typ — zawsze równe, nie ma sensu
// ich porównywać/aktualizować).
const HEADER_FIXED_SET = new Set(F.HEADER_FIXED_FIELDS);
function comparableHeaderColumns(columnsMeta) {
  return columnsMeta.filter(c => !c.IS_COMPUTED
    && c.COLUMN_NAME !== 'csDocsHeadersId'
    && !HEADER_FIXED_SET.has(c.COLUMN_NAME));
}

// Równość wg TYPU kolumny — normalizacja, żeby nie robić fałszywych różnic:
// data z/bez czasu, decimal jako string vs number, bigint bez utraty precyzji.
// newVal jest już SKOERCOWANY (coerceValue), oldVal to wartość z bazy.
function valuesEqual(oldVal, newVal, col) {
  const empty = (v) => v === null || v === undefined || v === '';
  if (empty(oldVal) && empty(newVal)) return true;
  if (empty(oldVal) || empty(newVal)) return false;
  switch (col.DATA_TYPE) {
    case 'date': case 'datetime': case 'datetime2': case 'smalldatetime': {
      const d = (v) => (v instanceof Date ? v : new Date(v));
      const a = d(oldVal), b = d(newVal);
      if (isNaN(a.getTime()) || isNaN(b.getTime())) return String(oldVal) === String(newVal);
      return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    }
    case 'int': case 'bigint': case 'smallint': case 'tinyint': {
      const norm = (v) => (typeof v === 'number' ? String(Math.trunc(v)) : String(v).replace(/\s/g, '').trim());
      return norm(oldVal) === norm(newVal);
    }
    case 'decimal': case 'numeric': case 'float': case 'real': case 'money': case 'smallmoney': {
      const a = Number(oldVal), b = Number(newVal);
      if (isNaN(a) || isNaN(b)) return String(oldVal) === String(newVal);
      return Math.abs(a - b) < 1e-6;
    }
    case 'bit':
      return (Number(oldVal) ? 1 : 0) === (Number(newVal) ? 1 : 0);
    case 'uniqueidentifier':
      // GUID jest case-insensitive: baza zwraca WIELKIMI literami, ERP renderuje
      // małymi — ten sam identyfikator. Bez tego KAŻDY dokument fałszywie
      // "różniłby się" na csDocsHeadersG i był bez sensu aktualizowany.
      return String(oldVal).toLowerCase() === String(newVal).toLowerCase();
    default:
      return String(oldVal).trim() === String(newVal).trim();
  }
}

function diffHeader(scrapedRow, dbRow, columnsMeta) {
  const empty = (v) => v === null || v === undefined || v === '';
  const diffs = [];
  for (const col of comparableHeaderColumns(columnsMeta)) {
    const name = col.COLUMN_NAME;
    const newVal = coerceValue(scrapedRow[name], col);
    // OCHRONA: nie nadpisuj niepustej wartości w bazie scrapowanym PUSTYM.
    // Puste pole ze scrapowania to niemal zawsze "kolumna nie renderowała się w
    // gridzie" (zły układ listy), a nie "wyczyszczono w ERP". Bez tego jedna
    // wyłączona kolumna wyzerowałaby to pole we WSZYSTKICH dokumentach. Realne
    // czyszczenie pola w ERP jest rzadkie — świadomie je tu pomijamy.
    if (empty(newVal) && !empty(dbRow[name])) continue;
    if (!valuesEqual(dbRow[name], newVal, col)) diffs.push({ field: name, old: dbRow[name], new: newVal });
  }
  return diffs;
}

// Pobiera z bazy istniejące wiersze nagłówków (komplet kolumn) po ID — do
// porównania z tym, co zescrapowano.
async function fetchExistingHeaders(pool, headerIdColMeta, columnsMeta, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const cols = columnsMeta.map(c => '[' + c.COLUMN_NAME + ']').join(', ');
  const request = pool.request();
  const ph = ids.map((id, i) => { request.input('h' + i, mssqlType(headerIdColMeta), id); return '@h' + i; });
  const rs = await request.query('SELECT ' + cols + ' FROM dbo.' + TARGET_HEADERS + ' WHERE [csDocsHeadersId] IN (' + ph.join(', ') + ')');
  rs.recordset.forEach(r => map.set(String(r.csDocsHeadersId), r));
  return map;
}

// Liczba pozycji w bazie per csDocsHeadersId — do wykrycia rozbieżności liczby
// pozycji (pełnego porównania pól pozycji nie robimy). Zwraca Map(idString -> n).
async function fetchPositionCounts(pool, headerIdColMeta, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const request = pool.request();
  const ph = ids.map((id, i) => { request.input('c' + i, mssqlType(headerIdColMeta), id); return '@c' + i; });
  const rs = await request.query('SELECT [csDocsHeadersId] AS id, COUNT(*) AS n FROM dbo.' + TARGET_POSITIONS +
    ' WHERE [csDocsHeadersId] IN (' + ph.join(', ') + ') GROUP BY [csDocsHeadersId]');
  rs.recordset.forEach(r => map.set(String(r.id), r.n));
  return map;
}

function fmtVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

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
      '(+' + result.headers.length + ' MM, +' + result.positions.length + ' pozycji w tej paczce, partial=' + result.partial + ')');
    return { insertedHeaders: 0, insertedPositions: 0, rozbieznosci: [], rozbHeaders: 0, rozbPoz: 0, unchanged: 0 };
  }

  const config = {
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  };
  const pool = await sql.connect(config);
  try {
    const headerIdCol = schema.headers.find(c => c.COLUMN_NAME === 'csDocsHeadersId');
    const idStr = (r) => String(coerceValue(r.csDocsHeadersId, headerIdCol));
    const existingIds = headerIdCol ? await findExistingHeaderIds(pool, headerIdCol, result.headers) : new Set();

    const newHeaders = result.headers.filter(h => !existingIds.has(idStr(h)));
    const existingHeaders = result.headers.filter(h => existingIds.has(idStr(h)));
    const newPositions = result.positions.filter(p => !existingIds.has(idStr(p)));

    if (WRITE_TO_PROD) {
      console.log('[wynik] UWAGA: zapis do tabel PRODUKCYJNYCH (' + TARGET_HEADERS + '/' + TARGET_POSITIONS + ').');
    }

    const insertedHeaders = await insertRows(pool, TARGET_HEADERS, schema.headers, newHeaders);
    const insertedPositions = await insertRows(pool, TARGET_POSITIONS, schema.positions, newPositions);

    // Dokumenty już w bazie: NIE ZMIENIAMY rekordu (decyzja Lecha 2026-09-30 —
    // do worka tylko DOPISUJEMY). Porównujemy nagłówek (kolumny scrapowane) i
    // liczbę pozycji; różnicę tylko ZGŁASZAMY (log + zbiorczy mail po biegu),
    // bazy NIE ruszamy — żadnego UPDATE/DELETE. Patrz [[dedup-insert-only-edycje-erp]].
    let unchanged = 0;
    const rozbieznosci = []; // { docNumber, csDocsHeadersId, zmianyNaglowka:[{pole,baza,erp}], pozycjeBaza, pozycjeErp }
    if (existingHeaders.length) {
      const ids = existingHeaders.map(h => coerceValue(h.csDocsHeadersId, headerIdCol)).filter(v => v !== null);
      const dbMap = await fetchExistingHeaders(pool, headerIdCol, schema.headers, ids);
      const posCounts = await fetchPositionCounts(pool, headerIdCol, ids);
      for (const h of existingHeaders) {
        const id = idStr(h);
        const dbRow = dbMap.get(id);
        if (!dbRow) continue;
        const diffs = diffHeader(h, dbRow, schema.headers);
        const pozErp = result.positions.filter(p => idStr(p) === id).length;
        const pozBaza = posCounts.get(id) || 0;
        const posDiff = pozErp !== pozBaza;
        if (!diffs.length && !posDiff) { unchanged++; continue; }

        const czesci = [];
        if (diffs.length) czesci.push(diffs.map(d => d.field + ': ' + fmtVal(d.old) + ' -> ' + fmtVal(d.new)).join('; '));
        if (posDiff) czesci.push('liczba pozycji: ' + pozBaza + ' -> ' + pozErp);
        console.warn('[rozbieżność] ' + (h.DocNumber || id) + ' (id=' + id + '): ' + czesci.join(' | ') +
          ' (baza -> ERP) — rekord w bazie NIE zmieniony, tylko zgłoszenie.');
        rozbieznosci.push({
          docNumber: h.DocNumber || null,
          csDocsHeadersId: id,
          zmianyNaglowka: diffs.map(d => ({ pole: d.field, baza: fmtVal(d.old), erp: fmtVal(d.new) })),
          pozycjeBaza: pozBaza,
          pozycjeErp: pozErp
        });
      }
    }

    const rozbHeaders = rozbieznosci.filter(r => r.zmianyNaglowka.length).length;
    const rozbPoz = rozbieznosci.filter(r => r.pozycjeBaza !== r.pozycjeErp).length;

    const parts = ['dopisano ' + insertedHeaders + ' nagł./' + insertedPositions + ' poz.'];
    if (rozbieznosci.length) parts.push('ROZBIEŻNOŚCI z ERP: ' + rozbHeaders + ' nagł. / ' + rozbPoz +
      ' dok. z inną liczbą pozycji (bazy NIE zmieniono — zgłoszone)');
    if (unchanged) parts.push('bez zmian ' + unchanged);
    console.log('[wynik] Zapis do "' + DB_NAME + '" (' + TARGET_HEADERS + '/' + TARGET_POSITIONS + '): ' + parts.join(', ') + '.');

    return { insertedHeaders, insertedPositions, rozbieznosci, rozbHeaders, rozbPoz, unchanged };
  } finally {
    await pool.close();
  }
}

// ---------- Filtr typu dokumentu (zapisany filtr) ----------
// Dla MM domyślnie WYŁĄCZONY (URL listy już zawęża do przesunięć). Zostaje
// dostępny na wypadek, gdyby lista mieszała podtypy — sekwencja kliknięć
// identyczna jak przy WZ (diagnostyka/sonda-klikniecia.js).
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
  let totalRozbHeaders = 0;   // nagłówki różniące się od ERP (NIE zmieniamy bazy, tylko zgłaszamy)
  let totalRozbPoz = 0;       // dok. z inną liczbą pozycji niż w ERP
  const allRozbieznosci = []; // pełna lista rozbieżności — do zbiorczego maila po biegu
  let allPagesExhausted = false;
  let lastStoppedReason = null;
  let expectedTotal = null;
  let errorMsg = null;

  try {
    await login(page);

    await page.goto(MM_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });

    if (USE_DOC_TYPE_FILTER) {
      // Nie-krytyczny: to optymalizacja (mniej stron), nie warunek poprawności —
      // filtr csDocsTypesId w scrapeMmInPage i tak odsiewa obce podtypy. Gdyby
      // zapisany filtr "MM" zniknął/zmienił nazwę, logujemy i lecimy dalej bez
      // niego, zamiast wywalać cały przebieg.
      try {
        await setDocTypeFilter(page, MM_DOC_TYPE_FILTER_LABEL);
      } catch (e) {
        console.warn('[filtr-typ] Nie udało się zastosować zapisanego filtra "' +
          MM_DOC_TYPE_FILTER_LABEL + '" (' + e.message + '). Jadę dalej bez niego — ' +
          'filtr po stronie skryptu (csDocsTypesId) nadal odsiewa obce podtypy, ' +
          'tylko wolniej (więcej stron do przewinięcia).');
      }
    }

    if (dateFrom || dateTo) {
      await setDateFilter(page, dateFrom, dateTo);
    }

    const expectedRaw = await readPagerCountStable(page);
    // Rozróżniamy "pager pokazał 0" (dzień pusty — poprawny wynik) od "nie
    // dało się odczytać pagera" (null — kontrola pominięta). Wcześniej oba
    // wpadały w to samo `!expectedTotal` i 0 udawało błąd odczytu.
    const expectedParsed = (expectedRaw != null && String(expectedRaw).trim() !== '')
      ? parseInt(String(expectedRaw).replace(/[\s ]/g, ''), 10) : NaN;
    expectedTotal = Number.isNaN(expectedParsed) ? null : expectedParsed;
    if (expectedTotal === null) {
      console.warn('[mm] UWAGA: nie udało się odczytać liczby dokumentów z pagera (dostałem "' + expectedRaw + '") — kontrola na koniec przebiegu będzie pominięta.');
    }
    console.log('[mm] ERP zgłasza ' + (expectedTotal ?? '?') + ' dokumentów dla tego filtra.' +
      (priorState ? ' Mamy już ' + priorState.processedDocNumbers.length + ' z poprzednich sesji.' : ''));

    console.log('[mm] Lista załadowana. Startuję zbieranie w paczkach po ' + BATCH_SIZE + ' dok. ' +
      '(max ' + MAX_DOCS + ' łącznie w tej sesji)...');

    // Pusty dzień (ERP zgłasza 0 dokumentów) to KOMPLETNY wynik, nie błąd —
    // bez tego pętla poniżej kończyła się z 'pagination_stuck' na pustej
    // siatce i dzień raportował allPagesExhausted=false. Backfill (zewnętrzna
    // pętla ponawiająca do skutku) mielił wtedy pusty dzień w kółko. Pustkę
    // stwierdzamy z licznika ERP, nie z założenia o dniu tygodnia.
    if (expectedTotal === 0) {
      allPagesExhausted = true;
      console.log('[mm] ERP zgłasza 0 dokumentów dla tego filtra — dzień pusty, zaliczam jako kompletny.');
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
      const batch = await page.evaluate(scrapeMmInPage, {
        maxDocs: batchMaxDocs,
        headerFields: F.HEADER_FIELDS,
        headerFieldsFromPositions: F.HEADER_FIELDS_FROM_FIRST_POSITION,
        positionFields: F.POSITION_FIELDS,
        maxSessionMs: remainingMs,
        alreadyProcessed: Array.from(processedThisRun),
        docTypeId: MM_DOC_TYPE_ID
      });

      applyFixedValues(batch);
      const wr = await saveResult(batch, csvLabel);
      if (wr) {
        totalRozbHeaders += wr.rozbHeaders || 0;
        totalRozbPoz += wr.rozbPoz || 0;
        if (wr.rozbieznosci && wr.rozbieznosci.length) allRozbieznosci.push(...wr.rozbieznosci);
      }

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
        console.log('[paczka] +' + batch.headers.length + ' MM (łącznie w stanie: ' +
          saved.processedDocNumbers.length + (expectedTotal ? '/' + expectedTotal : '') + '), complete=' + saved.complete);
      }

      if (allPagesExhausted) break;
      if (batch.headers.length === 0 && !batch.partial) break;
      if (lastStoppedReason && lastStoppedReason !== 'batch_limit') break;
    }

    console.log('[mm] Koniec sesji. Zebrano w tej sesji: ' + totalHeaders + ' MM, ' + totalPositions + ' pozycji.' +
      (allRozbieznosci.length ? ' ROZBIEŻNOŚCI z ERP (bazy NIE zmieniono): ' + totalRozbHeaders + ' nagł. / ' +
        totalRozbPoz + ' dok. z inną liczbą pozycji.' : '') +
      (lastStoppedReason ? ' Powód zatrzymania: ' + lastStoppedReason + '.' : ' (lista wyczerpana).'));

    // Zbiorcze powiadomienie o rozbieżnościach (jeden mail na bieg, tylko gdy są).
    // Helper nigdy nie rzuca; bez SMTP w .env tylko loguje, że mail pominięto.
    if (allRozbieznosci.length) {
      await powiadomORozbieznosciach('mm', allRozbieznosci, { label: csvLabel });
    }

    // UWAGA (MM vs WZ): pager ERP (expectedTotal) liczy WSZYSTKIE podtypy listy
    // przesunięć — MM (269000798) + "Usunięcie blokady" + "Blokada" — a my
    // zbieramy tylko MM. Dlatego przy MM haveTotal < expectedTotal jest NORMĄ i
    // NIE oznacza braku danych. Miarodajny jest allPagesExhausted (przewinięcie
    // całej listy), nie porównanie z pagerem. (Przy WZ lista była jednorodna,
    // więc tam porównanie z pagerem miało sens — tu już nie.)
    if (allPagesExhausted) {
      console.log('[kontrola] Przewinięto CAŁĄ listę — komplet MM dla tego filtra. Zebrano ' +
        processedThisRun.size + ' dok. typu MM (pager ERP: ' + (expectedTotal ?? '?') + '). ' +
        'Bez zapisanego filtra "MM" pager liczy też inne podtypy przesunięć, więc bywa większy — ' +
        'to nie brak danych.');
    } else {
      console.warn('[kontrola] Przerwane przed końcem listy (' + (lastStoppedReason || '?') +
        '): zebrano ' + processedThisRun.size + ' dok. typu MM, nie przewinięto całej listy. ' +
        'Uruchom ponownie z tym samym filtrem, żeby dociągnąć resztę.');
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
      rozbieznosciNaglowki: totalRozbHeaders,
      rozbieznosciPozycje: totalRozbPoz,
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
    pushLogs('mm', dateFrom ? (dateFrom + '..' + dateTo) : null);
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err);
  process.exit(1);
});
