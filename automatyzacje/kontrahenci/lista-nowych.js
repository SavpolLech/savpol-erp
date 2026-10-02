// Lista kontrahentów założonych w ERP po ostatnim symbolu w worku
// (CustomerIdent > próg) → wynik/lista-nowych.json + wynik/lista-nowych-id.txt
// (wejście dla scrape.js --plik=...).
//
// Lista kontrahentów w ERP nie ma kolumny symbolu ani sortowania po nim, ale
// odpowiedź API wyszukiwarki (DictIdent csCustomers) niesie całą stronę
// wierszy (21) z csCustomersId i CustomerIdent. Wyszukiwarka dopasowuje
// fragment w wielu polach (telefon, NIP...), więc szukamy prefiksami
// 6-cyfrowymi ("006297" = symbole 0062970–0062979): mało przypadkowych
// trafień, a ~10× mniej zapytań niż symbol po symbolu. Z odpowiedzi bierzemy
// tylko wiersze z 7-cyfrowym symbolem > próg. Filtr "Wszyscy" (domyślnie ERP
// pokazuje tylko aktywnych).
//
// KONTROLA KOMPLETNOŚCI (zapisywana w lista-nowych.json → kontrola.js):
//  1a. każde wyszukiwanie: wierszy zebranych ze wszystkich stron = licznik
//      "N rekordów" w pagerze ERP (inaczej strona przepadła po drodze),
//  1b. każda luka w numeracji sprawdzona osobnym wyszukiwaniem pełnego
//      symbolu — znaleziony trafia na listę, nieznaleziony = potwierdzony brak,
//  1c. liczba wszystkich kontrahentów w ERP (filtr "Wszyscy") — do bilansu
//      z workiem w kontrola.js.
//
// Uruchomienie: node lista-nowych.js [--prog=0062971]
// Domyślny próg = najwyższy symbol 00xxxxx w worek.csCustomers (Michał
// 2026-10-02: 0062971). Koniec po 3 kolejnych pustych prefiksach.

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { chromium } = W.req('playwright');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));

const LIST_URL = W.ERP_BASE_URL.replace(/\/$/, '') + '/pl/kontrahenci/cscustomers';
const PUSTE_DO_KONCA = 3;
const MAX_STRON = 200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function progZBazy() {
  const arg = process.argv.find(a => a.startsWith('--prog='));
  if (arg) return arg.slice(7);
  const pool = await W.polacz();
  try {
    // 1234567 / 1245553 to pojedyncze stare wpisy spoza numeracji — stąd 00%.
    const rs = await pool.request().query(
      "SELECT MAX(CustomerIdent) AS m FROM dbo.csCustomers WHERE CustomerIdent LIKE '00[0-9][0-9][0-9][0-9][0-9]'");
    return rs.recordset[0].m;
  } finally { await pool.close(); }
}

