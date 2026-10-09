// ORKIESTRATOR — jedno wejście, które nadgania WSZYSTKIE scrapery ERP po kolei:
// [wz, mm, pz, sprzedaz], potem brakujące kartoteki produktów z tych
// dokumentów (krok PRODUKTY). Uruchamiane na serwerze przez wz/serwer/uruchom.bat
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
// Wszystkie piszą do tabel PRODUKCYJNYCH (catchup wymusza SCRAPE_TARGET=prod).
// Michał zatwierdził MM i PZ do produkcji 2026-09-29; WZ już tam pisało;
// sprzedaż (FA + PAR) 2026-10-06.
//
// Kolejność scrape.js NIE jest tu modyfikowana — orkiestrator tylko WOŁA
// scrape.js każdego typu (przez lib-wspolne/catchup). Logika DOM każdego typu
// zostaje w jego katalogu, edytowana przez osobne sesje (Scraper MM/PZ).
//
// Uruchomienie ręczne (test):  node dobij-wszystko.js
//   SCRAPERS=wz node dobij-wszystko.js       # tylko wybrane typy
//   CATCHUP_WINDOW=8 node dobij-wszystko.js  # szersze okno nadganiania
//   DO_GODZINY=19:00 node dobij-wszystko.js  # sam kończy przed 19:00

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
const ALL = ['wz', 'mm', 'pz', 'sprzedaz'];
const SCRAPERS = (process.env.SCRAPERS || ALL.join(','))
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Domyślne OPÓŹNIENIE scrapingu per typ (min. wiek dnia w dniach). catchup.js
// czyta <PREFIX>_MIN_AGE_DAYS z env; tu ustawiamy bezpieczne domyślne, żeby
// działały bez edycji .env na serwerze (env nadal nadpisuje). MM=3: dokumenty
// MM bywają modyfikowane (data/wartości) zanim zostaną zaksięgowane (~2-3 dni),
// więc scrapujemy je dopiero po ustabilizowaniu — patrz lib-wspolne/catchup.js.
// SPRZEDAZ=14 (Michał 2026-10-06, „bufor 14 dni”): faktury dochodzą z datą
// wstecz (1.07: 591 FA w ERP, 590 w kopii bazy z 27.07), a płatności
// dopisują się po wystawieniu.
const DEFAULT_MIN_AGE = { mm: '3', sprzedaz: '14' };
for (const [typ, val] of Object.entries(DEFAULT_MIN_AGE)) {
  const key = typ.toUpperCase() + '_MIN_AGE_DAYS';
  if (process.env[key] === undefined) process.env[key] = val;
}
// Okno wsteczne per typ (<TYP>_CATCHUP_WINDOW) — musi objąć opóźnienie i mieć
// zapas na przegapione biegi. Dni kompletne wg state/ i tak są pomijane.
// Jawne CATCHUP_WINDOW (np. backfill) ma pierwszeństwo przed tym domyślnym.
const DEFAULT_WINDOW = { sprzedaz: '21' };
for (const [typ, val] of Object.entries(DEFAULT_WINDOW)) {
  const key = typ.toUpperCase() + '_CATCHUP_WINDOW';
  if (process.env[key] === undefined && process.env.CATCHUP_WINDOW === undefined) process.env[key] = val;
}
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
// DO_GODZINY=GG:MM — godzina końca (np. backfill 17:00–19:00 albo nocny do
// 08:00). Najbliższe wystąpienie tej godziny po starcie; catchup nie zaczyna po
// niej nowego dnia, a scraper sprzedaży kończy karty kilka minut wcześniej.
if (process.env.DO_GODZINY) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(process.env.DO_GODZINY);
  if (!m) { console.error(`BŁĄD: DO_GODZINY='${process.env.DO_GODZINY}' musi być GG:MM.`); process.exit(2); }
  const k = new Date();
  k.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  if (k <= new Date()) k.setDate(k.getDate() + 1);
  process.env.KONIEC_TS = String(k.getTime());
  console.log(`[dobij-wszystko] Godzina końca: ${k.toLocaleString('pl-PL')}`);
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

