// Stan przebiegu "etykiety MWS" (custom_label_3: kruchy / chlodnia / mroznia)
// — analogiczne do lib/state.js (sekwencyjne SKU), ale tu klucz to csItemsId
// z feedu GMC, nie kolejny numer SKU: lista wejściowa nie jest ciągła, więc
// nie da się "policzyć od ostatniego + 1", trzeba pamiętać DOKŁADNIE które
// id już przetworzono.

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'etykiety-mws.json');
const RUN_LOG_PATH = path.join(__dirname, '..', 'run-log.jsonl');
const OUT_DIR = path.join(__dirname, '..', 'wynik', 'etykiety-mws');

function ensureDirs() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { processedIds: [], notFoundIds: [], lastUpdated: null, runs: [], lastRunNumber: 0 };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

// patch: { newProcessedIds, newNotFoundIds, runSummary }
function saveState(patch) {
  ensureDirs();
  const current = loadState();
  const merged = {
    processedIds: Array.from(new Set(current.processedIds.concat(patch.newProcessedIds || []))),
    notFoundIds: Array.from(new Set(current.notFoundIds.concat(patch.newNotFoundIds || []))),
    lastUpdated: new Date().toISOString(),
    runs: current.runs.concat([patch.runSummary].filter(Boolean)),
    lastRunNumber: patch.runNumber || current.lastRunNumber || 0
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

// Numeracja runów: kolejna liczba po ostatniej zapisanej w stanie — nie
// liczona z listingu plików (ktoś mógłby usunąć/przenieść CSV, numeracja
// ma być trwała niezależnie od tego, co fizycznie leży w wynik/).
function nastepnyNumerRunu() {
  const state = loadState();
  return (state.lastRunNumber || 0) + 1;
}

function appendRunLog(entry) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), tryb: 'etykiety-mws' }, entry));
  fs.appendFileSync(RUN_LOG_PATH, line + '\n', 'utf8');
}

module.exports = {
  loadState, saveState, appendRunLog, nastepnyNumerRunu,
  STATE_DIR, STATE_FILE, RUN_LOG_PATH, OUT_DIR
};
