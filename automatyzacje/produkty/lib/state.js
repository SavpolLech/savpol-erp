// Stan postępu sekwencyjnego scrapowania produktów + dziennik przebiegów.
// Ta sama logika i te same nazwy funkcji co automatyzacje/wz/lib/state.js —
// żeby ktoś, kto zna jeden scraper, od razu odnalazł się w drugim.
//
// PO CO: Michał podał punkt startowy (ostatni SKU już w bazie: 0033222,
// więc scrapujemy 0033223 w górę) i idziemy przyrostowo, bez końca zakresu.
// Bez zapisanego stanu każde uruchomienie zaczynałoby zgadywać od nowa, od
// którego SKU kontynuować. Plik stanu pamięta, które numery już
// przetworzyliśmy (i które numery w ogóle NIE ISTNIEJĄ w katalogu — SKU są
// przyrostowe, ale nie każdy numer musi być zajęty), więc kolejne
// uruchomienie kontynuuje, a nie próbuje ponownie tych samych.
//
// Osobno: dziennik przebiegów (log append-only) — co, kiedy, ile, jak długo —
// do wglądu bez grzebania w konsoli. Ten sam plik run-log.jsonl co przy
// pojedynczych/ręcznych uruchomieniach scrape.js (współdzielony, bo to ten
// sam scraper, tylko inny tryb wyboru SKU).

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const RUN_LOG_PATH = path.join(__dirname, '..', 'run-log.jsonl');

// Jeden ciągły strumień (nie ma "zakresu dat" jak w WZ) — jeden plik stanu.
const STATE_FILE = path.join(STATE_DIR, 'sekwencja.json');

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { processedSkus: [], notFoundSkus: [], lastUpdated: null, runs: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

// Scala nowo zebrane/nieznalezione SKU z tym, co już było — bez duplikatów.
function saveState(patch) {
  ensureStateDir();
  const current = loadState();
  const merged = {
    processedSkus: Array.from(new Set(current.processedSkus.concat(patch.newProcessedSkus || []))),
    notFoundSkus: Array.from(new Set(current.notFoundSkus.concat(patch.newNotFoundSkus || []))),
    lastUpdated: new Date().toISOString(),
    runs: current.runs.concat([patch.runSummary].filter(Boolean))
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function appendRunLog(entry) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry));
  fs.appendFileSync(RUN_LOG_PATH, line + '\n', 'utf8');
}

module.exports = { loadState, saveState, appendRunLog, STATE_DIR, STATE_FILE, RUN_LOG_PATH };
