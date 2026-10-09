// Sonda okna „Dokumenty zakupu” (jednorazowa diagnostyka przed budową scrapera FZ).
// Loguje się jak sprzedaz/, szuka listy w menu, ustawia pierwszy zakres dat
// (Wpływ) na jeden dzień, zbiera wiersze z API listy, otwiera pierwszą FZ
// i zapisuje, co oddaje karta. Wynik: zakup/wynik/sonda-<data>.txt.
//
//   node zakup/sonda.js [RRRR-MM-DD]      (domyślnie 2026-07-01)

const path = require('path');
const fs = require('fs');
const W = require('../sprzedaz/lib/wspolne');
const { chromium } = W.req('playwright');
const { decodeJsonResult, extractCardRecord } = require('../produkty/lib/decode');

const DZIEN = process.argv[2] || '2026-07-01';
const OUT = path.join(__dirname, 'wynik', 'sonda-' + DZIEN + '.txt');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const linie = [];
const log = s => { console.log(s); linie.push(s); };

// Bezpiecznik: sonda nie może zająć ERP na dłużej.
setTimeout(() => { log('[sonda] limit 10 min — koniec'); zapisz(); process.exit(4); }, 10 * 60000);
function zapisz() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, linie.join('\n'), 'utf8');
}

(async () => {
  W.zajmijErp();
  log('Sonda Dokumenty zakupu, dzień ' + DZIEN + ', ' + new Date().toISOString());
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const tabele = []; // { dict, ident, pola, wiersze, url }
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    const dict = (/"DictIdent"\s*:\s*"([^"]+)"/.exec(r.request().postData() || '') || [])[1] || '-';
    let body; try { body = await r.text(); } catch (e) { return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList || [];
    for (const x of ret) {
      const t = extractCardRecord({ Result: { RefreshObjectReturnList: [x] } });
      if (t) tabele.push({ dict, ident: String(t.dataSetIdent || ''), pola: t.fieldNames, wiersze: t.records, url: page.url() });
    }
  });
  try {
    await W.login(page);
    const linki = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map(a => (a.textContent || '').trim().replace(/\s+/g, ' ') + ' -> ' + a.getAttribute('href'))
      .filter(s => /zakup|purch/i.test(s)));
    log('Linki z „zakup”: ' + (linki.length ? '\n  ' + linki.join('\n  ') : 'brak'));
    const cel = linki.find(s => /Dokumenty zakupu/i.test(s));
    if (cel) {
      const href = cel.split(' -> ')[1];
      await page.goto(new URL(href, W.ERP_BASE_URL).href, { waitUntil: 'domcontentloaded' });
    } else {
      // Pozycja menu (div.ShortMenuSubItemLink) jest ukryta do rozwinięcia — klik z JS.
      const ok = await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('.ShortMenuSubItemLink')).find(e => e.textContent.trim() === 'Dokumenty zakupu');
        if (!el) return false;
        el.click();
        return true;
      });
      if (!ok) throw new Error('Brak pozycji menu „Dokumenty zakupu”');
    }
    await sleep(8000);
    log('URL listy: ' + page.url());
    const startListy = tabele.length;

    // Pierwsza para Od/Do = Wpływ (zrzut Michała); wpisujemy klawiaturą jak sprzedaz/.
    for (const ph of ['Od', 'Do']) {
      const loc = page.locator('input[placeholder="' + ph + '"]:visible').first();
      await loc.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type(DZIEN, { delay: 60 });
      await page.keyboard.press('Tab');
      await sleep(500);
      log('Pole ' + ph + ' = ' + await loc.inputValue());
    }
    await page.locator('.ButtonRefresh:visible').first().click();
    await sleep(8000);
    const pager = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('.csDataPager')).find(e => e.offsetParent);
      return p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    log('Pager: ' + pager);
    const etykiety = await page.evaluate(() => Array.from(document.querySelectorAll('input[placeholder="Od"]'))
      .map(i => { let e = i; for (let k = 0; k < 6 && e; k++) { e = e.parentElement; if (e && /\S/.test(e.textContent) && e.textContent.length < 200) return e.textContent.replace(/\s+/g, ' ').trim(); } return '?'; }));
    log('Zakresy dat (otoczenie pól Od): ' + JSON.stringify(etykiety));

    // Wiersze listy po odświeżeniu.
    const lista = tabele.slice(startListy).filter(t => t.pola.includes('csDocsTypesId') && t.wiersze.length > 1);
    const ost = lista[lista.length - 1];
    let pierwszaFz = null;
    if (ost) {
      log('\nLISTA: DictIdent=' + ost.dict + ' ident=' + ost.ident + ' pól=' + ost.pola.length + ' wierszy na stronie=' + ost.wiersze.length);
      log('pola listy: ' + ost.pola.join(', '));
      const daty = ost.pola.filter(p => /Date/.test(p));
      for (const w of ost.wiersze) {
        log('  ' + w.csDocsHeadersId + ' typ=' + w.csDocsTypesId + ' ' + w.DocNumber + ' ' + daty.map(d => d + '=' + String(w[d] || '').slice(0, 10)).join(' '));
        if (!pierwszaFz && /\/FZ(_KSEF)?\//.test(w.DocNumber || '')) pierwszaFz = w;
      }
    } else {
      log('\nLISTA: nie złapano wierszy. Złapane tabele: ' + tabele.map(t => t.dict + '/' + t.ident + '(' + t.wiersze.length + ')').join(', '));
    }

    // Karta: podwójne kliknięcie wiersza z numerem pierwszej FZ.
    if (pierwszaFz) {
      log('\nOtwieram kartę ' + pierwszaFz.DocNumber + ' (' + pierwszaFz.csDocsHeadersId + ')');
      const startKarty = tabele.length;
      const nowe = [];
      page.context().on('page', p => nowe.push(p));
      await page.getByText(pierwszaFz.DocNumber, { exact: true }).first().dblclick();
      await sleep(10000);
      log('URL po otwarciu: ' + page.url() + (nowe.length ? ' | nowe karty: ' + nowe.map(p => p.url()).join(', ') : ''));
      for (const t of tabele.slice(startKarty)) {
        log('  tabela DictIdent=' + t.dict + ' ident=' + t.ident + ' pól=' + t.pola.length + ' wierszy=' + t.wiersze.length);
      }
      const nag = tabele.slice(startKarty).find(t => t.ident.toLowerCase() === 'csdocsheaders');
      const poz = tabele.slice(startKarty).find(t => t.ident.toLowerCase() === 'csdocsitemspositions');
      if (nag) log('NAGŁÓWEK pola: ' + nag.pola.join(', '));
      if (poz) log('POZYCJE pola: ' + poz.pola.join(', '));
      // Druga karta z URL (podmiana id) — FZ z próbki Michała.
      const url1 = page.url(), id1 = pierwszaFz.csDocsHeadersId, id2 = process.env.ID2 || '29471619558';
      if (url1.includes(id1)) {
        const url2 = url1.split(id1).join(id2);
        const start2 = tabele.length;
        await page.goto(url2, { waitUntil: 'domcontentloaded' });
        await sleep(10000);
        log('\nKarta z URL ' + url2);
        for (const t of tabele.slice(start2)) log('  tabela DictIdent=' + t.dict + ' ident=' + t.ident + ' pól=' + t.pola.length + ' wierszy=' + t.wiersze.length + (t.wiersze[0] ? ' id=' + t.wiersze[0].csDocsHeadersId + ' ' + (t.wiersze[0].DocNumber || '') : ''));
        const n2 = tabele.slice(start2).find(t => t.ident.toLowerCase() === 'csdocsheaders');
        const p2 = tabele.slice(start2).find(t => t.ident.toLowerCase() === 'csdocsitemspositions');
        if (n2 && p2) fs.writeFileSync(path.join(__dirname, 'wynik', 'karta-' + id2 + '.json'), JSON.stringify({ naglowek: n2.wiersze[0], pozycje: p2.wiersze }, null, 1));
      }
      if (nag && poz) fs.writeFileSync(path.join(__dirname, 'wynik', 'karta-' + id1 + '.json'), JSON.stringify({ naglowek: nag.wiersze[0], pozycje: poz.wiersze }, null, 1));
    }
  } catch (e) {
    log('[BŁĄD] ' + e.message);
    process.exitCode = 1;
  } finally {
    zapisz();
    await browser.close();
    console.log('[sonda] zapisano ' + OUT);
    process.exit();
  }
})();
