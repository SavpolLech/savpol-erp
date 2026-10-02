// Wspólne dla skryptów dokumentów sprzedaży (FA, PAR): połączenie z bazą i konwersja wartości
// bierzemy z kontrahentów (ta sama karta API, te same typy), tu tylko stałe FA
// i logowanie do ERP.

const path = require('path');
const K = require(path.join(__dirname, '..', '..', 'kontrahenci', 'lib', 'wspolne'));

const OUT_DIR = path.join(__dirname, '..', 'wynik');
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
// Typy z okna „Dokumenty sprzedaży” — wartości z kart i wzorcowych wierszy
// Michała (FA_pola_wymagane.xlsx, PAR_pola_wymagane.xlsx). Oba typy mają tę
// samą kartę csDocsHeaders_Sales i te same tabele. Lista miesza je jeszcze
// z korektami (FAK, PARK) — tych nie bierzemy.
const TYPY = { FA: '267302594', PAR: '218693742' };
const FA_DOC_TYPE_ID = TYPY.FA;

// --typ=FA|PAR z linii poleceń (domyślnie FA).
function typZArgumentow(argv) {
  const a = (argv.find(x => x.startsWith('--typ=')) || '--typ=FA').slice(6).toUpperCase();
  if (!TYPY[a]) throw new Error('Nieznany typ ' + a + ' (dostępne: ' + Object.keys(TYPY).join(', ') + ')');
  return { kod: a, id: TYPY[a], prefiks: a.toLowerCase() };
}
const TAB_NAGLOWKI = 'csDocsHeaders';
const TAB_POZYCJE = 'csDocsItemsPositions';

// Karta faktury otwiera się wprost z URL (slug „faktura” jest dowolny).
// Jedno zapytanie zwraca nagłówek (DataSetSQLIdent csdocsheaders) i wszystkie
// pozycje (csdocsitemspositions).
const cardUrl = id => ERP_BASE_URL.replace(/\/$/, '') +
  '/pl/faktura/csdocsheaders_sales-' + K.COMPANY_ID + ',' + id + ',' + id + ',x/' + K.COMPANY_ID;

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });
  const user = process.env.ERP_LOGIN, pass = process.env.ERP_PASSWORD;
  if (!user || !pass) throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w automatyzacje/.env');
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', pass);
  await page.press('input[name="password"]', 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 30000 });
  // Po logowaniu aplikacja jeszcze przekierowuje na pulpit (jak w kontrahentach).
  await page.waitForTimeout(4000);
  console.log('[login] Zalogowano.');
}

module.exports = Object.assign({}, K, { OUT_DIR, ERP_BASE_URL, TYPY, FA_DOC_TYPE_ID, typZArgumentow, TAB_NAGLOWKI, TAB_POZYCJE, cardUrl, login });
