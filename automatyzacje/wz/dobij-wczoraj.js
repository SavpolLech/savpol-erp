// LOKALNY "dobij zaległe dni WZ -> PRODUKCJA" — do Harmonogramu Zadań Windows
// na maszynie Lecha. Cała logika nadganiania mieszka teraz w
// lib-wspolne/catchup.js (żeby nie było dwóch kopii — używa jej też serwerowy
// orkiestrator dobij-wszystko.js). Ten plik to cienka nakładka: podaje katalog
// WZ, prefiks stanu i podpina toasty Windows (widoczne tylko w LOKALNEJ,
// interaktywnej sesji Lecha — na serwerze headless nikt nie patrzy, więc
// orkiestrator toastów nie podaje).
//
// Zadanie odpala się TYLKO w dni robocze (pon-pt). Weekend nie wypada z
// pokrycia, bo catchup bierze każdy niekompletny dzień z okna wstecz
// (CATCHUP_WINDOW=5) — poniedziałkowy bieg sam dobiera piątek + sobotę +
// niedzielę (sob/nd BYWAJĄ niepuste). Pisze WPROST do tabel produkcyjnych.
//
// Uruchomienie ręczne (test):  node dobij-wczoraj.js
//   CATCHUP_WINDOW=8 node dobij-wczoraj.js   # szersze okno nadganiania

const { spawnSync } = require('child_process');
const path = require('path');
const runCatchup = require('../lib-wspolne/catchup');

// Toast Windows przez helper toast.ps1 (best-effort — nigdy nie wywala joba).
// Widoczny tylko w INTERAKTYWNEJ sesji zalogowanego użytkownika.
function toast(title, message) {
  try {
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'toast.ps1'), title, message], { timeout: 20000 });
  } catch { /* powiadomienie to dodatek, nie blokuje pracy */ }
}

const { failed } = runCatchup({
  dir: __dirname,
  prefix: 'wz',
  label: 'WZ',
  onEvent: (_kind, title, message) => toast(title, message)
});

process.exit(failed.length ? 1 : 0);
