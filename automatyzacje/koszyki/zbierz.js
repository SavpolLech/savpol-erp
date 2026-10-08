// Koszyki i zamówienia sklepu esavpol (ZOID) z żywego ERP → wynik/zoid_<od>_<do>.json
// Wejście dla raport.js (B-08: koszyki tygodniowo, kandydat do raportu poniedziałkowego Z-04).
//
// Okno: Sprzedaż → Zamówienia sprzedaży (csdocsheaders4salesorders). Ręcznie (Lech 2026-10-08):
// wyczyścić „Realizacja Od”, zakres „Data”, „zoid” w wyszukiwarce, status, Pokaż.
// Skrypt nie klika filtrów (kontrolki ERP są kapryśne): przechwytuje zapytanie listy
// (OperatrionInvoke, DictIdent csDocsHeaders4SalesOrders) i podmienia w nim filtry —
// status „Wszystkie” z koszykami, bez daty realizacji — oraz PageSizeFromClient, więc każdy
// miesiąc przychodzi jednym zapytaniem. Status dokumentu (koszyk / zamknięte) jest w wierszach. Input zapytania = base64(ZIP z jednym plikiem JSON); odsyłamy ZIP
// z deflate i poprawnym CRC32.
//
// Uruchomienie: node koszyki/zbierz.js [--od=2026-07-01] [--do=RRRR-MM-DD]
// Domyślnie od 1. dnia miesiąca 3 miesiące wstecz do dziś.

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const W = require(path.join(__dirname, '..', 'kontrahenci', 'lib', 'wspolne'));
const { chromium } = W.req('playwright');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));

const LIST_URL = W.ERP_BASE_URL.replace(/\/$/, '') + '/pl/zamowienia-sprzedazy/csdocsheaders4salesorders/' + W.COMPANY_ID;
const DICT = 'csDocsHeaders4SalesOrders';
const PAGE_SIZE = 3000;
const OUT_DIR = path.join(__dirname, 'wynik');
const ZOID_TYP = '14210813631'; // „Zamówienie od odbiorcy - internet detal”
// Kody statusu (pole csDocsHeadersStatusIdType, ustalone 2026-10-08): 1 W koszyku, 7 Zamknięte, 8 Anulowane,
// 102 domyślny widok (tylko otwarte). Zamknięte bez „zoid” obejmują całą hurtownię (timeout), koszyki
// z wyszukiwarką gubią ~5% (409 z 431 w lipcu) — stąd koszyki bez wyszukiwania, filtr typu po stronie skryptu.
const PRZEBIEGI = [
  { nazwa: 'koszyki', filtr: { csDocsHeadersStatusIdType: 1 } },
  { nazwa: 'zamkniete', filtr: { csDocsHeadersStatusIdType: 7, SearchText: 'zoid' } },
  { nazwa: 'anulowane', filtr: { csDocsHeadersStatusIdType: 8, SearchText: 'zoid' } }
];
// Pola zapisywane do wyniku. Bez danych osobowych: e-mail i telefon tylko jako „podane / nie”.
function wiersz(w) {
  return {
    id: String(w.csDocsHeadersId), nr: w.DocNumber, data: String(w.DocDate || '').slice(0, 10),
    status: w.StatusValueTranslatedDesc, statusId: String(w.csDocsHeadersStatusId),
    netto: Number(w.CNAmount) || 0, brutto: Number(w.CGAmount) || 0, klient: String(w.csCustomersId),
    etap: w.CheckoutStage == null ? null : w.CheckoutStage, dostawaId: w.csB2BPortalsDeliveryMethodsId == null ? null : String(w.csB2BPortalsDeliveryMethodsId),
    dostawa: w.DeliveryMethodTranslatedDesc || null, platnosc: w.PaymentTypeTranslatedDesc || null,
    kg: Number(w.DocGrossWeight) || 0, email: !!w.EMails, telefon: !!w.Phones
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const dzis = new Date();
const iso = d => d.toISOString().slice(0, 10);
const OD = arg('od', iso(new Date(Date.UTC(dzis.getFullYear(), dzis.getMonth() - 3, 1))));
const DO = arg('do', iso(dzis));
const DEBUG = process.argv.includes('--debug');

// ZIP z jednym plikiem (deflate, jak wysyła przeglądarka).
function zipDeflate(nazwa, surowe) {
  const n = Buffer.from(nazwa, 'utf8');
  const crc = zlib.crc32(surowe) >>> 0;
  const dane = zlib.deflateRawSync(surowe);
  const lok = Buffer.alloc(30);
  lok.writeUInt32LE(0x04034b50, 0); lok.writeUInt16LE(20, 4); lok.writeUInt16LE(0, 6); lok.writeUInt16LE(8, 8);
  lok.writeUInt32LE(0, 10); lok.writeUInt32LE(crc, 14); lok.writeUInt32LE(dane.length, 18); lok.writeUInt32LE(surowe.length, 22);
  lok.writeUInt16LE(n.length, 26); lok.writeUInt16LE(0, 28);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8); cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(dane.length, 20); cen.writeUInt32LE(surowe.length, 24);
  cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 30); cen.writeUInt32LE(0, 34); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(0, 42);
  const offCen = 30 + n.length + dane.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(offCen, 16);
  return Buffer.concat([lok, n, dane, cen, n, end]);
}

