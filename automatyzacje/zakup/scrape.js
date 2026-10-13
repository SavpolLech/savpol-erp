// Faktury zakupu: FZ i FZ_KSEF — karta z URL, podsłuch API karty. Kopia
// sprzedaz/scrape.js; karta pokrywa wszystkie kolumny csDocsHeaders
// i csDocsItemsPositions (mapowanie-pol.md), nic nie wpisujemy jako stałe.
//
// TRYB DZIEŃ: FILTER_DATE=RRRR-MM-DD
//   1. lista „Dokumenty zakupu” z Wpływ (DocReceiptDate) = dzień
//      (lib/lista-dnia.js), kontrola: zebrane wiersze = licznik ERP,
//   2. z listy tylko FZ i FZ_KSEF w statusie ZAKSIĘGOWANE (Michał 2026-10-09);
//      te, których csDocsHeadersId już jest w bazie, pomijamy (tylko
//      dopisujemy, ROZBIEZNOSCI.md); niezaksięgowane czekają,
//   3. brakujące: karta (status sprawdzony jeszcze raz na karcie) → INSERT
//      nagłówka i pozycji w jednej transakcji,
//   4. state/zakup_<dzień>.json: complete=true, gdy lista pełna i każda
//      zaksięgowana FZ/FZ_KSEF z dnia jest w bazie; liczba czekających
//      (runs[].oczekujace) mówi orkiestratorowi, który dzień przejrzeć
//      jeszcze raz w oknie 8 tygodni. run-log.jsonl + pushLogs na koniec.
//   Rytm (Michał 2026-10-13): dzień pobieramy 2 dni po wpływie, skanujemy
//   8 tygodni wstecz — ustawia orkiestrator (ZAKUP_MIN_AGE_DAYS, przegląd).
//   SCRAPE_TARGET=prod → prawdziwe tabele, inaczej *_test.
//   ZAKUP_PROBKA=N — próbka: najwyżej N nowych dokumentów, dzień niekompletny.
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
// Próbka do weryfikacji: najwyżej N nowych dokumentów (własna nazwa — MAX_DOCS
// ustawiają scrapery WZ/MM/PZ i mógłby przyjść z wspólnego .env).
const MAX_DOCS = parseInt(process.env.ZAKUP_PROBKA || '0', 10);
// Bierzemy tylko zaksięgowane (Michał 2026-10-09). Na liście status jest tekstem,
// na karcie — id; karta rozstrzyga.
const STATUS_ZAKSIEGOWANE = '213217724';
const zaksiegowana = w => /^ZAKSI[ĘE]GOWANE$/i.test(w.status.trim());

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
  const log = { tryb: process.env.PRZEGLAD === '1' ? 'przeglad' : 'dzien', dzien: DZIEN, cel, erpRekordow: null, fz: 0, fzKsef: 0, juzWBazie: 0, oczekujace: [], wstawiono: 0, pozycji: 0, bezKarty: [], bledyZapisu: [], complete: false };

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
    // Niezaksięgowane czekają: dzień przechodzi jeszcze raz w przeglądzie
    // 8 tygodni (orkiestrator), aż je zaksięgują.
    log.statusy = dnia.reduce((m, w) => { m[w.status || '(brak)'] = (m[w.status || '(brak)'] || 0) + 1; return m; }, {});
    console.log('[zakup] Statusy FZ/FZ_KSEF: ' + JSON.stringify(log.statusy));
    log.oczekujace = dnia.filter(w => !obecne.has(w.csDocsHeadersId) && !zaksiegowana(w)).map(w => w.csDocsHeadersId);
    let brakujace = dnia.filter(w => !obecne.has(w.csDocsHeadersId) && zaksiegowana(w));
    // Próbka: po jednej z każdego typu na początek, reszta do limitu.
    if (MAX_DOCS > 0) {
      const pierwsze = Object.values(W.TYPY).map(t => brakujace.find(w => w.csDocsTypesId === t)).filter(Boolean);
      brakujace = Array.from(new Set(pierwsze.concat(brakujace))).slice(0, MAX_DOCS);
    }
    console.log('[zakup] FZ ' + log.fz + ', FZ_KSEF ' + log.fzKsef + '; już w bazie ' + obecne.size + ', niezaksięgowane ' + log.oczekujace.length + ', do pobrania ' + brakujace.length + (MAX_DOCS ? ' (próbka ZAKUP_PROBKA=' + MAX_DOCS + ')' : ''));

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
      if (String(k.naglowek.csDocsHeadersStatusId) !== STATUS_ZAKSIEGOWANE) {
        // Lista mówiła „zaksięgowane”, karta już nie (odksięgowana w międzyczasie).
        log.oczekujace.push(w.csDocsHeadersId);
        console.warn(tag + ': karta ma status ' + k.naglowek.csDocsHeadersStatusDesc + ' — czeka');
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

    // Kompletny = lista pełna, bez limitu próbki i każda FZ/FZ_KSEF z dnia jest
    // w bazie albo czeka na zaksięgowanie (sprawdzone
    // w bazie, nie z pamięci przebiegu).
    const poZapisie = await z.obecneId(dnia.map(w => w.csDocsHeadersId));
    const czeka = new Set(log.oczekujace);
    log.complete = lista.pelne && !przerwanoLimitem && !MAX_DOCS &&
      dnia.every(w => poZapisie.has(w.csDocsHeadersId) || czeka.has(w.csDocsHeadersId));
    saveState(DZIEN, DZIEN, {
      newDocNumbers: Array.from(poZapisie), complete: log.complete,
      runSummary: { ts: new Date().toISOString(), erp: lista.erp, fz: log.fz, fzKsef: log.fzKsef, oczekujace: log.oczekujace.length, wstawiono: log.wstawiono, complete: log.complete }
    });
    console.log('[zakup] ' + DZIEN + ': wstawiono ' + log.wstawiono + ' dok. (' + log.pozycji + ' poz.), w bazie ' +
      poZapisie.size + '/' + dnia.length + ', czeka na zaksięgowanie ' + log.oczekujace.length + ', complete=' + log.complete);
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