async function main() {
  W.zajmijErp();
  const prog = await progZBazy();
  if (!/^\d{7}$/.test(prog || '')) throw new Error('Zły próg: ' + prog);
  console.log('[lista] Próg: CustomerIdent > ' + prog);

  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  let odpowiedzi = 0;
  let ostatnia = [];
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    if (!/"DictIdent"\s*:\s*"csCustomers"/.test(r.request().postData() || '')) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList || [];
    for (const x of ret) {
      // Strona siatki = DataTable z CustomerIdent (nie RecordProps zaznaczonego wiersza, nie __COUNT__).
      const k = extractCardRecord({ Result: { RefreshObjectReturnList: [x] } });
      if (k && k.fieldNames.includes('CustomerIdent')) { ostatnia = k.records; odpowiedzi++; }
    }
  });
  const czekajNaStrone = async (przed, ms = 15000) => {
    for (let t = 0; t < ms && odpowiedzi === przed; t += 200) await sleep(200);
    return odpowiedzi !== przed;
  };
  const pager = () => page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(e => e.offsetParent);
    if (!p) return null;
    const m = /([\d\s ]+)\s*rekord\S*\s*z\s*([\d\s ]+)/.exec(p.textContent.replace(/\s+/g, ' '));
    const next = p.querySelector('.NextPageButton');
    return { rekordow: m ? parseInt(m[1].replace(/\D/g, ''), 10) : null, stron: m ? parseInt(m[2].replace(/\D/g, ''), 10) : null,
      // Przy jednej stronie wyników ERP ukrywa przycisk (csDisplayNone) zamiast
      // dawać mu "inactive" — liczy się więc też widoczność.
      dalej: !!next && next.offsetParent !== null && !/\b(inactive|csDisplayNone)\b/.test(next.className) };
  });

  // Wyszukuje tekst, przechodzi wszystkie strony wyników i zwraca wszystkie
  // wiersze + licznik ERP (kontrola 1a). Licznik z pagera czytamy po
  // ostatniej stronie, kiedy siatka już się ustaliła.
  async function szukaj(tekst) {
    const pole = page.locator('input[placeholder="Szukaj"]:visible').first();
    let przed = odpowiedzi;
    await pole.fill('');
    await pole.click();
    await pole.pressSequentially(tekst, { delay: 50 + Math.random() * 60 });
    await pole.press('Enter');
    const jest = await czekajNaStrone(przed);
    const wiersze = jest ? ostatnia.slice() : [];
    await sleep(400);
    let pg = await pager();
    for (let strona = 2; jest && pg && pg.dalej && strona <= MAX_STRON; strona++) {
      przed = odpowiedzi;
      await page.locator('.csDataPager:visible .NextPageButton').first().click();
      if (!await czekajNaStrone(przed)) { console.warn('[lista] "' + tekst + '": brak odpowiedzi strony ' + strona); break; }
      wiersze.push(...ostatnia);
      await sleep(300);
      pg = await pager();
    }
    const erp = pg ? pg.rekordow : null;
    // Brak pagera po wyszukaniu = zero wyników.
    const pelne = erp === null ? wiersze.length === 0 : wiersze.length === erp;
    return { wiersze, erp, pelne };
  }

  const znalezione = new Map();
  const dodaj = r => znalezione.set(String(r.CustomerIdent),
    { CustomerIdent: String(r.CustomerIdent), csCustomersId: String(r.csCustomersId), CustomerDesc: r.CustomerDesc });
  const wyszukiwania = [];
  const luki = [];
  let erpWszyscy = null;
  let skanNiecyfrowych = null;
  let niecyfrowe = [];
  try {
    await W.login(page);
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="CustomerDesc"]', { timeout: 40000 });
    // Radio: Wszyscy / Aktywni / Nieaktywni — pierwsze = Wszyscy.
    const przed = odpowiedzi;
    await page.locator('input.csDBRadioGroupItemInput:visible').first().check({ force: true });
    await czekajNaStrone(przed);
    await sleep(800);
    erpWszyscy = ((await pager()) || {}).rekordow || null;
    console.log('[lista] Filtr "Wszyscy": ' + erpWszyscy + ' kontrahentów w ERP.');

    let prefiks = Math.floor((parseInt(prog, 10) + 1) / 10);
    let puste = 0;
    while (puste < PUSTE_DO_KONCA) {
      const p6 = String(prefiks).padStart(6, '0');
      const w = await szukaj(p6);
      let nowych = 0;
      for (const r of w.wiersze) {
        const s = String(r.CustomerIdent || '');
        if (/^\d{7}$/.test(s) && s > prog && s.startsWith(p6)) { if (!znalezione.has(s)) nowych++; dodaj(r); }
      }
      wyszukiwania.push({ tekst: p6, erp: w.erp, zebrane: w.wiersze.length, nowych, pelne: w.pelne });
      console.log('[lista] ' + p6 + 'x: ' + nowych + ' nowych (wyników: ERP ' + w.erp + ', zebrane ' + w.wiersze.length + ')' +
        (w.pelne ? '' : '  <-- NIEPEŁNE'));
      puste = nowych ? 0 : puste + 1;
      prefiks++;
      await sleep(600 + Math.random() * 900);
    }

    // Kontrola 1b: luki w numeracji — pełny symbol wyszukany osobno.
    const nums = new Set(Array.from(znalezione.keys()).map(Number));
    const max = Math.max(...nums);
    for (let n = parseInt(prog, 10) + 1; n < max; n++) {
      if (nums.has(n)) continue;
      const s = String(n).padStart(7, '0');
      const w = await szukaj(s);
      const trafiony = w.wiersze.find(r => String(r.CustomerIdent) === s);
      if (trafiony) dodaj(trafiony);
      luki.push({ symbol: s, znaleziony: !!trafiony, erp: w.erp, pelne: w.pelne });
      console.log('[lista] luka ' + s + ': ' + (trafiony ? 'ZNALEZIONY przy dokładnym wyszukaniu — dopisany' : 'brak w ERP (potwierdzone)'));
      await sleep(600 + Math.random() * 900);
    }
    // Etap 2: kontrahenci z symbolem NIECYFROWYM (pusty, "//Piecuch", "Zenapol"
    // — w worku ~4000) nie wpadną w wyszukiwanie po cyfrach. Siatka "Wszyscy"
    // bez wyszukiwania jest sortowana po symbolu: puste (po id) i znaki
    // przestankowe na początku, cyfry w środku, litery na końcu. Przechodzimy
    // więc strony od pierwszej do pierwszego symbolu cyfrowego i od ostatniej
    // wstecz do ostatniego cyfrowego; który z tych wierszy nie jest w worku —
    // nowy. Kontrola: numery stron po kolei, bez przeskoków.
    const pole = page.locator('input[placeholder="Szukaj"]:visible').first();
    let p0 = odpowiedzi;
    await pole.fill(''); await pole.press('Enter');
    await czekajNaStrone(p0); await sleep(800);
    const nrStrony = () => page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('.csDataPager')).find(e => e.offsetParent);
      const i = p && p.querySelector('.ActivePageNoInput'); return i ? parseInt(i.value, 10) : null;
    });
    const cyfrowy = r => /^\d/.test(String(r.CustomerIdent || ''));
    const pg0 = await pager();
    if (!pg0 || pg0.rekordow !== erpWszyscy) throw new Error('Po wyczyszczeniu wyszukiwania licznik ' + (pg0 && pg0.rekordow) + ' ≠ ' + erpWszyscy);
    async function skan(kierunek) {
      const przycisk = kierunek > 0 ? '.NextPageButton' : '.PreviousPageButton';
      const zebrane = []; const strony = [];
      for (let i = 0; i < 400; i++) {
        strony.push(await nrStrony());
        zebrane.push(...ostatnia.filter(r => !cyfrowy(r)));
        if (ostatnia.some(cyfrowy)) return { zebrane, strony, ok: true };
        const p = odpowiedzi;
        await page.locator('.csDataPager:visible ' + przycisk).first().click();
        if (!await czekajNaStrone(p)) return { zebrane, strony, ok: false };
        await sleep(250);
      }
      return { zebrane, strony, ok: false };
    }
    const przod = await skan(+1);
    p0 = odpowiedzi;
    const inp = page.locator('.csDataPager:visible .ActivePageNoInput').first();
    await inp.fill(String(pg0.stron)); await inp.press('Enter');
    await czekajNaStrone(p0); await sleep(500);
    const tyl = await skan(-1);
    const poKolei = (s, d) => s.every((v, i) => i === 0 || v === s[i - 1] + d);
    skanNiecyfrowych = {
      stronOdPoczatku: przod.strony.length, stronOdKonca: tyl.strony.length,
      wierszy: przod.zebrane.length + tyl.zebrane.length,
      ok: przod.ok && tyl.ok && poKolei(przod.strony, 1) && poKolei(tyl.strony, -1) && przod.strony[0] === 1 && tyl.strony[0] === pg0.stron
    };
    niecyfrowe = przod.zebrane.concat(tyl.zebrane);
    console.log('[lista] Skan symboli niecyfrowych: ' + skanNiecyfrowych.wierszy + ' wierszy na ' +
      (skanNiecyfrowych.stronOdPoczatku + skanNiecyfrowych.stronOdKonca) + ' stronach' + (skanNiecyfrowych.ok ? '' : '  <-- NIEPEŁNY'));
  } finally {
    await browser.close();
  }

  // Które z niecyfrowych nie są jeszcze w worku → nowe.
  if (niecyfrowe.length) {
    const pool = await W.polacz();
    try {
      const jest = new Set();
      const ids = Array.from(new Set(niecyfrowe.map(r => String(r.csCustomersId))));
      for (let i = 0; i < ids.length; i += 1000) {
        const rs = await pool.request().query('SELECT CAST(csCustomersId AS varchar(30)) AS id FROM dbo.csCustomers WHERE csCustomersId IN (' + ids.slice(i, i + 1000).join(',') + ')');
        rs.recordset.forEach(r => jest.add(r.id));
      }
      const nowe = niecyfrowe.filter(r => !jest.has(String(r.csCustomersId)));
      nowe.forEach(r => znalezione.set('id:' + r.csCustomersId,
        { CustomerIdent: String(r.CustomerIdent || ''), csCustomersId: String(r.csCustomersId), CustomerDesc: r.CustomerDesc }));
      skanNiecyfrowych.nowych = nowe.length;
      console.log('[lista] Nowi z symbolem niecyfrowym: ' + nowe.length + (nowe.length ? ' — ' + nowe.map(r => r.csCustomersId + '/' + (r.CustomerIdent || '(brak)')).join(', ') : ''));
    } finally { await pool.close(); }
  }

  const lista =Array.from(znalezione.values()).sort((a, b) => a.CustomerIdent.localeCompare(b.CustomerIdent));
  const niepelne = wyszukiwania.filter(w => !w.pelne).concat(luki.filter(l => !l.pelne).map(l => ({ tekst: l.symbol })));
  const kontrola = {
    erpWszyscy,
    wyszukiwan: wyszukiwania.length,
    niepelne: niepelne.map(w => w.tekst),
    luki,
    skanNiecyfrowych,
    ok: niepelne.length === 0 && erpWszyscy !== null && !!(skanNiecyfrowych && skanNiecyfrowych.ok)
  };
  fs.mkdirSync(W.OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(W.OUT_DIR, 'lista-nowych.json'),
    JSON.stringify({ prog, pobrano: new Date().toISOString(), kontrola, wyszukiwania, kontrahenci: lista }, null, 1), 'utf8');
  fs.writeFileSync(path.join(W.OUT_DIR, 'lista-nowych-id.txt'), lista.map(k => k.csCustomersId).join('\n') + '\n', 'utf8');
  console.log('[koniec] Nowych kontrahentów: ' + lista.length + (lista.length ? ' (' + lista[0].CustomerIdent + '–' + lista[lista.length - 1].CustomerIdent + ')' : '') +
    '. Luki: ' + luki.length + ' (znalezione: ' + luki.filter(l => l.znaleziony).length + ').' +
    (kontrola.ok ? ' Kontrola stron: OK.' : ' Kontrola stron: NIEPEŁNE ' + kontrola.niepelne.join(', ')));
  if (!kontrola.ok) process.exitCode = 2;
}

main().catch(err => { console.error('[lista] BŁĄD:', err.message); process.exit(1); });
