// Wspólne dla skryptów faktur zakupu (FZ, FZ_KSEF). Logowanie, baza, konwersja
// wartości i zapis są te same co w sprzedaz/ (ta sama tabela, ten sam format
// karty API) — tu tylko stałe okna „Dokumenty zakupu”.

const path = require('path');
const S = require(path.join(__dirname, '..', '..', 'sprzedaz', 'lib', 'wspolne'));

const OUT_DIR = path.join(__dirname, '..', 'wynik');
// Typy z wzorcowych wierszy Michała (FZ_pola_wymagane.xlsx, 2026-10-08).
// Lista „Dokumenty zakupu” miesza je z innymi typami (Ko/… itd.) — tych nie bierzemy.
const TYPY = { FZ: '213217937', FZ_KSEF: '27484898580' };
const kodTypu = id => Object.keys(TYPY).find(k => TYPY[k] === String(id)) || null;
const plikWyniku = (kod, id) => path.join(OUT_DIR, kod.toLowerCase() + '_' + id + '.json');

// --typ=FZ|FZ_KSEF z linii poleceń (domyślnie FZ).
function typZArgumentow(argv) {
  const a = (argv.find(x => x.startsWith('--typ=')) || '--typ=FZ').slice(6).toUpperCase();
  if (!TYPY[a]) throw new Error('Nieznany typ ' + a + ' (dostępne: ' + Object.keys(TYPY).join(', ') + ')');
  return { kod: a, id: TYPY[a], prefiks: a.toLowerCase() };
}

// Karta faktury zakupu otwiera się wprost z URL (slug dowolny, sprawdzone
// 2026-10-09 podmianą id). Jedno zapytanie (DictIdent csDocsHeaders_Purchase)
// zwraca nagłówek (csdocsheaders) i wszystkie pozycje (csdocsitemspositions).
const cardUrl = id => S.ERP_BASE_URL.replace(/\/$/, '') +
  '/pl/faktura-zakupu/csdocsheaders_purchase-' + S.COMPANY_ID + ',' + id + '/' + S.COMPANY_ID;

module.exports = Object.assign({}, S, { OUT_DIR, TYPY, kodTypu, plikWyniku, typZArgumentow, cardUrl });
