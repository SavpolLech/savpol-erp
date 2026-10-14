// Archiwum szablonów maili sklepu esavpol z ERP (Portale B2B → esavpol.pl → Mailing) → pliki HTML w repo esavpol.
// ERP nie trzyma historii szablonów — uruchom przed każdą zmianą szablonu w ERP, potem commit w repo esavpol
// (git pokaże, co się zmieniło, i pozwoli wrócić do poprzedniej treści).
//
// Zapisuje: <slug opisu>.html (treść z zakładki PODGLĄD, ze zmiennymi {:Nazwa}), _spis.json (typ operacji, opis,
// szablon tytułu, reguły z zakładki WYSYŁANIE), _zmienne.md (wszystkie zmienne użyte w szablonach).
// Treść = HTML podglądu (innerHTML), nie surowe źródło z „ZMIEŃ ŹRÓDŁO HTML” — przeglądarka może drobno zmienić zapis
// (cudzysłowy, encje), treść i zmienne są te same. Do przywrócenia: wkleić w „ZMIEŃ ŹRÓDŁO HTML”.
//
// Uruchomienie: node maile/archiwizuj.js [--do=<katalog>]   (domyślnie Documents/claude_code/esavpol/erp/maile)
// Skrypt tylko czyta (klika wiersze i zakładki, nie otwiera edycji).

const path = require('path');
const fs = require('fs');
const W = require(path.join(__dirname, '..', 'kontrahenci', 'lib', 'wspolne'));
const { chromium } = W.req('playwright');

const URL = W.ERP_BASE_URL.replace(/\/$/, '') + '/pl/portale-b2b/csb2bportals/' + W.COMPANY_ID;
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const OUT = arg('do', path.join(process.env.USERPROFILE, 'Documents', 'claude_code', 'esavpol', 'erp', 'maile'));

