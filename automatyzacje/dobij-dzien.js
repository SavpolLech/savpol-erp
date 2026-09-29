// RĘCZNE "dobij konkretny dzień konkretnego typu -> PRODUKCJA". Dla Tomka i
// Michała: gdy wyłapią brak (ERP pokazuje np. 800 WZ, a w worku jest 780),
// mogą sami dociągnąć brakujące — bez maila do Lecha, bez grzebania w kodzie.
//
// Użycie:
//   node dobij-dzien.js <typ> <data> [--pelny]
//     <typ>   wz | mm | pz
//     <data>  RRRR-MM-DD (np. 2026-09-15)
//     --pelny  przescrapuj dzień OD ZERA (patrz niżej)
//
// Bezpieczne: bierze ten sam GLOBALNY lock co codzienny orkiestrator
// (automatyzacje/.scrapery.lock), więc nigdy nie wejdzie na ERP równolegle.
// Dedup po csDocsHeadersId sprawia, że dopisuje TYLKO brakujące — nie duplikuje.
//
// DWA TRYBY (bo brak w worku ma dwie przyczyny):
//   szybki (domyślny)  — zachowuje to, co już zebrano w state/, i dobiera tylko
//                        dokumenty, których jeszcze NIE widział. Naprawia
//                        przypadek: dokumenty doklejone/wsteczne, których nigdy
//                        nie zeszło.
//   --pelny            — czyści stan dnia i przeklikuje go OD ZERA. Wolniejsze
//                        (cała sesja), ale pewne także wtedy, gdy dokument był
//                        "zebrany" wg state/, lecz jego INSERT do worka nie
//                        wszedł. Wtedy szybki tryb by go pominął — użyj --pelny.
//
// Po szybkim biegu skrypt sam przypomni: jeśli w worku NADAL jest mniej niż w
// ERP, powtórz z --pelny.

const fs = require('fs');
const path = require('path');
const runCatchup = require('./lib-wspolne/catchup');

const AUTO_DIR = __dirname;
const ALLOWED = ['wz', 'mm', 'pz'];

function usage(msg) {
  if (msg) console.error('BŁĄD: ' + msg);
  console.error('Użycie: node dobij-dzien.js <wz|mm|pz> <RRRR-MM-DD> [--pelny]');
  process.exit(2);
}

const args = process.argv.slice(2);
const pelny = args.includes('--pelny');
const positional = args.filter((a) => !a.startsWith('--'));
const type = (positional[0] || '').toLowerCase();
const day = positional[1] || '';

if (!ALLOWED.includes(type)) usage(`nieznany typ '${type || '(brak)'}' — dozwolone: ${ALLOWED.join(', ')}`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) usage(`data '${day || '(brak)'}' musi być w formacie RRRR-MM-DD`);
const parsed = new Date(day + 'T00:00:00Z');
if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) usage(`data '${day}' nie istnieje w kalendarzu`);

const dir = path.join(AUTO_DIR, type);
if (!fs.existsSync(path.join(dir, 'scrape.js'))) usage(`brak ${type}/scrape.js`);

const { loadState, stateFilePath } = require('./lib-wspolne/state')(dir, type);

// Reset stanu dnia tak, by catchup potraktował go jak niekompletny i wszedł.
// Piszemy plik wprost (saveState nigdy nie cofa complete=true -> false).
function resetDay() {
  const st = loadState(day, day); // istniejący albo świeży szkielet
  const before = st.processedDocNumbers.length;
  const next = {
    dateFrom: day,
    dateTo: day,
    processedDocNumbers: pelny ? [] : st.processedDocNumbers,
    complete: false,
    lastUpdated: new Date().toISOString(),
    runs: st.runs || []
  };
  const p = stateFilePath(day, day);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return before;
}

const LOCK_PATH = path.join(AUTO_DIR, '.scrapery.lock');
const LOCK_STALE_MS = parseInt(process.env.LOCK_STALE_MS || String(12 * 60 * 60 * 1000), 10);
const { acquire, release } = require('./lib-wspolne/lock')(LOCK_PATH, { staleMs: LOCK_STALE_MS });

if (!acquire()) {
  console.error('Inny bieg scraperów trwa (codzienny automat albo drugie ręczne dobicie). ' +
    'Poczekaj aż skończy i spróbuj ponownie.');
  process.exit(3);
}
process.on('exit', release);
process.on('SIGINT', () => { release(); process.exit(130); });
process.on('SIGTERM', () => { release(); process.exit(143); });

console.log(`[dobij-dzien] ${type.toUpperCase()} ${day} — tryb ${pelny ? 'PEŁNY (od zera)' : 'szybki (dobiera brakujące)'}.`);
const before = resetDay();
console.log(`[dobij-dzien] stan przed: ${before} dok. w state/${pelny ? ' (wyczyszczone — pełne przescrapowanie)' : ' (zachowane — dobieram tylko nowe)'}.`);

const { done, failed } = runCatchup({ dir, prefix: type, label: type.toUpperCase(), days: [day] });

const after = loadState(day, day).processedDocNumbers.length;
const dopisano = Math.max(0, after - (pelny ? 0 : before));
console.log(`\n[dobij-dzien] KONIEC ${type.toUpperCase()} ${day}: w state/ jest teraz ${after} dok. ` +
  `(nowych w tym biegu: ${dopisano}). ${done.length ? 'Dzień KOMPLETNY.' : 'Dzień NIEdomknięty.'}`);

if (!pelny) {
  console.log('\nUWAGA: to był tryb szybki. Jeśli w worku (bazie) NADAL jest mniej dokumentów niż');
  console.log('pokazuje ERP dla tego dnia, przyczyną jest nieudany zapis wcześniej zebranego');
  console.log(`dokumentu — powtórz to samo z flagą --pelny:  node dobij-dzien.js ${type} ${day} --pelny`);
}

process.exit(failed.length ? 1 : 0);
