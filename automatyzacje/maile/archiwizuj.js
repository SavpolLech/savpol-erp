// Archiwum szablonów maili sklepu esavpol z ERP (Portale B2B → esavpol.pl → Mailing) → pliki w repo esavpol.
// ERP nie trzyma historii szablonów — uruchom przed każdą zmianą szablonu w ERP i po niej, potem commit w repo esavpol
// (git pokaże, co się zmieniło, i pozwoli wrócić do poprzedniej treści).
//
// Źródło: odpowiedź serwera listy szablonów (OperatrionInvoke, base64 ZIP JSON, DataTable). Pola: Body_PL = źródło HTML
// (to, co w „ZMIEŃ ŹRÓDŁO HTML”), TransformedBody_PL = wersja przetworzona przez ERP, Subject_PL, MailTemplateDesc,
// ProfileName (nadawca), BlindCopyRecipients, IsActive. Podgląd w przeglądarce się NIE nadaje: przestawia znaczniki pętli
// pozycji ({:csDocsItemsPositionTemplateStart/Stop}) przed tabelę. Reguły z zakładki WYSYŁANIE — z widoku (klik w wiersz).
//
// Zapisuje: <slug opisu>.html (Body_PL), _przetworzone/<slug>.html (TransformedBody_PL), _spis.json (metadane + reguły),
// _zmienne.md (zmienne użyte w szablonach).
//
// Uruchomienie: node maile/archiwizuj.js [--do=<katalog>]   (domyślnie Documents/claude_code/esavpol/erp/maile)
// Skrypt tylko czyta (klika wiersze i zakładki, nie otwiera edycji). Zapytania niosą hasło ERP — nigdy na dysk.

const path = require('path');
const fs = require('fs');
const W = require(path.join(__dirname, '..', 'kontrahenci', 'lib', 'wspolne'));
const { chromium } = W.req('playwright');
const { decodeJsonResult } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const OUT = arg('do', path.join(process.env.USERPROFILE, 'Documents', 'claude_code', 'esavpol', 'erp', 'maile'));

