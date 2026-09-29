// LOKALNY "dobij zaległe dni -> PRODUKCJA" — do Harmonogramu Zadań Windows na
// maszynie Lecha, rozwiązanie PRZEJŚCIOWE, zanim stanie właściwy serwer
// (patrz serwer/ + INSTRUKCJA-TOMEK.md).
//
// Zadanie odpala się TYLKO w dni robocze (pon-pt). Żeby nie zgubić danych z
// weekendu (soboty/niedziele BYWAJĄ niepuste — patrz historia projektu), NIE
// scrapujemy sztywno "wczoraj", tylko NADGANIAMY: bierzemy każdy niekompletny
// dzień z okna wstecz (domyślnie 5 dni) i scrapujemy go, od najstarszego do
// wczoraj. Dzięki temu poniedziałkowy bieg sam dobiera piątek + sobotę +
// niedzielę, a przy okazji nadrabia każdy przegapiony bieg (self-heal).
// Pisze WPROST do tabel produkcyjnych (SCRAPE_TARGET=prod).
//
// Pełny dzień (~800 dok.) często nie mieści się w jednej sesji scrape.js
// (limit 30-60 min) — powtarzamy sesję, aż dzień będzie kompletny (state/).
// Pusty dzień domyka się w jednej próbie (fix expectedTotal===0).
//
// Działa pod zablokowanym ekranem (proces żyje, gdy użytkownik zalogowany);
// przy opcji zadania "Uruchom niezależnie od tego, czy użytkownik jest
// zalogowany" — także po wylogowaniu. NIE wymaga otwartej aplikacji Claude.
//
// Uruchomienie ręczne (test):  node dobij-wczoraj.js
//   CATCHUP_WINDOW=8 node dobij-wczoraj.js   # szersze okno nadganiania

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOCK = path.join(DIR, '.scrape.lock');
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '6', 10);
// Twardy limit na jedną sesję scrape.js. Sesja jest losowana na 30-60 min, więc
// 75 min to zapas; jeśli proces przekroczy (zawieszony ERP, crash przeglądarki
// zostawiający zombie), spawnSync go ubija, a pętla ponawia — pojedynczy crash
// nie kładzie całego biegu.
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || String(75 * 60 * 1000), 10);
// Ile dni wstecz od wczoraj sprawdzać. 5 wystarcza, by poniedziałkowy bieg
// sięgnął piątku (pt = 3 dni wstecz) z zapasem na przegapiony bieg.
const WINDOW = parseInt(process.env.CATCHUP_WINDOW || '5', 10);

function ymd(d) { return d.toISOString().slice(0, 10); }
function statePath(day) { return path.join(DIR, 'state', `wz_${day}_${day}.json`); }
function isComplete(day) {
  try { return !!JSON.parse(fs.readFileSync(statePath(day), 'utf8')).complete; }
  catch { return false; }
}
function clearLock() { try { fs.unlinkSync(LOCK); } catch { /* nie ma */ } }

// Toast Windows przez helper toast.ps1 (best-effort — nigdy nie wywala joba).
// Widoczny tylko w INTERAKTYWNEJ sesji zalogowanego użytkownika.
function toast(title, message) {
  try {
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(DIR, 'toast.ps1'), title, message], { timeout: 20000 });
  } catch { /* powiadomienie to dodatek, nie blokuje pracy */ }
}
function docCount(day) {
  try { return JSON.parse(fs.readFileSync(statePath(day), 'utf8')).processedDocNumbers.length; }
  catch { return 0; }
}

// Dni do zrobienia: od najstarszego (today-WINDOW) do wczoraj (today-1),
// tylko te jeszcze niekompletne wg state/.
const today = new Date();
const targets = [];
for (let back = WINDOW; back >= 1; back--) {
  const d = new Date(today);
  d.setDate(d.getDate() - back);
  const day = ymd(d);
  if (!isComplete(day)) targets.push(day);
}

console.log(`[dobij-wczoraj] ${new Date().toISOString()} okno ${WINDOW} dni -> PRODUKCJA. ` +
  `Do zrobienia: ${targets.join(', ') || '(nic — wszystko kompletne)'}`);
toast('WZ scrape — start', targets.length
  ? `Dobijam do produkcji: ${targets.join(', ')}`
  : 'Nic do zrobienia — wszystko kompletne.');

const done = [];
const failed = [];
for (const day of targets) {
  const env = {
    ...process.env,
    FILTER_DATE: day,
    SCRAPE_TARGET: 'prod',
    HEADLESS: 'true',
    ALLOW_WEEKEND: 'true',         // dzień z weekendu bywa niepusty
    IGNORE_BUSINESS_HOURS: 'true'  // job "musi domknąć" niezależnie od pory
  };
  for (let a = 1; a <= MAX_ATTEMPTS && !isComplete(day); a++) {
    clearLock();
    console.log(`[dobij-wczoraj] ${day} próba ${a}/${MAX_ATTEMPTS} @ ${new Date().toLocaleTimeString()}`);
    const r = spawnSync('node', ['scrape.js'], {
      cwd: DIR, env, stdio: 'inherit', timeout: SESSION_TIMEOUT_MS, killSignal: 'SIGKILL'
    });
    clearLock();
    const timedOut = r.error && r.error.code === 'ETIMEDOUT';
    const crashed = timedOut || (r.status !== 0);
    if (crashed && !isComplete(day) && a < MAX_ATTEMPTS) {
      const why = timedOut ? `przekroczono limit ${Math.round(SESSION_TIMEOUT_MS / 60000)} min` : 'sesja padła';
      console.warn(`[dobij-wczoraj] ${day} próba ${a}: ${why} — wznawiam.`);
      toast('WZ — restart po błędzie', `${day}: ${why}, wznawiam (próba ${a + 1}/${MAX_ATTEMPTS}). Zebrane: ${docCount(day)}.`);
    }
  }
  if (isComplete(day)) {
    console.log(`[dobij-wczoraj] ${day} KOMPLET.`);
    done.push(day);
    toast('WZ — dzień gotowy', `${day}: ${docCount(day)} dok. w produkcji.`);
  } else {
    console.warn(`[dobij-wczoraj] UWAGA: ${day} nie domknięty po ${MAX_ATTEMPTS} próbach — kolejny bieg dokończy ze stanu.`);
    failed.push(day);
    toast('WZ — dzień NIEdomknięty', `${day}: ${docCount(day)} dok., nie ukończono po ${MAX_ATTEMPTS} próbach. Dokończy następny bieg.`);
  }
}
if (targets.length) {
  const parts = [];
  if (done.length) parts.push(`OK: ${done.join(', ')}`);
  if (failed.length) parts.push(`nieukończone: ${failed.join(', ')}`);
  toast('WZ scrape — koniec', parts.join(' | ') || 'brak zmian');
}
process.exit(failed.length ? 1 : 0);
