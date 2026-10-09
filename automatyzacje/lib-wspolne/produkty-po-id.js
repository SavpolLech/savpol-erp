// Scrape produktów po csItemsId + zapis do PRODUKCYJNYCH tabel — wspólne dla
// ręcznego dobij-produkty-po-id.js i kroku „brakujące produkty” w
// orkiestratorze (dobij-wszystko.js). LOCKA NIE BIERZE — robi to wołający.
//
// Kroki (kolejność wg sesji Produkty; skryptów w produkty/ nie modyfikujemy):
//   scrape-po-id.js → wgraj-do-worek → wgraj-jednostki-do-worek
//   → wgraj-zdjecia-do-worek → wgraj-grupy-do-worek (wszystkie z --realne)
// Pierwszy błąd przerywa (żeby nie było połowicznego zapisu bez sygnału).
//
//   const uruchom = require('./lib-wspolne/produkty-po-id');
//   const { ok, krok } = uruchom(['30290482005', '--plik=lista.txt'], 'dobij-produkty');

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROD_DIR = path.join(__dirname, '..', 'produkty');
const WGRAJ = [
  'wgraj-do-worek.js',
  'wgraj-jednostki-do-worek.js',
  'wgraj-zdjecia-do-worek.js',
  'wgraj-grupy-do-worek.js'
];

function brakujaceSkrypty() {
  return ['scrape-po-id.js', ...WGRAJ].filter(f => !fs.existsSync(path.join(PROD_DIR, f)));
}

module.exports = function uruchom(argsScrape, etykieta = 'produkty-po-id') {
  const brak = brakujaceSkrypty();
  if (brak.length) {
    console.error(`[${etykieta}] BŁĄD: brak produkty/${brak.join(', produkty/')} — zrób git pull albo sprawdź sesję Produkty.`);
    return { ok: false, krok: 'brak skryptów' };
  }
  function run(script, args) {
    console.log(`\n[${etykieta}] === ${script} ${args.join(' ')} ===`);
    const r = spawnSync('node', [script, ...args], { cwd: PROD_DIR, stdio: 'inherit' });
    return !r.error && r.status === 0;
  }
  if (!run('scrape-po-id.js', argsScrape)) {
    console.error(`\n[${etykieta}] scrape-po-id.js nie powiódł się — PRZERYWAM przed zapisem do produkcji.`);
    return { ok: false, krok: 'scrape-po-id.js' };
  }
  for (const w of WGRAJ) {
    if (!run(w, ['--realne'])) {
      console.error(`\n[${etykieta}] ${w} --realne nie powiódł się — PRZERYWAM. ` +
        'Scrape jest w produkty/wynik/, część zapisu mogła nie wejść — sprawdź i dokończ ręcznie.');
      return { ok: false, krok: w };
    }
  }
  return { ok: true };
};