// Podmienia filtry okna i rozmiar strony w zapytaniu listy. Zwraca nową treść POST albo null.
// Filtry siedzą w DataTable z polem SearchText (+ druga tabela parametrów z tymi samymi datami);
// komórka = {"Item": wartość}. Kody statusu: 102 = „Wszystkie” (domyślny).
let FILTR = null;
function przepiszZapytanie(postData) {
  let zew; try { zew = JSON.parse(postData); } catch (e) { return null; }
  if (!zew.Input || !FILTR) return null;
  const buf = Buffer.from(zew.Input, 'base64');
  if (buf.readUInt32LE(0) !== 0x04034b50) return null;
  const nazwa = buf.subarray(30, 30 + buf.readUInt16LE(26)).toString('utf8');
  const metoda = buf.readUInt16LE(8);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const tekst = (metoda === 0 ? buf.subarray(start, start + buf.readUInt32LE(18))
    : zlib.inflateRawSync(buf.subarray(start), { finishFlush: zlib.constants.Z_SYNC_FLUSH })).toString('utf8');
  if (!tekst.includes(DICT) || !/"PageSizeFromClient"\s*:\s*\d+/.test(tekst)) return null;
  const j = JSON.parse(tekst.replace(/"PageSizeFromClient"\s*:\s*\d+/g, '"PageSizeFromClient":' + PAGE_SIZE));
  let tabel = 0;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.FieldDefs) && Array.isArray(o.Rows) && o.Rows.length === 1 && o.FieldDefs.some(f => f.FieldName === 'DocDateFrom')) {
      tabel++;
      o.FieldDefs.forEach((f, i) => {
        if (!(f.FieldName in FILTR)) return;
        const c = o.Rows[0][i];
        if (c && typeof c === 'object' && !Array.isArray(c)) { const k = Object.keys(c)[0] || 'Item'; o.Rows[0][i] = { [k]: FILTR[f.FieldName] }; }
        else o.Rows[0][i] = FILTR[f.FieldName];
      });
      return;
    }
    for (const k in o) walk(o[k]);
  })(j);
  if (DEBUG) console.log('[route] filtry w ' + tabel + ' tabelach: ' + FILTR.DocDateFrom + ' – ' + FILTR.DocDateTo);
  zew.Input = zipDeflate(nazwa, Buffer.from(JSON.stringify(j), 'utf8')).toString('base64');
  return JSON.stringify(zew);
}

