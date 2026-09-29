// GLOBALNY lock dla scraperów ERP — jeden plik dla wszystkich typów, żeby
// żaden bieg (codzienny orkiestrator dobij-wszystko.js ani ręczny dobij-dzien.js)
// nie wszedł na ERP równolegle z innym. ERP znosi tylko jedną sesję logowania.
//
// Lock trzyma PID + znacznik czasu. Zajęty świeży lock = odmowa (inny bieg
// trwa). Lock starszy niż staleMs = osierocony (proces padł bez sprzątnięcia) —
// przejmujemy. Zwalniamy TYLKO własny lock (jeśli ktoś w międzyczasie przejął,
// nie kasujemy cudzego).
//
//   const { acquire, release } = require('./lib-wspolne/lock')(LOCK_PATH);
//   if (!acquire()) process.exit(3);
//   process.on('exit', release);

const fs = require('fs');

// staleMs: po ilu ms lock uznajemy za osierocony. Domyślnie 12 h > najdłuższy
// realny bieg (3 typy × okno × sesje), więc żywy przebieg nie wyprzedzi sam
// siebie, a trup nie blokuje kolejnego dnia.
module.exports = function createLock(lockPath, opts = {}) {
  const staleMs = opts.staleMs || 12 * 60 * 60 * 1000;

  function acquire() {
    try {
      const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const age = Date.now() - new Date(info.ts).getTime();
      if (age < staleMs) {
        console.error(`[lock] LOCK zajęty przez PID ${info.pid} od ${info.ts} ` +
          `(${Math.round(age / 60000)} min temu). Inny bieg trwa — nie wchodzę równolegle na ERP.`);
        return false;
      }
      console.warn(`[lock] LOCK przeterminowany (${Math.round(age / 60000)} min) — przejmuję.`);
    } catch { /* brak locka albo śmieć w pliku — bierzemy */ }
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), 'utf8');
    return true;
  }

  function release() {
    try {
      const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (info.pid === process.pid) fs.unlinkSync(lockPath);
    } catch { /* już nie ma albo cudzy — zostaw */ }
  }

  return { acquire, release };
};
