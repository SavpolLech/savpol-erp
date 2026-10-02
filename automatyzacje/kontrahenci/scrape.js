// Playwright: loguje się do ERP i dla każdego csCustomersId otwiera kartę
// kontrahenta WPROST z URL, podsłuchując odpowiedź API karty
// (DictIdent: csCustomersOneBroFull, RefreshDataSetSQL_Synchronous).
//
// Jak produkty/scrape.js: dane karty nie są w komórkach siatki, tylko wracają
// jednym zapytaniem spakowanym jako base64(ZIP+deflate) — dekodujemy je
// produkty/lib/decode.js. Karta zwraca 468 pól, w tym wszystkie 168 kolumn
// csCustomers (sprawdzone 2026-10-02, patrz mapowanie-pol.md), więc nie
// trzeba nic włączać w widokach ERP. Do wynik/ zapisujemy CAŁY rekord —
// adres, warunki handlowe i rachunek z karty przydadzą się przy kolejnych
// tabelach (csCustomersAddresses, csTradeConditions, csBankAccounts).
//
// Uruchomienie:
//   node scrape.js 417109229 30445738062 ...   (konkretne id)
//   node scrape.js --plik=lista-id.txt         (id rozdzielone białymi znakami/przecinkami)
//   node scrape.js --brakujace                 (kontrahenci z dokumentów w worek,
//                                               których nie ma w csCustomers)
// Id, które mają już plik w wynik/, są pomijane (--odswiez wymusza ponowne pobranie).

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { chromium } = W.req('playwright');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));

const HEADLESS = process.env.HEADLESS !== 'false'; // domyślnie bez okna, jak automaty
const ERP_BASE_URL = W.ERP_BASE_URL;
const ODSWIEZ = process.argv.includes('--odswiez');
// Przerwa między kartami — losowa, żeby ruch nie wyglądał jak maszyna.
const PRZERWA_MS = [1200, 3000];

const cardUrl = id => ERP_BASE_URL.replace(/\/$/, '') +
  '/pl/kontrahent/cscustomersonebrofull-' + W.COMPANY_ID + ',' + id + ',' + id + ',x/' + W.COMPANY_ID;
const plikWyniku = id => path.join(W.OUT_DIR, 'kontrahent_' + id + '.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listaIdZArgumentow() {
  const args = process.argv.slice(2);
  let ids = args.filter(a => /^\d+$/.test(a));
  const plik = args.find(a => a.startsWith('--plik='));
  if (plik) ids = ids.concat(fs.readFileSync(plik.slice(7), 'utf8').split(/[\s,;]+/).filter(s => /^\d+$/.test(s)));
  if (args.includes('--brakujace')) {
    const pool = await W.polacz();
    try {
      const rs = await pool.request().query(`
        SELECT DISTINCT CAST(h.csCustomersId AS varchar(30)) AS id
        FROM dbo.csDocsHeaders h
        LEFT JOIN dbo.csCustomers c ON c.csCustomersId = h.csCustomersId
        WHERE h.csCustomersId IS NOT NULL AND c.csCustomersId IS NULL`);
      ids = ids.concat(rs.recordset.map(r => r.id));
      console.log('[lista] Kontrahenci z dokumentów, których brak w csCustomers: ' + rs.recordset.length);
    } finally { await pool.close(); }
  }
  return Array.from(new Set(ids));
}

async function main() {
  W.zajmijErp();
  const ids = await listaIdZArgumentow();
  if (!ids.length) throw new Error('Podaj id kontrahentów, --plik=... albo --brakujace.');
  fs.mkdirSync(W.OUT_DIR, { recursive: true });
  const doPobrania = ODSWIEZ ? ids : ids.filter(id => !fs.existsSync(plikWyniku(id)));
  console.log('[start] Id: ' + ids.length + ', do pobrania: ' + doPobrania.length +
    (ids.length - doPobrania.length ? ' (reszta już jest w wynik/)' : ''));
  if (!doPobrania.length) return;

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  // Karta wysyła kilka zapytań csCustomersOneBroFull (definicja formularza,
  // lista rozwijana grup...). Rekord kontrahenta to DataTable z setkami pól
  // i naszym csCustomersId — tylko to bierzemy.
  const zlapane = new Map();
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    if (!/csCustomersOneBroFull/.test(r.request().postData() || '')) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    const lista = (decodeJsonResult(body) || {}).Result;
    const ret = lista && lista.RefreshObjectReturnList;
    if (!ret) return;
    for (let i = 0; i < ret.length; i++) {
      const karta = extractCardRecord({ Result: { RefreshObjectReturnList: [ret[i]] } });
      if (!karta || karta.fieldNames.length < 300 || !karta.records[0]) continue;
      const rek = karta.records[0];
      zlapane.set(String(rek.csCustomersId), rek);
    }
  });

  let ok = 0;
  const bledy = [];
  try {
    await W.login(page);
    for (const [n, id] of doPobrania.entries()) {
      zlapane.delete(id);
      let rek = null;
      for (let proba = 1; proba <= 2 && !rek; proba++) {
        await page.goto(cardUrl(id), { waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 80 && !zlapane.has(id); i++) await sleep(250);
        rek = zlapane.get(id) || null;
      }
      if (!rek) {
        bledy.push(id);
        console.warn('[' + (n + 1) + '/' + doPobrania.length + '] ' + id + ': BRAK karty (zły id albo brak uprawnień?)');
        continue;
      }
      fs.writeFileSync(plikWyniku(id), JSON.stringify({
        csCustomersId: id, pobrano: new Date().toISOString(), zrodlo: 'csCustomersOneBroFull', rekord: rek
      }, null, 1), 'utf8');
      ok++;
      console.log('[' + (n + 1) + '/' + doPobrania.length + '] ' + id + ': ' + rek.CustomerDesc);
      await sleep(PRZERWA_MS[0] + Math.random() * (PRZERWA_MS[1] - PRZERWA_MS[0]));
    }
  } finally {
    await browser.close();
  }
  console.log('[koniec] Pobrano ' + ok + '/' + doPobrania.length + ' kart.' + (bledy.length ? ' Bez karty: ' + bledy.join(', ') : ''));
  if (bledy.length) process.exitCode = 2;
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