// PRZEGLĄD SPRZEDAŻY 45 DNI (Michał 2026-10-06): faktury bywają wystawiane
// z datą wstecz dłuższą niż bufor 14 dni (2026/FA/WAS1/014375: wystawiona
// 31.07 z datą 1.07). Raz w tygodniu (domyślnie w piątek) każdy dzień z
// zakresu dziś-45..dziś-15 przechodzi jeszcze raz: lista ~3 min, karty tylko
// dla brakujących. Tylko w zwykłym biegu (bez FROM/TO), raz na dzień
// (znacznik w sprzedaz/state/, commitowany przez pushLogs).
//   PRZEGLAD=1 — wymuś dziś;  PRZEGLAD_DZIEN=1..7 (pn..nd);  PRZEGLAD_ZAKRES=45
if (SCRAPERS.includes('sprzedaz') && !DAYS) {
  const dzisiaj = new Date();
  const dzienTyg = dzisiaj.getDay() || 7;
  const znacznik = path.join(AUTO_DIR, 'sprzedaz', 'state', 'przeglad-ostatni.txt');
  let ostatni = '';
  try { ostatni = fs.readFileSync(znacznik, 'utf8').trim(); } catch { /* pierwszy raz */ }
  const dzisYmd = ymd(new Date(dzisiaj.getTime() - dzisiaj.getTimezoneOffset() * 60000));
  const pora = process.env.PRZEGLAD === '1' || dzienTyg === parseInt(process.env.PRZEGLAD_DZIEN || '5', 10);
  if (pora && ostatni !== dzisYmd) {
    const zakres = parseInt(process.env.PRZEGLAD_ZAKRES || '45', 10);
    const minWiek = parseInt(process.env.SPRZEDAZ_MIN_AGE_DAYS || '14', 10) + 1;
    // Tylko dni już raz skompletowane — niepobrane (zaległości) to robota
    // zwykłego biegu / backfillu, nie tygodniowego przeglądu (inaczej piątek
    // zamieniłby się w wielogodzinne pobieranie).
    const { loadState } = require('./lib-wspolne/state')(path.join(AUTO_DIR, 'sprzedaz'), 'sprzedaz');
    const dni = [];
    for (let back = zakres; back >= minWiek; back--) {
      const d = new Date(dzisiaj); d.setDate(d.getDate() - back);
      const dzien = ymd(new Date(d.getTime() - d.getTimezoneOffset() * 60000));
      if (loadState(dzien, dzien).complete) dni.push(dzien);
    }
    if (dni.length) {
      console.log(`\n[dobij-wszystko] ===== SPRZEDAŻ — przegląd ${dni[0]}..${dni[dni.length - 1]} (${dni.length} dni) =====`);
      const wynik = runCatchup({
        dir: path.join(AUTO_DIR, 'sprzedaz'), prefix: 'sprzedaz', label: 'SPRZEDAŻ-przegląd', target: TARGET,
        days: dni, przeglad: true
      });
      summary.push({ type: 'sprzedaz-przeglad', ...wynik });
      try { fs.mkdirSync(path.dirname(znacznik), { recursive: true }); fs.writeFileSync(znacznik, dzisYmd + '\n'); } catch { /* znacznik to dodatek */ }
      require('./lib-wspolne/git-log-push').pushLogs('sprzedaz', 'przegląd ' + dni[0] + '..' + dni[dni.length - 1]);
    } else {
      console.log('\n[dobij-wszystko] Przegląd sprzedaży: brak skompletowanych dni w zakresie (zaległości jeszcze nienadrobione).');
    }
  }
}

