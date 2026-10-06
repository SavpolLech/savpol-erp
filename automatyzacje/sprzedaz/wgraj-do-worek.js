// Wgrywa zescrapowane dokumenty sprzedaży (FA/PAR, JSON z wynik/) do bazy "worek", do tabel
// TESTOWYCH dbo.csDocsHeaders_test / dbo.csDocsItemsPositions_test (Michał:
// faktury ładujemy jak WZ/MM/PZ). Karta ERP pokrywa wszystkie kolumny obu
// tabel, więc próbkę da się porównać z produkcją 1:1 (porownaj-z-prod.js).
//
// Tylko dopisujemy: faktura (csDocsHeadersId) już obecna w tabeli nagłówków
// jest pomijana razem z pozycjami, istniejących wierszy nie zmieniamy
// (decyzja 2026-09-30, ROZBIEZNOSCI.md).
//
// Uruchomienie: node wgraj-do-worek.js [--typ=FA|PAR] [id...] [--realne]
// Bez id bierze wszystkie wynik/<typ>_*.json (domyślnie fa_*).
// --realne: pisz do PRAWDZIWYCH tabel — dopiero po akceptacji próbki przez Michała.

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { przygotujZapis } = require('./lib/zapis');

const REALNE = process.argv.includes('--realne');
const TYP = W.typZArgumentow(process.argv);

function wczytajWyniki(filtr) {
  if (!fs.existsSync(W.OUT_DIR)) return [];
  return fs.readdirSync(W.OUT_DIR)
    .filter(f => f.startsWith(TYP.prefiks + '_') && /_\d+\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(W.OUT_DIR, f), 'utf8')))
    .filter(d => !filtr.length || filtr.includes(String(d.csDocsHeadersId)));
}

async function main() {
  const filtr = process.argv.slice(2).filter(a => /^\d+$/.test(a));
  const wyniki = wczytajWyniki(filtr);
  if (!wyniki.length) throw new Error('Brak wyników w ' + W.OUT_DIR + ' (uruchom najpierw scrape.js).');
  const pool = await W.polacz();
  try {
    const z = await przygotujZapis(pool, REALNE);
    console.log('[wgraj] ' + TYP.kod + ' do wgrania: ' + wyniki.length + ' → dbo.' + z.TAB_N + ' / dbo.' + z.TAB_P);
    const obecne = await z.obecneId(wyniki.map(w => w.csDocsHeadersId));
    const nowe = wyniki.filter(w => !obecne.has(String(w.csDocsHeadersId)));
    if (obecne.size) console.log('[wgraj] Pomijam ' + obecne.size + ' dokumentów już obecnych w dbo.' + z.TAB_N + ' (tylko dopisujemy).');
    let dok = 0, poz = 0;
    for (const w of nowe) { await z.wstaw(w); dok++; poz += w.pozycje.length; }
    console.log('[wgraj] SUKCES: wstawiono ' + dok + ' dokumentów ' + TYP.kod + ' i ' + poz + ' pozycji.');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj] BŁĄD:', err.message); process.exit(1); });
