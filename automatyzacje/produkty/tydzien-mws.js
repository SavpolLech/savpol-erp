// Cotygodniowe odświeżenie flag wysyłkowych (chłodnia / mroźnia / kruche) i bazy cross-sellu.
// Odpala Harmonogram zadań Windows przez tydzien-mws.bat (zadanie "SavpolMWS-tydzien").
//
//   1. scrape-etykiety-mws.js — tylko NOWE produkty z feedu GMC (stan w state/etykiety-mws.json
//      pomija zrobione; dane produktu praktycznie się nie zmieniają — DECYZJA Lecha 2026-09-28).
//      Wyjście konsoli dopisywane do sesje-log.txt — scal-etykiety-mws.js czyta właśnie stamtąd.
//   2. scal-etykiety-mws.js + scal-finalny-etykiety.js → wynik/etykiety-finalne.csv.
//   3. design_system odswiez.mjs — baza powiązań z flagami MWS → commit na origin/main
//      repo esavpol-pdp (endpoint cross-sell-public/v2 czyta ją w locie).
//
// Kontrakt z design_system: CSV id,custom_label_1,custom_label_2,custom_label_3 (id = csItemsId),
// wartości chlodnia / mroznia / kruche / puste. Konsument: scripts/baza-powiazan/mws.mjs.
// Błąd kroku 1 nie blokuje 2–3 (CSV z poprzedniego tygodnia jest nadal poprawny).
//
// Uruchomienie ręczne: node tydzien-mws.js [--bez-push] [--minuty=40]

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const DIR = __dirname;
// Osobny, czysty worktree design_system tylko dla tego zadania (w głównym klonie leżą zmiany
// innych sesji). Zakładanie: patrz info/etykiety-mws-handoff.md, sekcja „Harmonogram”.
const DS = process.env.DS_BAZA_WORKTREE || 'C:\\Users\\l.dudkiewicz\\Documents\\claude_code\\design_system-baza';
const ODSWIEZ = path.join(DS, 'tools', 'pdp-generator', 'scripts', 'baza-powiazan', 'odswiez.mjs');
const CSV = path.join(DIR, 'wynik', 'etykiety-finalne.csv');
const SESJE_LOG = path.join(DIR, 'sesje-log.txt');

const args = process.argv.slice(2);
const minuty = (args.find(a => a.startsWith('--minuty=')) || '--minuty=40').slice('--minuty='.length);

function log(msg) { console.log('[' + new Date().toISOString().slice(0, 19) + '] [tydzien-mws] ' + msg); }

function krok(nazwa, cmd, cmdArgs, opts) {
  log('START ' + nazwa);
  const r = spawnSync(cmd, cmdArgs, Object.assign({ cwd: DIR, encoding: 'utf8', maxBuffer: 1 << 28 }, opts));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const ok = r.status === 0;
  log((ok ? 'OK ' : 'BŁĄD (kod ' + r.status + (r.error ? ', ' + r.error.message : '') + ') ') + nazwa);
  return r;
}

function main() {
  log('start, worktree design_system: ' + DS);

  const s = krok('scrape nowych produktów z ERP', process.execPath,
    ['scrape-etykiety-mws.js', '100000', '--minuty=' + minuty], { env: Object.assign({}, process.env, { HEADLESS: 'true' }) });
  fs.appendFileSync(SESJE_LOG, '\n=== tydzien-mws ' + new Date().toISOString() + ' ===\n' + (s.stdout || '') + (s.stderr || ''));

  if (krok('scal etykiety', process.execPath, ['scal-etykiety-mws.js']).status !== 0) return 1;
  if (krok('scal finalny (feed GMC + kategorie)', process.execPath, ['scal-finalny-etykiety.js']).status !== 0) return 1;

  if (!fs.existsSync(ODSWIEZ)) { log('brak ' + ODSWIEZ + ' — baza powiązań NIE odświeżona'); return 1; }
  const b = krok('baza powiązań (design_system)', process.execPath,
    [ODSWIEZ, '--csv=' + CSV].concat(args.includes('--bez-push') ? ['--bez-push'] : []), { cwd: DS });
  return b.status === 0 ? 0 : 1;
}

process.exit(main());
