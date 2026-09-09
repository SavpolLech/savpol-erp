// Po każdym przebiegu automatyzacja sama commituje i pushuje dziennik
// (run-log.jsonl) i stan postępu (state/) do repo — żeby było widać co się
// dzieje bez bezpośredniego dostępu do maszyny, na której to leci (docelowo:
// firmowy serwer, bez konta dla Claude).
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

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pushLogs(label) {
  try {
    git(['add', 'automatyzacje/wz/run-log.jsonl', 'automatyzacje/wz/state']);

    const status = git(['status', '--porcelain', '--', 'automatyzacje/wz/run-log.jsonl', 'automatyzacje/wz/state']);
    if (!status.trim()) {
      console.log('[git-log-push] Brak zmian w logu/stanie — nic do commitowania.');
      return;
    }

    git(['commit', '-m', 'Log automatyzacji WZ' + (label ? ' — ' + label : '')]);
    git(['push']);
    console.log('[git-log-push] Log i stan wypchnięte do repo.');
  } catch (err) {
    console.warn('[git-log-push] UWAGA: nie udało się zapisać/wypchnąć logu do gita: ' +
      (err.stderr || err.message));
  }
}

module.exports = { pushLogs };
