// RĘCZNY, NA ŻĄDANIE: scrapowanie produktów po csItemsId + zapis do PRODUKCJI.
// Wejście to lista identyfikatorów bazodanowych, którą przysyła ręcznie Michał
// (produkty z pozycji WZ, które nie mają jeszcze kartoteki w csItems). NIE jest
// to część cyklicznego biegu (dobij-wszystko.js) — odpalasz, gdy dostaniesz ID.
//
// Użycie (argumenty przekazywane wprost do produkty/scrape-po-id.js):
//   node dobij-produkty-po-id.js 30290482005 30190004991 ...
//   node dobij-produkty-po-id.js --plik=produkty/lista-id.txt
//
// Co robi po kolei:
//   1. bierze GLOBALNY lock (.scrapery.lock) — nie wejdzie na ERP równolegle
//      z WZ/MM/PZ ani z codziennym biegiem,
//   2. produkty/scrape-po-id.js — scrapuje wskazane ID do produkty/wynik/
//      (idempotentne: pomija ID, które już mają JSON),
//   3. zapis do PRODUKCYJNYCH tabel (--realne), po kolei:
//        wgraj-do-worek → wgraj-jednostki-do-worek → wgraj-zdjecia-do-worek
//        → wgraj-grupy-do-worek
//      Michał zatwierdził zapis produktów do tabel produkcyjnych.
//
// Skryptów w produkty/ NIE modyfikujemy — tylko je wołamy (są utrzymywane
// przez osobną sesję "Scraper Produkty").

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUTO_DIR = __dirname;
const PROD_DIR = path.join(AUTO_DIR, 'produkty');

const passthrough = process.argv.slice(2);
if (!passthrough.length) {
  console.error('BŁĄD: podaj listę ID albo --plik=<ścieżka>.');
  console.error('Użycie: node dobij-produkty-po-id.js <id> <id> ...   |   --plik=produkty/lista-id.txt');
  process.exit(2);
}

// Kroki zapisu do produkcji — kolejność wg sesji Produkty.
const WGRAJ = [
  'wgraj-do-worek.js',
  'wgraj-jednostki-do-worek.js',
  'wgraj-zdjecia-do-worek.js',
  'wgraj-grupy-do-worek.js'
];

// Sanity: skrypty muszą istnieć (są w repo, utrzymuje je sesja Produkty).
for (const f of ['scrape-po-id.js', ...WGRAJ]) {
  if (!fs.existsSync(path.join(PROD_DIR, f))) {
    console.error(`BŁĄD: brak produkty/${f} — zrób git pull albo sprawdź sesję Produkty.`);
    process.exit(2);
  }
}

const LOCK_PATH = path.join(AUTO_DIR, '.scrapery.lock');
const LOCK_STALE_MS = parseInt(process.env.LOCK_STALE_MS || String(12 * 60 * 60 * 1000), 10);
const { acquire, release } = require('./lib-wspolne/lock')(LOCK_PATH, { staleMs: LOCK_STALE_MS });

if (!acquire()) {
  console.error('Inny bieg scraperów trwa (codzienny automat, ręczne dobicie dnia albo backfill). ' +
    'Poczekaj aż skończy i spróbuj ponownie.');
  process.exit(3);
}
process.on('exit', release);
process.on('SIGINT', () => { release(); process.exit(130); });
process.on('SIGTERM', () => { release(); process.exit(143); });

function run(script, args) {
  console.log(`\n[dobij-produkty] === ${script} ${args.join(' ')} ===`);
  const r = spawnSync('node', [script, ...args], { cwd: PROD_DIR, stdio: 'inherit' });
  return !r.error && r.status === 0;
}

// 1+2. Scrape po ID.
if (!run('scrape-po-id.js', passthrough)) {
  console.error('\n[dobij-produkty] scrape-po-id.js nie powiódł się — PRZERYWAM przed zapisem do produkcji.');
  process.exit(1);
}

// 3. Zapis do produkcji, po kolei. Pierwszy błąd przerywa (żeby nie było
// połowicznego zapisu bez sygnału).
for (const w of WGRAJ) {
  if (!run(w, ['--realne'])) {
    console.error(`\n[dobij-produkty] ${w} --realne nie powiódł się — PRZERYWAM. ` +
      `Scrape jest w wynik/, część zapisu mogła nie wejść — sprawdź i dokończ ręcznie.`);
    process.exit(1);
  }
}

console.log('\n[dobij-produkty] GOTOWE: scrape po ID + zapis do produkcji zakończone.');
process.exit(0);
