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
const LOCK_STALE_MS = parseInt(process.env.LOCK_STALE_MS || String(12 * 60 * 60 * 1000), 10);
const { acquire: acquireLock, release: releaseLock } = require('./lib-wspolne/lock')(LOCK_PATH, { staleMs: LOCK_STALE_MS });

// Domyślna kolejność. ERP jeden na raz — nie zmieniaj na równoległe.
const ALL = ['wz', 'mm', 'pz'];
const SCRAPERS = (process.env.SCRAPERS || ALL.join(','))
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Cel zapisu. DOMYŚLNIE prod (codzienny bieg). TARGET=test -> tabele *_test
// (np. jednorazowy backfill do weryfikacji, bez ruszania produkcji).
const TARGET = process.env.TARGET || 'prod';

// Zakres dat. DOMYŚLNIE: okno wsteczne z catchup (CATCHUP_WINDOW dni, codzienny
// bieg). FROM=RRRR-MM-DD (+ opcjonalnie TO, domyślnie wczoraj) daje JAWNĄ listę
// dni — do kawałkowanego backfillu historycznego (np. FROM=2026-08-13 TO=2026-08-26).
function ymd(d) { return d.toISOString().slice(0, 10); }
function parseDay(name, v) {
  // Round-trip: odrzuca nie tylko zły format, ale i nieistniejące daty
  // (2026-13-01, 2026-02-30 dają Invalid Date / rollover, które NIE wrócą 1:1).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { console.error(`BŁĄD: ${name}='${v}' musi być RRRR-MM-DD.`); process.exit(2); }
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || ymd(d) !== v) { console.error(`BŁĄD: ${name}='${v}' nie istnieje w kalendarzu.`); process.exit(2); }
  return d;
}
function buildDays(from, to) {
  const start = parseDay('FROM', from);
  const end = parseDay('TO', to);
  if (start > end) { console.error(`BŁĄD: FROM (${from}) jest po TO (${to}).`); process.exit(2); }
  const days = [];
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d));
  return days; // zawsze >=1 dzień, gdy FROM/TO poprawne — brak cichego spadku do okna
}
let DAYS = null;
if (process.env.FROM) {
  const to = process.env.TO || ymd(new Date(Date.now() - 86400000)); // domyślnie wczoraj
  DAYS = buildDays(process.env.FROM, to);
}

if (!acquireLock()) process.exit(3);

const cleanup = () => releaseLock();
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

console.log(`[dobij-wszystko] ${new Date().toISOString()} start, kolejność: ${SCRAPERS.join(' -> ')}, cel: ${TARGET.toUpperCase()}` +
  (DAYS ? `, zakres: ${DAYS[0]}..${DAYS[DAYS.length - 1]} (${DAYS.length} dni)` : ''));

const summary = [];
for (const type of SCRAPERS) {
  const dir = path.join(AUTO_DIR, type);
  if (!fs.existsSync(path.join(dir, 'scrape.js'))) {
    console.warn(`[dobij-wszystko] pomijam '${type}' — brak ${type}/scrape.js`);
    continue;
  }
  console.log(`\n[dobij-wszystko] ===== ${type.toUpperCase()} =====`);
  const wynik = runCatchup({
    dir, prefix: type, label: type.toUpperCase(), target: TARGET,
    days: DAYS || undefined,
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
