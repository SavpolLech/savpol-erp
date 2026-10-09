// Faktury zakupu: FZ i FZ_KSEF — karta z URL, podsłuch API karty. Kopia
// sprzedaz/scrape.js; karta pokrywa wszystkie kolumny csDocsHeaders
// i csDocsItemsPositions (mapowanie-pol.md), nic nie wpisujemy jako stałe.
//
// TRYB DZIEŃ: FILTER_DATE=RRRR-MM-DD
//   1. lista „Dokumenty zakupu” z Wpływ (DocReceiptDate) = dzień
//      (lib/lista-dnia.js), kontrola: zebrane wiersze = licznik ERP,
//   2. z listy tylko FZ i FZ_KSEF; te, których csDocsHeadersId już jest
//      w bazie, pomijamy (tylko dopisujemy, ROZBIEZNOSCI.md),
//   3. brakujące: karta → INSERT nagłówka i pozycji w jednej transakcji,
//   4. state/zakup_<dzień>.json: complete=true, gdy lista pełna i każda
//      FZ/FZ_KSEF z dnia jest w bazie; run-log.jsonl + pushLogs na koniec.
//   SCRAPE_TARGET=prod → prawdziwe tabele, inaczej *_test (do akceptacji
//   próbki przez Michała). MAX_DOCS=N — próbka: najwyżej N nowych dokumentów.
//   Sesja kończy się sama po SESJA_MIN minut (domyślnie 60).
//
// TRYB RĘCZNY (kalibracja): zapis kart do wynik/<typ>_<id>.json.
//   node scrape.js 29471619558 ...               (FZ)
//   node scrape.js --typ=FZ_KSEF 28794833412 ... (FZ_KSEF)
//   node scrape.js --plik=lista-id.txt
// Id, które mają już plik w wynik/, są pomijane (--odswiez wymusza ponowne pobranie).

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { chromium } = W.req('playwright');
const { podepnijKarte } = require('./lib/karta');
const { zbierzDzien } = require('./lib/lista-dnia');
const { przygotujZapis } = require('../sprzedaz/lib/zapis');
const { loadState, saveState, appendRunLog } = require('../lib-wspolne/state')(__dirname, 'zakup');
const { pushLogs } = require('../lib-wspolne/git-log-push');

const HEADLESS = process.env.HEADLESS !== 'false';
const ODSWIEZ = process.argv.includes('--odswiez');
const PRZERWA_MS = [1200, 3000];
const DZIEN = process.env.FILTER_DATE || null;
const REALNE = process.env.SCRAPE_TARGET === 'prod';
const SESJA_MS = parseInt(process.env.SESJA_MIN || '60', 10) * 60000;
// Godzina końca z orkiestratora (DO_GODZINY → KONIEC_TS); zapas na zapis stanu i push.
const KONIEC_TS = parseInt(process.env.KONIEC_TS || '0', 10);
const TYPY_DNIA = new Set([W.TYPY.FZ, W.TYPY.FZ_KSEF]);
const MAX_DOCS = parseInt(process.env.MAX_DOCS || '0', 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const przerwa = () => sleep(PRZERWA_MS[0] + Math.random() * (PRZERWA_MS[1] - PRZERWA_MS[0]));

async function otworzPrzegladarke() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  return { browser, page };
}

// ---------- tryb dzień ----------

