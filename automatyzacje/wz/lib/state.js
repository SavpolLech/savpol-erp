// Stan postępu dla danego zakresu dat + dziennik przebiegów.
//
// PO CO: bez tego każde uruchomienie zaczynało zbieranie od nowa, od
// pierwszej strony listy — jeśli poprzedni przebieg urwał się w połowie
// (limit sesji, błąd), powtarzaliśmy klikanie tych samych dokumentów.
// Plik stanu pamięta, które numery WZ już zebrano dla danego zakresu dat,
// więc kolejne uruchomienie je pomija (nie klika ponownie) i kontynuuje.
//
// Osobno: dziennik przebiegów (log append-only) — co, kiedy, ile, czy
// częściowo — do wglądu bez grzebania w konsoli.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const RUN_LOG_PATH = path.join(__dirname, '..', 'run-log.jsonl');

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function rangeKey(dateFrom, dateTo) {
  return (dateFrom || 'brak') + '_' + (dateTo || dateFrom || 'brak');
}

function stateFilePath(dateFrom, dateTo) {
  return path.join(STATE_DIR, 'wz_' + rangeKey(dateFrom, dateTo) + '.json');
}

function loadState(dateFrom, dateTo) {
  const p = stateFilePath(dateFrom, dateTo);
  if (!fs.existsSync(p)) {
    return { dateFrom, dateTo, processedDocNumbers: [], complete: false, lastUpdated: null, runs: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Scala nowo zebrane numery z tym, co już było — bez duplikatów. `complete`
// raz ustawione na true zostaje true (kolejny przebieg na ten sam zakres,
// jeśli w ogóle ma sens, nie cofa tego ustalenia przez przypadek).
function saveState(dateFrom, dateTo, patch) {
  ensureStateDir();
  const current = loadState(dateFrom, dateTo);
  const merged = {
    dateFrom, dateTo,
    processedDocNumbers: Array.from(new Set(current.processedDocNumbers.concat(patch.newDocNumbers || []))),
    complete: current.complete || !!patch.complete,
    lastUpdated: new Date().toISOString(),
    runs: current.runs.concat([patch.runSummary].filter(Boolean))
  };
  fs.writeFileSync(stateFilePath(dateFrom, dateTo), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function appendRunLog(entry) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry));
  fs.appendFileSync(RUN_LOG_PATH, line + '\n', 'utf8');
}

module.exports = { loadState, saveState, appendRunLog, stateFilePath, STATE_DIR, RUN_LOG_PATH };
