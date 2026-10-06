// Lista dokumentów sprzedaży z jednego dnia: id + typ każdego wiersza.
//
// Okno „Dokumenty sprzedaży” (csdocsheaders4sales) ma dwa zakresy dat:
// pierwszy „Data księg.” (domyślnie bieżący miesiąc) i drugi z przełącznikiem
// sprzedaży/wystawienia (domyślnie pusty). „Data księg.” = DocDate w bazie
// (sprawdzone na 1.07: 23 PAR jak na zrzucie Michała), więc ustawiamy tylko
// pierwszy zakres na ten sam dzień, drugiego nie ruszamy.
//
// Nie czytamy komórek siatki — każda strona (21 wierszy) przychodzi jako
// odpowiedź API z csDocsHeadersId, csDocsTypesId, DocNumber i DocDate.
// Lista miesza wszystkie typy sprzedaży (FA, PAR, FAK, FAKR, FAUEK...),
// filtr typu robi wołający.
//
// Kontrola kompletności: liczba zebranych wierszy = licznik „N rekordów”
// w pagerze ERP (jak kontrahenci/lista-nowych.js).

const path = require('path');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', '..', 'produkty', 'lib', 'decode'));

const LIST_PATH = 'pl/dokumenty-sprzedazy/csdocsheaders4sales';
const MAX_STRON = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Podpina podsłuch odpowiedzi listy. Zwraca obiekt ze stanem (licznik
// odpowiedzi i ostatnia strona wierszy).
function podsluchListy(page) {
  const s = { odpowiedzi: 0, ostatnia: [] };
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    if (!/"DictIdent"\s*:\s*"csDocsHeaders4Sales"/.test(r.request().postData() || '')) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList || [];
    for (const x of ret) {
      const k = extractCardRecord({ Result: { RefreshObjectReturnList: [x] } });
      if (k && String(k.dataSetIdent || '').toLowerCase() === 'csdocsheaders4sales' && k.fieldNames.includes('csDocsTypesId')) {
        s.ostatnia = k.records.map(r => ({
          csDocsHeadersId: String(r.csDocsHeadersId), csDocsTypesId: String(r.csDocsTypesId),
          DocNumber: r.DocNumber, DocDate: String(r.DocDate || '').slice(0, 10)
        }));
        s.odpowiedzi++;
      }
    }
  });
  return s;
}

async function pager(page) {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(e => e.offsetParent);
    if (!p) return null;
    const m = /([\d\s ]+)\s*rekord\S*\s*z\s*([\d\s ]+)/.exec(p.textContent.replace(/\s+/g, ' '));
    const next = p.querySelector('.NextPageButton');
    return {
      rekordow: m ? parseInt(m[1].replace(/\D/g, ''), 10) : null,
      stron: m ? parseInt(m[2].replace(/\D/g, ''), 10) : null,
      // Przy jednej stronie ERP ukrywa przycisk (csDisplayNone) zamiast dać „inactive”.
      dalej: !!next && next.offsetParent !== null && !/\b(inactive|csDisplayNone)\b/.test(next.className)
    };
  });
}

// Pierwsza widoczna para Od/Do = „Data księg.”. Wpisujemy klawiaturą jak
// wz/scrape.js (programowe value() nie dociera do kontrolki ERP).
async function ustawDzien(page, s, dzien) {
  const pola = { Od: page.locator('input[placeholder="Od"]:visible').first(), Do: page.locator('input[placeholder="Do"]:visible').first() };
  for (const [nazwa, loc] of Object.entries(pola)) {
    await loc.waitFor({ timeout: 15000 });
    await loc.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(dzien, { delay: 40 + Math.random() * 60 });
    await page.keyboard.press('Tab');
    await sleep(300 + Math.random() * 400);
    const v = await loc.inputValue();
    if (v !== dzien) throw new Error('Pole „' + nazwa + '” Data księg. nie przyjęło ' + dzien + ' (jest: ' + v + ')');
  }
  const przed = s.odpowiedzi;
  await page.locator('.ButtonRefresh:visible').first().click();
  return czekaj(s, przed);
}

async function czekaj(s, przed, ms = 30000) {
  for (let t = 0; t < ms && s.odpowiedzi === przed; t += 200) await sleep(200);
  return s.odpowiedzi !== przed;
}

// Zwraca { wiersze, erp, pelne }. Strona musi być zalogowana; podsłuch
// podpinamy przed wejściem na listę.
async function zbierzDzien(page, baseUrl, dzien) {
  const s = podsluchListy(page);
  await page.goto(baseUrl.replace(/\/$/, '') + '/' + LIST_PATH, { waitUntil: 'domcontentloaded' });
  await czekaj(s, 0, 40000);
  await sleep(1500);
  if (!await ustawDzien(page, s, dzien)) throw new Error('Lista nie odświeżyła się po ustawieniu daty ' + dzien);
  await sleep(800);
  const wiersze = s.ostatnia.slice();
  let pg = await pager(page);
  for (let strona = 2; pg && pg.dalej && strona <= MAX_STRON; strona++) {
    const przed = s.odpowiedzi;
    await page.locator('.csDataPager:visible .NextPageButton').first().click();
    if (!await czekaj(s, przed)) throw new Error(dzien + ': brak odpowiedzi strony ' + strona);
    wiersze.push(...s.ostatnia);
    await sleep(250 + Math.random() * 400);
    pg = await pager(page);
  }
  // Brak pagera = zero wyników.
  const erp = pg ? pg.rekordow : 0;
  const unikalne = new Map(wiersze.map(w => [w.csDocsHeadersId, w]));
  const obcyDzien = Array.from(unikalne.values()).filter(w => w.DocDate !== dzien);
  return { wiersze: Array.from(unikalne.values()), erp, pelne: unikalne.size === erp && wiersze.length === erp, obcyDzien };
}

module.exports = { zbierzDzien };
