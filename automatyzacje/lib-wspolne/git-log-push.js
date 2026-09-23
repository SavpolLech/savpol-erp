// WSPÓLNY moduł dla wszystkich scraperów per typ dokumentu (wz/mm/pz/...).
// Po każdym przebiegu automatyzacja sama commituje i pushuje dziennik
// (run-log.jsonl) i stan postępu (state/) do repo — żeby było widać co się
// dzieje bez bezpośredniego dostępu do maszyny, na której to leci (docelowo:
// firmowy serwer, bez konta dla Claude).
//
// Wcześniej każdy scraper miał WŁASNĄ kopię tego pliku, różniącą się tylko
// nazwą katalogu i etykietą commita — czysty duplikat, który dryfował. Teraz
// jedna kopia, a tożsamość typu (`scraper`, np. 'wz') przychodzi parametrem.
//
// WYMAGANIE PO STRONIE SERWERA: `git push` musi działać BEZ interakcji
// (skonfigurowany klucz SSH albo zapisane dane logowania dla tego repo) —
// to trzeba ustawić raz przy stawianiu automatyzacji na serwerze, nie da się
// tego zrobić z samego kodu.
//
// Nigdy nie rzuca wyjątku dalej — błąd gita (brak sieci, brak configu) ma
// zostać w logu jako ostrzeżenie, NIE ma wywalić całego przebiegu
// scrapowania, które już i tak się udało.

const { execFileSync } = require('child_process');
const path = require('path');

// Z automatyzacje/lib-wspolne do korzenia repo są DWA poziomy w górę.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// scraper: nazwa katalogu automatyzacji (np. 'wz', 'mm', 'pz') — wyznacza
// zarówno ścieżki do commitowania, jak i etykietę (WZ/MM/PZ).
function pushLogs(scraper, label) {
  const runLog = 'automatyzacje/' + scraper + '/run-log.jsonl';
  const stateDir = 'automatyzacje/' + scraper + '/state';
  try {
    git(['add', runLog, stateDir]);

    const status = git(['status', '--porcelain', '--', runLog, stateDir]);
    if (!status.trim()) {
      console.log('[git-log-push] Brak zmian w logu/stanie — nic do commitowania.');
      return;
    }

    git(['commit', '-m', 'Log automatyzacji ' + scraper.toUpperCase() + (label ? ' — ' + label : '')]);
    git(['push']);
    console.log('[git-log-push] Log i stan wypchnięte do repo.');
  } catch (err) {
    console.warn('[git-log-push] UWAGA: nie udało się zapisać/wypchnąć logu do gita: ' +
      (err.stderr || err.message));
  }
}

module.exports = { pushLogs };