const slug = s => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  W.zajmijErp();
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  try {
    await W.login(page);
    // Bezpośredni adres okna ERP przerzuca na pulpit — wejście przez menu B2B → Konfiguracja → Portale B2B.
    // Menu = Kendo PanelBar: li[role=menuitem] > .k-link (tekst pozycji) + ul z podpozycjami.
    await page.waitForSelector('li[role=menuitem] > .k-link', { timeout: 30000 });
    await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const link = (root, txt) => [...root.querySelectorAll('li[role=menuitem]')]
        .find(li => li.firstElementChild && li.firstElementChild.textContent.trim() === txt);
      const b2b = link(document, 'B2B'); b2b.firstElementChild.click(); await sleep(800);
      const konf = link(b2b, 'Konfiguracja'); konf.firstElementChild.click(); await sleep(800);
      link(konf, 'Portale B2B').firstElementChild.click();
    });
    await page.waitForFunction(() => location.href.includes('/portale-b2b/'), null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.getByText('esavpol.pl', { exact: true }).first().click({ timeout: 30000 });
    await page.waitForTimeout(1500);
    // Zakładki portalu: li.csTabListItemHeaderContainer (w DOM są też ukryte kopie z innych okien).
    await page.evaluate(() => [...document.querySelectorAll('li.csTabListItemHeaderContainer')]
      .find(li => li.offsetParent && li.textContent.trim().toLowerCase() === 'mailing').click());
    // Po wejściu karta esavpol.pl bywa podświetlona, ale lista maili pusta — wymuszamy zmianę zaznaczenia
    // (inny portal → esavpol.pl) już przy otwartej zakładce Mailing.
    const karta = async txt => { const b = await page.getByText(txt, { exact: true }).first().boundingBox(); await page.mouse.click(b.x + 5, b.y + 5); };
    await page.waitForTimeout(1500);
    await karta('b2c-savpol.certusoft.pl'); await page.waitForTimeout(2500);
    await karta('esavpol.pl');
    await page.waitForFunction(() => document.body.innerText.includes('Reset hasła'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // Pętla w przeglądarce: każdy wiersz listy szablonów → PODGLĄD (największy widoczny .csDBHtmlContentPresenter)
    // i WYSYŁANIE (wiersze reguł). Lista przewija się wirtualnie — stąd przewijanie i zbiór „seen”.
    const wynik = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const lista = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 20 &&
        getComputedStyle(e).overflowY !== 'visible' && e.querySelector('td') && e.innerText.includes('Reset hasła')).pop();
      const podglad = () => {
        const ps = [...document.querySelectorAll('.csDBHtmlContentPresenter')].filter(p => p.offsetParent);
        return ps.length ? ps.sort((a, b) => b.innerHTML.length - a.innerHTML.length)[0].innerHTML : null;
      };
      const zakladka = nazwa => [...document.querySelectorAll('*')].find(e => e.children.length === 0 &&
        e.textContent.trim().toUpperCase() === nazwa && e.offsetParent);
      const reguly = () => [...document.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim()))
        .filter(c => c.some(x => /^Zamówienie od odbiorcy|^Faktura sprzedaży|^Dokument/.test(x)));
      const out = [], seen = new Set();
      for (let y = 0; y <= lista.scrollHeight; y += 120) {
        lista.scrollTop = y; await sleep(300);
        for (const tr of [...lista.querySelectorAll('tr')]) {
          const tds = [...tr.querySelectorAll('td')], cells = tds.map(t => t.innerText.trim()).filter(Boolean);
          const key = cells.slice(0, 2).join(' / ');
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const t1 = zakladka('PODGLĄD'); if (t1) { t1.click(); await sleep(400); }
          const przed = podglad();
          (tds[2] || tr).click();
          let html = przed;
          for (let k = 0; k < 24; k++) { await sleep(250); html = podglad(); if (html && html !== przed) break; }
          const t2 = zakladka('WYSYŁANIE'); let wys = [];
          if (t2) { t2.click(); await sleep(1500); wys = reguly(); }
          out.push({ typ: cells[0], opis: cells[1], tytul: cells[2] || '', html, wysylanie: wys });
        }
      }
      return out;
    });

    const zmienne = {}, spis = [];
    for (const s of wynik) {
      const plik = slug(s.opis || s.typ) + '.html';
      const naglowek = '<!-- ERP → Portale B2B → esavpol.pl → Mailing (archiwum, maile/archiwizuj.js)\n' +
        '  Typ operacji: ' + s.typ + '\n  Opis: ' + s.opis + '\n  Szablon tytułu: ' + s.tytul + '\n' +
        '  Pobrano: ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' -->\n';
      fs.writeFileSync(path.join(OUT, plik), naglowek + (s.html || '') + '\n');
      for (const m of ((s.html || '') + s.tytul).match(/\{:[A-Za-z0-9_]+\}/g) || []) (zmienne[m] = zmienne[m] || new Set()).add(plik);
      spis.push({ plik, typ: s.typ, opis: s.opis, tytul: s.tytul, wysylanie: s.wysylanie });
      console.log('[maile] ' + plik + ' (' + (s.html || '').length + ' zn., reguł ' + s.wysylanie.length + ')');
    }
    fs.writeFileSync(path.join(OUT, '_spis.json'), JSON.stringify(spis, null, 1) + '\n');
    const md = ['# Zmienne w szablonach maili esavpol (ERP)', '',
      'Spis zebrany z treści szablonów przez `savpol-erp/automatyzacje/maile/archiwizuj.js` — to zmienne, które na pewno działają',
      '(ERP nie pokazuje pełnej listy). Każda zmienna działa w szablonie powiązanym z dokumentem tego samego rodzaju.', '',
      '| zmienna | w szablonach |', '|---|---|',
      ...Object.keys(zmienne).sort().map(k => '| `' + k + '` | ' + [...zmienne[k]].map(f => f.replace('.html', '')).join(', ') + ' |')];
    fs.writeFileSync(path.join(OUT, '_zmienne.md'), md.join('\n') + '\n');
    console.log('[maile] Zapisano ' + wynik.length + ' szablonów do ' + OUT);
  } catch (e) {
    if (process.env.ZRZUT) await page.screenshot({ path: process.env.ZRZUT }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
