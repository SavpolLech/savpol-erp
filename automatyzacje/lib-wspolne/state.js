// WSPÓLNY moduł stanu dla scraperów per typ dokumentu z zakresem dat
// (wz/mm/pz/...). Stan postępu dla danego zakresu dat + dziennik przebiegów.
//
// Wcześniej każdy scraper miał WŁASNĄ kopię, różniącą się tylko prefiksem
// pliku stanu ('wz_'/'mm_'/'pz_') i komentarzem — reszta identyczna. Teraz
// jedna kopia jako FABRYKA: wołający podaje swój katalog bazowy i prefiks,
// dostaje ten sam zestaw funkcji co dotąd.
//
//   const { loadState, saveState, appendRunLog } =
//     require('../lib-wspolne/state')(__dirname, 'wz');
//
// (scraper produktów ma inny model — pojedynczy plik sekwencyjny, bez zakresu
// dat — i zostaje przy własnym automatyzacje/produkty/lib/state.js.)
//
// PO CO: bez tego każde uruchomienie zaczynało zbieranie od nowa, od
// pierwszej strony listy — jeśli poprzedni przebieg urwał się w połowie
// (limit sesji, błąd), powtarzaliśmy klikanie tych samych dokumentów.
// Plik stanu pamięta, które numery dokumentów już zebrano dla danego zakresu
// dat, więc kolejne uruchomienie je pomija (nie klika ponownie) i kontynuuje.
//
// Osobno: dziennik przebiegów (log append-only) — co, kiedy, ile, czy
// częściowo — do wglądu bez grzebania w konsoli.

const fs = require('fs');
const path = require('path');

// baseDir: katalog scrapera (ten, w którym leży state/ i run-log.jsonl) —
//          przekaż `__dirname` ze scrape.js danego typu.
// prefix:  identyfikator typu w nazwie pliku stanu, np. 'wz' -> wz_<zakres>.json
module.exports = function createState(baseDir, prefix) {
  const STATE_DIR = path.join(baseDir, 'state');
  const RUN_LOG_PATH = path.join(baseDir, 'run-log.jsonl');

  function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  function rangeKey(dateFrom, dateTo) {
    return (dateFrom || 'brak') + '_' + (dateTo || dateFrom || 'brak');
  }

  function stateFilePath(dateFrom, dateTo) {
    return path.join(STATE_DIR, prefix + '_' + rangeKey(dateFrom, dateTo) + '.json');
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

  return { loadState, saveState, appendRunLog, stateFilePath, STATE_DIR, RUN_LOG_PATH };
};
