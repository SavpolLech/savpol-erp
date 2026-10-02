// Playwright: loguje się do ERP i dla każdego csDocsHeadersId dokumentu sprzedaży
// (faktura FA albo paragon PAR — ta sama karta) otwiera ją WPROST z URL, podsłuchując odpowiedź API karty (jak kontrahenci/).
//
// Karta zwraca w jednym zapytaniu dwie tabele: nagłówek (DataSetSQLIdent
// csdocsheaders, 371 pól) i pozycje (csdocsitemspositions, 168 pól). To pokrywa
// wszystkie 273 kolumny csDocsHeaders i 120 kolumn csDocsItemsPositions
// (sprawdzone 2026-10-02, patrz mapowanie-pol.md) — nic nie włączamy w widokach
// ERP i nie wpisujemy stałych. Do wynik/ zapisujemy CAŁE rekordy.
//
// Uruchomienie:
//   node scrape.js 29471374725 29458418811 ...   (konkretne id faktur)
//   node scrape.js --typ=PAR 29458272753 ...     (paragony; zapis do wynik/par_<id>.json)
//   node scrape.js --plik=lista-id.txt           (id rozdzielone białymi znakami/przecinkami)
// Id, które mają już plik w wynik/, są pomijane (--odswiez wymusza ponowne pobranie).

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { chromium } = W.req('playwright');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));

const HEADLESS = process.env.HEADLESS !== 'false';
const ODSWIEZ = process.argv.includes('--odswiez');
const PRZERWA_MS = [1200, 3000];
const TYP = W.typZArgumentow(process.argv);

const plikWyniku = id => path.join(W.OUT_DIR, TYP.prefiks + '_' + id + '.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function listaIdZArgumentow() {
  const args = process.argv.slice(2);
  let ids = args.filter(a => /^\d+$/.test(a));
  const plik = args.find(a => a.startsWith('--plik='));
  if (plik) ids = ids.concat(fs.readFileSync(plik.slice(7), 'utf8').split(/[\s,;]+/).filter(s => /^\d+$/.test(s)));
  return Array.from(new Set(ids));
}

async function main() {
  const ids = listaIdZArgumentow();
  if (!ids.length) throw new Error('Podaj id dokumentów (csDocsHeadersId) albo --plik=...');
  fs.mkdirSync(W.OUT_DIR, { recursive: true });
  const doPobrania = ODSWIEZ ? ids : ids.filter(id => !fs.existsSync(plikWyniku(id)));
  console.log('[start] Id: ' + ids.length + ', do pobrania: ' + doPobrania.length +
    (ids.length - doPobrania.length ? ' (reszta już jest w wynik/)' : ''));
  if (!doPobrania.length) return;

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  // csDocsHeadersId → { naglowek, pozycje }. Nagłówek i pozycje przychodzą
  // w tej samej odpowiedzi, ale nie zakładamy tego — składamy po id.
  const zlapane = new Map();
  const wpis = id => { if (!zlapane.has(id)) zlapane.set(id, { naglowek: null, pozycje: null }); return zlapane.get(id); };
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList;
    if (!ret) return;
    for (let i = 0; i < ret.length; i++) {
      const t = extractCardRecord({ Result: { RefreshObjectReturnList: [ret[i]] } });
      if (!t) continue;
      const ident = String(t.dataSetIdent || '').toLowerCase();
      if (ident === 'csdocsheaders' && t.records[0] && t.fieldNames.length > 250) {
        wpis(String(t.records[0].csDocsHeadersId)).naglowek = t.records[0];
      } else if (ident === 'csdocsitemspositions') {
        // Pusta faktura (0 pozycji) też jest odpowiedzią — wtedy nie znamy id
        // z wierszy; pusta lista trafia do faktury, na którą czekamy (ostatni wpis).
        const id = t.records[0] ? String(t.records[0].csDocsHeadersId) : ostatnieId;
        if (id) wpis(id).pozycje = t.records;
      }
    }
  });
  let ostatnieId = null;

  let ok = 0;
  const bledy = [];
  try {
    await W.login(page);
    for (const [n, id] of doPobrania.entries()) {
      zlapane.delete(id);
      ostatnieId = id;
      let w = null;
      for (let proba = 1; proba <= 2 && !w; proba++) {
        await page.goto(W.cardUrl(id), { waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 80; i++) {
          const z = zlapane.get(id);
          if (z && z.naglowek && z.pozycje) { w = z; break; }
          await sleep(250);
        }
      }
      const tag = '[' + (n + 1) + '/' + doPobrania.length + '] ' + id;
      if (!w) {
        bledy.push(id);
        console.warn(tag + ': BRAK karty (zły id, brak uprawnień albo nie przyszły pozycje)');
        continue;
      }
      const typ = String(w.naglowek.csDocsTypesId);
      if (typ !== TYP.id) {
        // Nie zapisujemy pod złym prefiksem — wgraj/porownaj filtrują po typie.
        bledy.push(id);
        console.warn(tag + ': typ ' + typ + ' to nie ' + TYP.kod + ' ' + TYP.id + ' — pomijam (sprawdź --typ)');
        continue;
      }
      fs.writeFileSync(plikWyniku(id), JSON.stringify({
        csDocsHeadersId: id, pobrano: new Date().toISOString(), zrodlo: 'csDocsHeaders_Sales',
        naglowek: w.naglowek, pozycje: w.pozycje
      }, null, 1), 'utf8');
      ok++;
      console.log(tag + ': ' + w.naglowek.DocNumber + ', pozycji ' + w.pozycje.length);
      await sleep(PRZERWA_MS[0] + Math.random() * (PRZERWA_MS[1] - PRZERWA_MS[0]));
    }
  } finally {
    await browser.close();
  }
  console.log('[koniec] Pobrano ' + ok + '/' + doPobrania.length + ' dokumentów ' + TYP.kod + '.' + (bledy.length ? ' Bez karty / zły typ: ' + bledy.join(', ') : ''));
  if (bledy.length) process.exitCode = 2;
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