// BRAKUJĄCE PRODUKTY (2026-10-09): kartoteki towarów z pozycji dokumentów,
// których nie ma w csItems (brakujace-produkty.js) → scrape po csItemsId +
// zapis do produkcji (lib-wspolne/produkty-po-id). Zastępuje ręczną listę od
// Michała. Przed zaległościami sprzedaży, bo te zajmują resztę dnia do 18:00.
// Tylko zwykły bieg na prod (bez FROM/TO, bez TARGET=test).
//   PRODUKTY=0 — wyłącz;  PRODUKTY_LIMIT=50 — maks. kart w jednym biegu
if (process.env.PRODUKTY !== '0' && !DAYS && TARGET === 'prod') {
  const koniecTs = parseInt(process.env.KONIEC_TS || '0', 10);
  if (koniecTs && Date.now() > koniecTs - 30 * 60000) {
    console.log('\n[dobij-wszystko] Brakujące produkty: za blisko godziny końca — dziś pomijam.');
  } else {
    console.log('\n[dobij-wszystko] ===== PRODUKTY — brakujące kartoteki =====');
    const lista = path.join(AUTO_DIR, 'produkty', 'wynik', 'lista-id-auto.txt');
    const limit = process.env.PRODUKTY_LIMIT || '50';
    const q = spawnSync('node', ['brakujace-produkty.js', '--zapisz=' + lista, '--limit=' + limit],
      { cwd: AUTO_DIR, stdio: 'inherit' });
    let idy = [];
    try { idy = fs.readFileSync(lista, 'utf8').split(/\s+/).filter(Boolean); } catch { /* brak pliku = błąd zapytania */ }
    if (q.error || q.status !== 0) {
      summary.push({ type: 'produkty', targets: ['zapytanie'], done: [], failed: ['zapytanie do worek'] });
    } else if (!idy.length) {
      summary.push({ type: 'produkty', targets: [], done: [], failed: [] });
    } else {
      const wynik = require('./lib-wspolne/produkty-po-id')(['--plik=' + lista], 'dobij-wszystko/produkty');
      summary.push({ type: 'produkty', targets: idy, done: wynik.ok ? [`${idy.length} kart`] : [],
        failed: wynik.ok ? [] : [wynik.krok] });
    }
  }
}

// ZALEGŁOŚCI SPRZEDAŻY (Tomek 2026-10-06: pon–pt, maks. do 18:00). Po zwykłym
// biegu ten sam proces nadgania jawny zakres dni, aż minie godzina końca.
// Dni kompletne są pomijane, więc po nadrobieniu krok sam nic nie robi —
// wtedy usuń ZALEGLOSCI z launchera.
//   ZALEGLOSCI=2026-07-01..2026-09-14  ZALEGLOSCI_DO_GODZINY=18:00
if (process.env.ZALEGLOSCI && !DAYS) {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(process.env.ZALEGLOSCI);
  const g = /^(\d{1,2}):(\d{2})$/.exec(process.env.ZALEGLOSCI_DO_GODZINY || '18:00');
  if (!m || !g) {
    console.error(`[dobij-wszystko] BŁĄD: ZALEGLOSCI='${process.env.ZALEGLOSCI}' (RRRR-MM-DD..RRRR-MM-DD) albo ZALEGLOSCI_DO_GODZINY (GG:MM) w złym formacie — pomijam zaległości.`);
  } else {
    const koniec = new Date();
    koniec.setHours(parseInt(g[1], 10), parseInt(g[2], 10), 0, 0);
    if (Date.now() >= koniec.getTime()) {
      console.log(`\n[dobij-wszystko] Zaległości: już po ${process.env.ZALEGLOSCI_DO_GODZINY || '18:00'} — dziś pomijam.`);
    } else {
      process.env.KONIEC_TS = String(koniec.getTime());
      console.log(`\n[dobij-wszystko] ===== SPRZEDAŻ — zaległości ${m[1]}..${m[2]}, do ${koniec.toLocaleTimeString('pl-PL')} =====`);
      const wynik = runCatchup({
        dir: path.join(AUTO_DIR, 'sprzedaz'), prefix: 'sprzedaz', label: 'SPRZEDAŻ-zaległości', target: TARGET,
        days: buildDays(m[1], m[2]),
        onEvent: (kind, title, message) => { if (kind === 'end') toast(title, message); }
      });
      // Dzień przerwany godziną końca to nie błąd — dokończy jutro.
      summary.push({ type: 'sprzedaz-zaleglosci', ...wynik, failed: [] , przerwane: wynik.failed });
    }
  }
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