async function trybDzien() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DZIEN)) throw new Error('FILTER_DATE musi być RRRR-MM-DD, jest: ' + DZIEN);
  const start = Date.now();
  const cel = REALNE ? 'prod' : 'test';
  console.log('[zakup] Dzień ' + DZIEN + ' → ' + (REALNE ? 'PRODUKCJA' : 'tabele _test'));
  const log = { tryb: process.env.PRZEGLAD === '1' ? 'przeglad' : 'dzien', dzien: DZIEN, cel, erpRekordow: null, fz: 0, fzKsef: 0, juzWBazie: 0, wstawiono: 0, pozycji: 0, bezKarty: [], bledyZapisu: [], complete: false };

  const pool = await W.polacz();
  const { browser, page } = await otworzPrzegladarke();
  try {
    const z = await przygotujZapis(pool, REALNE);
    await W.login(page);
    const lista = await zbierzDzien(page, W.ERP_BASE_URL, DZIEN);
    log.erpRekordow = lista.erp;
    console.log('[zakup] Lista: ERP ' + lista.erp + ' rekordów, zebrane ' + lista.wiersze.length + (lista.pelne ? '' : '  <-- NIEPEŁNE'));
    if (lista.obcyDzien.length) console.warn('[zakup] UWAGA: ' + lista.obcyDzien.length + ' wierszy z inną DocReceiptDate niż ' + DZIEN + ' (zapisujemy prawdziwą datę z karty).');

    const dnia = lista.wiersze.filter(w => TYPY_DNIA.has(w.csDocsTypesId));
    log.fz = dnia.filter(w => w.csDocsTypesId === W.TYPY.FZ).length;
    log.fzKsef = dnia.filter(w => w.csDocsTypesId === W.TYPY.FZ_KSEF).length;
    const obecne = await z.obecneId(dnia.map(w => w.csDocsHeadersId));
    log.juzWBazie = obecne.size;
    let brakujace = dnia.filter(w => !obecne.has(w.csDocsHeadersId));
    // Próbka: po jednej z każdego typu na początek, reszta do limitu.
    if (MAX_DOCS > 0) {
      const pierwsze = Object.values(W.TYPY).map(t => brakujace.find(w => w.csDocsTypesId === t)).filter(Boolean);
      brakujace = Array.from(new Set(pierwsze.concat(brakujace))).slice(0, MAX_DOCS);
    }
    console.log('[zakup] FZ ' + log.fz + ', FZ_KSEF ' + log.fzKsef + '; już w bazie ' + obecne.size + ', do pobrania ' + brakujace.length + (MAX_DOCS ? ' (próbka MAX_DOCS=' + MAX_DOCS + ')' : ''));

    const pobierz = podepnijKarte(page);
    const wpisane = Array.from(obecne);
    let przerwanoLimitem = false;
    for (const [n, w] of brakujace.entries()) {
      if (Date.now() - start > SESJA_MS) { przerwanoLimitem = true; console.log('[zakup] Limit sesji ' + (SESJA_MS / 60000) + ' min — reszta w kolejnej próbie.'); break; }
      if (KONIEC_TS && Date.now() > KONIEC_TS - 3 * 60000) { przerwanoLimitem = true; console.log('[zakup] Godzina końca — reszta w następnym biegu.'); break; }
      const tag = '[' + (n + 1) + '/' + brakujace.length + '] ' + w.DocNumber;
      const k = await pobierz(w.csDocsHeadersId);
      if (!k) { log.bezKarty.push(w.csDocsHeadersId); console.warn(tag + ': BRAK karty'); continue; }
      if (String(k.naglowek.csDocsTypesId) !== w.csDocsTypesId) {
        log.bezKarty.push(w.csDocsHeadersId);
        console.warn(tag + ': karta ma typ ' + k.naglowek.csDocsTypesId + ', lista ' + w.csDocsTypesId + ' — pomijam');
        continue;
      }
      try {
        await z.wstaw(k);
      } catch (e) {
        log.bledyZapisu.push({ id: w.csDocsHeadersId, blad: e.message.slice(0, 300) });
        console.warn(tag + ': BŁĄD zapisu: ' + e.message);
        continue;
      }
      wpisane.push(w.csDocsHeadersId);
      log.wstawiono++; log.pozycji += k.pozycje.length;
      if (log.wstawiono % 25 === 0) saveState(DZIEN, DZIEN, { newDocNumbers: wpisane });
      console.log(tag + ': ' + k.pozycje.length + ' poz.');
      await przerwa();
    }

    // Kompletny = lista pełna, bez limitu próbki i każda FZ/FZ_KSEF z dnia jest w bazie (sprawdzone
    // w bazie, nie z pamięci przebiegu).
    const poZapisie = await z.obecneId(dnia.map(w => w.csDocsHeadersId));
    log.complete = lista.pelne && !przerwanoLimitem && !MAX_DOCS && poZapisie.size === dnia.length;
    saveState(DZIEN, DZIEN, {
      newDocNumbers: Array.from(poZapisie), complete: log.complete,
      runSummary: { ts: new Date().toISOString(), erp: lista.erp, fz: log.fz, fzKsef: log.fzKsef, wstawiono: log.wstawiono, complete: log.complete }
    });
    console.log('[zakup] ' + DZIEN + ': wstawiono ' + log.wstawiono + ' dok. (' + log.pozycji + ' poz.), w bazie ' +
      poZapisie.size + '/' + dnia.length + ', complete=' + log.complete);
  } catch (e) {
    log.blad = e.message;
    throw e;
  } finally {
    log.sekundy = Math.round((Date.now() - start) / 1000);
    try { await browser.close(); } catch (e) { /* już zamknięta */ }
    try { await pool.close(); } catch (e) { /* już zamknięte */ }
    appendRunLog(log);
    pushLogs('zakup', DZIEN + '..' + DZIEN);
  }
}