const slug = s => s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  W.zajmijErp();
  fs.mkdirSync(path.join(OUT, '_przetworzone'), { recursive: true });
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  const szablony = new Map(); // csB2BPortalsMailsTemplatesId → wiersz z serwera
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    let t; try { t = await r.text(); } catch (e) { return; }
    const d = decodeJsonResult(t); if (!d || !d.Result) return;
    for (const ro of d.Result.RefreshObjectReturnList || []) {
      const dt = ro && ro.DataTable; if (!dt || !dt.FieldDefs || !dt.Rows) continue;
      const pola = dt.FieldDefs.map(f => f.FieldName);
      if (!pola.includes('Body_PL') || !pola.includes('csB2BPortalsMailsTemplatesId')) continue;
      for (const w of dt.Rows) {
        const o = {}; w.forEach((v, i) => { o[pola[i]] = v && typeof v === 'object' && 'Item' in v ? v.Item : v; });
        szablony.set(String(o.csB2BPortalsMailsTemplatesId), o);
      }
    }
  });

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
    const mailing = () => [...document.querySelectorAll('li.csTabListItemHeaderContainer')]
      .find(li => li.offsetParent && li.textContent.trim().toLowerCase() === 'mailing');
    await page.waitForFunction(`(${mailing})()`, null, { timeout: 30000 });
    await page.evaluate(`(${mailing})().click()`);
    // Po wejściu karta esavpol.pl bywa podświetlona, ale lista maili pusta — wymuszamy zmianę zaznaczenia
    // (inny portal → esavpol.pl) już przy otwartej zakładce Mailing.
    const karta = async txt => { const b = await page.getByText(txt, { exact: true }).first().boundingBox(); await page.mouse.click(b.x + 5, b.y + 5); };
    await page.waitForTimeout(1500);
    await karta('b2c-savpol.certusoft.pl'); await page.waitForTimeout(2500);
    szablony.clear(); // dane innego portalu
    await karta('esavpol.pl');
    await page.waitForFunction(() => document.body.innerText.includes('Reset hasła'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // Reguły WYSYŁANIE: klik w każdy wiersz listy (przewija się wirtualnie — stąd przewijanie i zbiór „seen”).
    const reguly = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const lista = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 20 &&
        getComputedStyle(e).overflowY !== 'visible' && e.querySelector('td') && e.innerText.includes('Reset hasła')).pop();
      const zakladka = nazwa => [...document.querySelectorAll('*')].find(e => e.children.length === 0 &&
        e.textContent.trim().toUpperCase() === nazwa && e.offsetParent);
      const wiersze = () => [...document.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim()))
        .filter(c => c.some(x => /^Zamówienie od odbiorcy|^Faktura sprzedaży|^Dokument/.test(x)));
      const out = {}, seen = new Set();
      const t2 = zakladka('WYSYŁANIE'); if (t2) { t2.click(); await sleep(800); }
      for (let y = 0; y <= lista.scrollHeight; y += 120) {
        lista.scrollTop = y; await sleep(300);
        for (const tr of [...lista.querySelectorAll('tr')]) {
          const tds = [...tr.querySelectorAll('td')], cells = tds.map(t => t.innerText.trim()).filter(Boolean);
          if (cells.length < 2 || seen.has(cells[1])) continue;
          seen.add(cells[1]);
          (tds[2] || tr).click(); await sleep(1800);
          out[cells[1]] = wiersze();
        }
      }
      return out;
    });

    const zmienne = {}, spis = [];
    for (const o of szablony.values()) {
      const opis = o.MailTemplateDesc || o.MailTemplateTypeTranslated || String(o.csB2BPortalsMailsTemplatesId);
      const plik = slug(opis) + '.html';
      const naglowek = '<!-- ERP → Portale B2B → esavpol.pl → Mailing (archiwum, savpol-erp/automatyzacje/maile/archiwizuj.js)\n' +
        '  Typ operacji: ' + o.MailTemplateType_PL + '\n  Opis: ' + opis + '\n  Temat: ' + (o.Subject_PL || '') + '\n' +
        '  Nadawca: ' + (o.ProfileName || '') + (o.BlindCopyRecipients ? ' · UDW: ' + o.BlindCopyRecipients : '') +
        (o.IsActive === 0 ? ' · NIEAKTYWNY' : '') + '\n  Źródło = pole Body_PL („ZMIEŃ ŹRÓDŁO HTML”). Data pobrania: historia git. -->\n';
      fs.writeFileSync(path.join(OUT, plik), naglowek + (o.Body_PL || '') + '\n');
      if (o.TransformedBody_PL) fs.writeFileSync(path.join(OUT, '_przetworzone', plik), o.TransformedBody_PL + '\n');
      for (const m of ((o.Body_PL || '') + (o.Subject_PL || '')).match(/\{:[A-Za-z0-9_]+\}/g) || []) (zmienne[m] = zmienne[m] || new Set()).add(plik);
      spis.push({ plik, id: String(o.csB2BPortalsMailsTemplatesId), typ: o.MailTemplateType_PL, opis, temat: o.Subject_PL,
        nadawca: o.ProfileName, udw: o.BlindCopyRecipients, aktywny: o.IsActive !== 0, wysylanie: reguly[opis] || [] });
      console.log('[maile] ' + plik + ' (źródło ' + (o.Body_PL || '').length + ' zn., reguł ' + (reguly[opis] || []).length + ')');
    }
    if (!spis.length) throw new Error('Brak szablonów w odpowiedziach serwera — zmienił się format ERP?');
    spis.sort((a, b) => a.plik.localeCompare(b.plik));
    fs.writeFileSync(path.join(OUT, '_spis.json'), JSON.stringify(spis, null, 1) + '\n');
    const md = ['# Zmienne w szablonach maili esavpol (ERP)', '',
      'Spis zebrany ze źródeł szablonów przez `savpol-erp/automatyzacje/maile/archiwizuj.js` — zmienne, które na pewno działają',
      '(ERP nie pokazuje pełnej listy). Zmienna działa w szablonie o tym samym typie operacji (dokument zamówienia, faktury, konta).', '',
      '| zmienna | w szablonach |', '|---|---|',
      ...Object.keys(zmienne).sort().map(k => '| `' + k + '` | ' + [...zmienne[k]].map(f => f.replace('.html', '')).join(', ') + ' |')];
    fs.writeFileSync(path.join(OUT, '_zmienne.md'), md.join('\n') + '\n');
    console.log('[maile] Zapisano ' + spis.length + ' szablonów do ' + OUT);
  } catch (e) {
    if (process.env.ZRZUT) await page.screenshot({ path: process.env.ZRZUT }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
