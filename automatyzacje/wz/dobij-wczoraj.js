// LOKALNY "dobij wczoraj -> PRODUKCJA" — do Harmonogramu Zadań Windows na
// maszynie Lecha, jako rozwiązanie PRZEJŚCIOWE, zanim stanie właściwy serwer
// (patrz serwer/ + INSTRUKCJA-TOMEK.md). Odpala scrape.js dla WCZORAJSZEGO
// dnia tyle razy, ile trzeba, aż dzień będzie kompletny (allPagesExhausted),
// pisząc WPROST do tabel produkcyjnych (SCRAPE_TARGET=prod).
//
// PO CO pętla: pełny dzień (~800 dok.) często nie mieści się w jednej sesji
// (limit czasu 30-60 min w scrape.js) — kolejna sesja wznawia ze stanu
// (state/). Pusty dzień domyka się w jednej próbie (fix expectedTotal===0).
//
// Uruchamiane przez Harmonogram (raz dziennie, też w weekend). Działa pod
// zablokowanym ekranem (proces żyje, dopóki użytkownik jest zalogowany), a
// przy opcji zadania "Uruchom niezależnie od tego, czy użytkownik jest
// zalogowany" — także po wylogowaniu. NIE wymaga otwartej aplikacji Claude.
//
// Uruchomienie ręczne (test):  node dobij-wczoraj.js
//   FILTER_DATE=YYYY-MM-DD node dobij-wczoraj.js   # konkretny dzień zamiast "wczoraj"

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const LOCK = path.join(DIR, '.scrape.lock');
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '6', 10);

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
// Rozstrzygamy datę TU i podajemy scrape.js jawnie, żeby uniknąć rozjazdu na
// granicy północy (dwa procesy liczące "wczoraj" w różnych sekundach).
const DAY = (process.env.FILTER_DATE && process.env.FILTER_DATE !== 'wczoraj')
  ? process.env.FILTER_DATE : yesterday();
const statePath = path.join(DIR, 'state', `wz_${DAY}_${DAY}.json`);

function isComplete() {
  try { return !!JSON.parse(fs.readFileSync(statePath, 'utf8')).complete; }
  catch { return false; }
}
function clearLock() { try { fs.unlinkSync(LOCK); } catch { /* nie ma */ } }

const env = {
  ...process.env,
  FILTER_DATE: DAY,
  SCRAPE_TARGET: 'prod',
  HEADLESS: 'true',
  ALLOW_WEEKEND: 'true',        // weekend bywa niepusty — nie pomijamy
  IGNORE_BUSINESS_HOURS: 'true' // job "musi domknąć wczoraj" niezależnie od pory
};

console.log(`[dobij-wczoraj] Dzień ${DAY} -> PRODUKCJA. Start ${new Date().toISOString()}`);
if (isComplete()) {
  console.log(`[dobij-wczoraj] ${DAY} już kompletny (state/) — nic do roboty.`);
  process.exit(0);
}
for (let a = 1; a <= MAX_ATTEMPTS && !isComplete(); a++) {
  clearLock();
  console.log(`[dobij-wczoraj] próba ${a}/${MAX_ATTEMPTS} @ ${new Date().toLocaleTimeString()}`);
  spawnSync('node', ['scrape.js'], { cwd: DIR, env, stdio: 'inherit' });
  clearLock();
}
if (isComplete()) {
  console.log(`[dobij-wczoraj] ${DAY} KOMPLET.`);
  process.exit(0);
} else {
  console.warn(`[dobij-wczoraj] UWAGA: ${DAY} nie domknięty po ${MAX_ATTEMPTS} próbach — kolejne uruchomienie dokończy ze stanu.`);
  process.exit(1);
}