// ---------- tryb ręczny (id → wynik/) ----------

function listaIdZArgumentow() {
  const args = process.argv.slice(2);
  let ids = args.filter(a => /^\d+$/.test(a));
  const plik = args.find(a => a.startsWith('--plik='));
  if (plik) ids = ids.concat(fs.readFileSync(plik.slice(7), 'utf8').split(/[\s,;]+/).filter(s => /^\d+$/.test(s)));
  return Array.from(new Set(ids));
}

async function trybId() {
  const TYP = W.typZArgumentow(process.argv);
  const ids = listaIdZArgumentow();
  if (!ids.length) throw new Error('Podaj id dokumentów (csDocsHeadersId), --plik=... albo FILTER_DATE=RRRR-MM-DD');
  fs.mkdirSync(W.OUT_DIR, { recursive: true });
  const doPobrania = ODSWIEZ ? ids : ids.filter(id => !fs.existsSync(W.plikWyniku(TYP.kod, id)));
  console.log('[start] Id: ' + ids.length + ', do pobrania: ' + doPobrania.length +
    (ids.length - doPobrania.length ? ' (reszta już jest w wynik/)' : ''));
  if (!doPobrania.length) return;

  const { browser, page } = await otworzPrzegladarke();
  const pobierz = podepnijKarte(page);
  let ok = 0;
  const bledy = [];
  try {
    await W.login(page);
    for (const [n, id] of doPobrania.entries()) {
      const tag = '[' + (n + 1) + '/' + doPobrania.length + '] ' + id;
      const w = await pobierz(id);
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
      fs.writeFileSync(W.plikWyniku(TYP.kod, id), JSON.stringify({
        csDocsHeadersId: id, pobrano: new Date().toISOString(), zrodlo: 'csDocsHeaders_Purchase',
        naglowek: w.naglowek, pozycje: w.pozycje
      }, null, 1), 'utf8');
      ok++;
      console.log(tag + ': ' + w.naglowek.DocNumber + ', pozycji ' + w.pozycje.length);
      await przerwa();
    }
  } finally {
    await browser.close();
  }
  console.log('[koniec] Pobrano ' + ok + '/' + doPobrania.length + ' dokumentów ' + TYP.kod + '.' + (bledy.length ? ' Bez karty / zły typ: ' + bledy.join(', ') : ''));
  if (bledy.length) process.exitCode = 2;
}

W.zajmijErp();
(DZIEN ? trybDzien() : trybId()).catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
