// ORKIESTRATOR — jedno wejście, które nadgania WSZYSTKIE scrapery ERP po kolei:
// [wz, mm, pz]. Uruchamiane na serwerze przez wz/serwer/uruchom.bat
// (git pull + node dobij-wszystko.js), raz dziennie w dni robocze.
//
// DLACZEGO SEKWENCYJNIE: ERP znosi tylko JEDNĄ sesję logowania naraz. Dwa
// scrapery równolegle = jeden wywala drugiego z sesji. Dlatego typy idą PO
// KOLEI: każdy nadganiany do kompletu, dopiero potem następny.
//
// GLOBALNY LOCK (automatyzacje/.scrapery.lock): dodatkowa siatka na wypadek,
// gdyby ktoś ręcznie odpalił drugi scraper (albo drugi orkiestrator) w trakcie.
// Nie pozwala wejść równolegle na ERP. Lock przeterminowany (starszy niż
// LOCK_STALE_MS) jest przejmowany — padnięty proces nie blokuje na zawsze.
//
// Wszystkie trzy piszą do tabel PRODUKCYJNYCH (catchup wymusza SCRAPE_TARGET=prod).
// Michał zatwierdził MM i PZ do produkcji 2026-09-29; WZ już tam pisało.
//
// Kolejność scrape.js NIE jest tu modyfikowana — orkiestrator tylko WOŁA
// scrape.js każdego typu (przez lib-wspolne/catchup). Logika DOM każdego typu
// zostaje w jego katalogu, edytowana przez osobne sesje (Scraper MM/PZ).
//
// Uruchomienie ręczne (test):  node dobij-wszystko.js
//   SCRAPERS=wz node dobij-wszystko.js       # tylko wybrane typy
//   CATCHUP_WINDOW=8 node dobij-wszystko.js  # szersze okno nadganiania

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const runCatchup = require('./lib-wspolne/catchup');

const AUTO_DIR = __dirname;

// Toasty Windows — TYLKO lokalnie u Lecha (launcher ustawia TOAST=true). Na
// serwerze headless nikt nie patrzy, więc domyślnie WYŁĄCZONE. Helper toast.ps1
// jest generyczny (Title/Message) i leży w wz/ — reużywamy go dla wszystkich typów.
const TOAST = process.env.TOAST === 'true';
const TOAST_SCRIPT = path.join(AUTO_DIR, 'wz', 'toast.ps1');
function toast(title, message) {
  if (!TOAST) return;
  try {
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      TOAST_SCRIPT, title, message], { timeout: 20000 });
  } catch { /* powiadomienie to dodatek, nie blokuje pracy */ }
}
const LOCK_PATH = path.join(AUTO_DIR, '.scrapery.lock');
// Lock starszy niż to uznajemy za osierocony (proces padł bez sprzątnięcia).
// 12 h > najdłuższy realny bieg (3 typy × okno × sesje), więc żywy przebieg
// nigdy sam siebie nie wyprzedzi, a trup nie blokuje kolejnego dnia.
const LOCK_STALE_MS = parseInt(process.env.LOCK_STALE_MS || String(12 * 60 * 60 * 1000), 10);

// Domyślna kolejność. ERP jeden na raz — nie zmieniaj na równoległe.
const ALL = ['wz', 'mm', 'pz'];
const SCRAPERS = (process.env.SCRAPERS || ALL.join(','))
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function acquireLock() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8');
    const info = JSON.parse(raw);
    const age = Date.now() - new Date(info.ts).getTime();
    if (age < LOCK_STALE_MS) {
      console.error(`[dobij-wszystko] LOCK zajęty przez PID ${info.pid} od ${info.ts} ` +
        `(${Math.round(age / 60000)} min temu). Inny bieg trwa — nie wchodzę równolegle na ERP.`);
      return false;
    }
    console.warn(`[dobij-wszystko] LOCK przeterminowany (${Math.round(age / 60000)} min) — przejmuję.`);
  } catch { /* brak locka albo śmieć w pliku — bierzemy */ }
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), 'utf8');
  return true;
}

// Zwalniamy tylko WŁASNY lock (jeśli w międzyczasie ktoś przejął — nie kasujemy).
function releaseLock() {
  try {
    const info = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (info.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch { /* już nie ma albo cudzy — zostaw */ }
}

if (!acquireLock()) process.exit(3);

const cleanup = () => releaseLock();
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

console.log(`[dobij-wszystko] ${new Date().toISOString()} start, kolejność: ${SCRAPERS.join(' -> ')}`);

const summary = [];
for (const type of SCRAPERS) {
  const dir = path.join(AUTO_DIR, type);
  if (!fs.existsSync(path.join(dir, 'scrape.js'))) {
    console.warn(`[dobij-wszystko] pomijam '${type}' — brak ${type}/scrape.js`);
    continue;
  }
  console.log(`\n[dobij-wszystko] ===== ${type.toUpperCase()} =====`);
  const wynik = runCatchup({
    dir, prefix: type, label: type.toUpperCase(),
    onEvent: (_kind, title, message) => toast(title, message)
  });
  summary.push({ type, ...wynik });
}

console.log(`\n[dobij-wszystko] PODSUMOWANIE:`);
let anyFailed = false;
for (const s of summary) {
  const ok = s.done.length ? `OK ${s.done.join(',')}` : '';
  const bad = s.failed.length ? `NIE ${s.failed.join(',')}` : '';
  const nic = !s.targets.length ? '(nic do zrobienia)' : '';
  console.log(`  ${s.type.toUpperCase()}: ${[nic, ok, bad].filter(Boolean).join(' | ') || 'brak zmian'}`);
  if (s.failed.length) anyFailed = true;
}

const toastParts = summary.map((s) => {
  if (!s.targets.length) return `${s.type.toUpperCase()}: —`;
  return `${s.type.toUpperCase()}: OK ${s.done.length}${s.failed.length ? `, NIE ${s.failed.length}` : ''}`;
});
toast('Scrapery ERP — koniec', toastParts.join(' | '));

process.exit(anyFailed ? 1 : 0);