// Miesiące zakresu [od, do] jako pary dat (ERP: „RRRR-MM-DD 00:00:00”, Do włącznie).
function miesiace(od, doo) {
  const out = [];
  let d = new Date(od + 'T00:00:00Z');
  const koniec = new Date(doo + 'T00:00:00Z');
  while (d <= koniec) {
    const k = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    out.push([iso(d), iso(k < koniec ? k : koniec)]);
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  return out;
}

async function main() {
  W.zajmijErp();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('[koszyki] Zakres ' + OD + ' – ' + DO);
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  const s = { odpowiedzi: 0, ostatnia: null, pola: null };
  await page.route(/OperatrionInvoke/, async route => {
    const pd = route.request().postData() || '';
    const nowy = pd.includes('"DictIdent"') && /SalesOrders/i.test(pd) ? przepiszZapytanie(pd) : null;
    if (DEBUG && /SalesOrders/i.test(pd)) console.log('[route] ' + (JSON.parse(pd).DictIdent || '?') + ', ' + (nowy ? 'przepisane' : 'bez zmian'));
    // Nie zapisuj treści zapytań na dysk: LoginInfo niesie login i hasło ERP otwartym tekstem.
    return nowy ? route.continue({ postData: nowy }) : route.continue();
  });
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    if (!new RegExp('"DictIdent"\\s*:\\s*"' + DICT + '"', 'i').test(r.request().postData() || '')) return;
    let body; try { body = await r.text(); } catch (e) { if (DEBUG) console.log('[odp] błąd odczytu', e.message); return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList || [];
    for (const x of ret) {
      const k = extractCardRecord({ Result: { RefreshObjectReturnList: [x] } });
      if (k && String(k.dataSetIdent || '').toLowerCase() === DICT.toLowerCase()) {
        s.ostatnia = k.records; s.pola = k.fieldNames; s.odpowiedzi++;
        if (DEBUG) console.log('[odp] ' + body.length + ' B, ' + k.records.length + ' wierszy');
      }
    }
  });

  await W.login(page);
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
  for (let t = 0; t < 40000 && !s.odpowiedzi; t += 250) await sleep(250);
  await sleep(1500);

  const wynik = { od: OD, do: DO, pobrano: new Date().toISOString(), przebiegi: [], wiersze: [] };
  const widziane = new Set();
  for (const [od, doo] of miesiace(OD, DO)) {
    for (const p of PRZEBIEGI) {
      FILTR = Object.assign({ WithoutCart: 0, RouteDateFrom: null, RouteDateTo: null,
        DocDateFrom: od + ' 00:00:00', DocDateTo: doo + ' 00:00:00' }, p.filtr);
      const przed = s.odpowiedzi;
      // Odśwież listę (ikona przy filtrach). „Pokaż” otwiera kartę zaznaczonego dokumentu.
      await odswiez(page, s);
      for (let t = 0; t < 240000 && s.odpowiedzi === przed; t += 250) await sleep(250);
      if (s.odpowiedzi === przed) throw new Error(od + ' ' + p.nazwa + ': brak odpowiedzi listy');
      const wiersze = s.ostatnia || [];
      let zoid = 0;
      for (const w of wiersze) {
        if (String(w.csDocsTypesId) !== ZOID_TYP) continue;
        zoid++;
        const id = String(w.csDocsHeadersId);
        if (widziane.has(id)) continue;
        widziane.add(id);
        wynik.wiersze.push(wiersz(w));
      }
      const uciete = wiersze.length >= PAGE_SIZE;
      wynik.przebiegi.push({ od, do: doo, przebieg: p.nazwa, wierszy: wiersze.length, zoid, uciete });
      console.log('[koszyki] ' + od + ' ' + p.nazwa + ': ' + zoid + ' ZOID' + (uciete ? ' (UCIĘTE — zmniejsz okres)' : ''));
      await sleep(1000);
    }
  }
  const plik = path.join(OUT_DIR, 'zoid_' + OD + '_' + DO + '.json');
  fs.writeFileSync(plik, JSON.stringify(wynik));
  console.log('[koszyki] Zapisano ' + path.relative(process.cwd(), plik) + ' (' + wynik.wiersze.length + ' dokumentów)');
  await browser.close();
}

// Klik „odśwież”. Po niektórych odpowiedziach ERP zasłania filtry (okno/nakładka) — wtedy Escape,
// a jak nie pomoże, ponowne wejście na listę (zapytanie startowe też przechodzi przez przepisywanie).
async function odswiez(page, s) {
  const btn = page.locator('.ButtonRefresh:visible').first();
  for (let proba = 0; proba < 3; proba++) {
    try { await btn.click({ timeout: 15000 }); return; } catch (e) {
      if (DEBUG) console.log('[odswiez] próba ' + (proba + 1) + ': ' + e.message.split(/\r?\n/)[0]);
      await page.keyboard.press('Escape').catch(() => {});
      if (proba === 1) {
        const przed = s.odpowiedzi;
        await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
        for (let t = 0; t < 60000 && s.odpowiedzi === przed; t += 250) await sleep(250);
        if (s.odpowiedzi !== przed) return; // zapytanie startowe już z bieżącymi filtrami
      }
    }
  }
  throw new Error('Nie da się odświeżyć listy');
}

main().catch(e => { console.error(e); process.exit(1); });
