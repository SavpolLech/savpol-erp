// Załączniki PDF maszyn (specyfikacje, instrukcje) → linki do maila z ofertą.
//
// Po co: generator oferty maszyn (esavpol/oferty) ma zamiast załączników PDF wstawiać
// w mailu linki. Plik z ERP otwiera się bez logowania pod
//   https://esavpol.pl/api/attachment/get/{CPG}/OpenFileIdent/{base64(FileIdent)}/{FileName}
// (sprawdzone 16.10.2026 na pliku z docs/integracja-pdf-specyfikacja.md, bez SID).
//
// Jak: logowanie i otwarcie karty jak w produkty/scrape.js → zakładka „Załączniki”
// (siatka csAttachments łapana z odpowiedzi) → dla każdego pliku akcja ERP
// csAttachmentsSaveToFileLastVersion (zawsze NAJNOWSZA wersja; FileIdent = RemoteIdent
// to tylko skrót, którego świadomie nie używamy — patrz docs/integracja-pdf-specyfikacja.md).
// Akcję wołamy z wnętrza strony na kopercie sesji podsłuchanej z żądań strony
// (to samo co erpWywolaj w savpol-historia-faktur.user.js).
//
// Tryby:
//   node zalaczniki-maszyn/zbierz.js --sonda [SKU…]   rodzaje i nazwy załączników, BEZ linków
//                                                    → zalaczniki-maszyn/sonda.json (lokalnie, .gitignore)
//   node zalaczniki-maszyn/zbierz.js [SKU…]           linki tylko dla rodzajów z DOZWOLONE
//                                                    → state/zalaczniki.json (commit + push przez pushLogs)
// Bez listy SKU: esavpol/oferty/katalog-sku.txt (pisze go esavpol/oferty/zbuduj-katalog.mjs).
//
// DOZWOLONE: repo jest de facto publiczne, a link otwiera plik bez hasła — do pliku stanu
// trafiają wyłącznie rodzaje przeznaczone dla klienta. Nowy rodzaj = świadoma decyzja tutaj.

const path = require('path');
const fs = require('fs');
const os = require('os');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const { login, CATALOG_URL, HEADLESS, decodeJsonResult, extractCardRecord,
  openProductCardInPage, closeProductCardInPage } = require('../produkty/scrape');
const { pushLogs } = require('../lib-wspolne/git-log-push');

const AUTO_DIR = path.join(__dirname, '..');
// Lock zawsze z GŁÓWNEJ kopii repo — także gdy skrypt idzie z worktree sesji (inaczej lock
// worktree nie widziałby biegu orkiestratora i weszlibyśmy na ERP równolegle).
function glownyAutoDir() {
  try {
    const common = require('child_process').execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: __dirname, encoding: 'utf8' }).trim();
    return path.join(path.dirname(common), 'automatyzacje');
  } catch (e) { return AUTO_DIR; }
}
const LOCK_PATH = path.join(glownyAutoDir(), '.scrapery.lock');
const { acquire, release } = require('../lib-wspolne/lock')(LOCK_PATH);
const STATE_DIR = path.join(__dirname, 'state');
const WYNIK = path.join(STATE_DIR, 'zalaczniki.json');
const SONDA = path.join(__dirname, 'sonda.json');
const RUN_LOG = path.join(__dirname, 'run-log.jsonl');
const KATALOG_SKU = path.join(os.homedir(), 'Documents', 'claude_code', 'esavpol', 'oferty', 'katalog-sku.txt');
const PUBLIC_ORIGIN = 'https://esavpol.pl';

// Rodzaje załączników dla klienta: dopasowanie po nazwie rodzaju (csAttachmentsTypes…Desc).
// Uzupełniane po sondzie z 16.10.2026.
const DOZWOLONE = [];

const args = process.argv.slice(2);
const TRYB_SONDA = args.includes('--sonda');
const skusArg = args.filter(a => !a.startsWith('--'));

function wczytajSku() {
  if (skusArg.length) return skusArg;
  if (!fs.existsSync(KATALOG_SKU)) throw new Error('Brak listy SKU: ' + path.relative(AUTO_DIR, KATALOG_SKU) +
    ' — podaj SKU w argumentach albo zbuduj katalog w esavpol/oferty.');
  return fs.readFileSync(KATALOG_SKU, 'utf8').split(/\s+/).filter(Boolean);
}

// ---------- W stronie: podsłuch koperty sesji i wywołanie akcji (z userscriptu) ----------
// Wstrzykiwane przez addInitScript, zanim ERP zacznie wysyłać żądania.
function podsluchKoperty() {
  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke';
  window.__svpZal = { koperta: null };
  function rozpakujZadanie(b64) {
    let sur;
    try { sur = atob(b64); } catch (e) { return null; }
    let bajty = Uint8Array.from(sur, c => c.charCodeAt(0));
    if (bajty.length > 30 && bajty[0] === 0x50 && bajty[1] === 0x4b && (bajty[8] | (bajty[9] << 8)) === 0) {
      const rozmiar = (bajty[18] | (bajty[19] << 8) | (bajty[20] << 16) | (bajty[21] << 24)) >>> 0;
      const start = 30 + (bajty[26] | (bajty[27] << 8)) + (bajty[28] | (bajty[29] << 8));
      if (rozmiar > 0 && start + rozmiar <= bajty.length) bajty = bajty.slice(start, start + rozmiar);
    }
    const s = new TextDecoder('utf-8').decode(bajty);
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    return (a < 0 || b <= a) ? null : s.slice(a, b + 1);
  }
  const origOpen = XMLHttpRequest.prototype.open, origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__svpUrl = u; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (typeof body === 'string' && String(this.__svpUrl || '').indexOf(ENDPOINT) >= 0) {
        const p = JSON.parse(body), srodek = p && p.Input ? rozpakujZadanie(p.Input) : null;
        if (srodek) {
          const k = JSON.parse(srodek), ri = k.OperationInvokeInput && k.OperationInvokeInput.RefreshInputObject;
          if (ri && ri.ParentUniqName) window.__svpZal.koperta = k;
        }
      }
    } catch (e) { /* jedno nieczytelne żądanie nie psuje podsłuchu */ }
    return origSend.apply(this, arguments);
  };
}

async function infoOPlikuWStronie(z) {
  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke';
  const k = window.__svpZal && window.__svpZal.koperta;
  if (!k) return { ok: false, blad: 'brak koperty sesji' };
  const guid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  function b64utf8(s) {
    const b = new TextEncoder().encode(s); let bin = '';
    for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return btoa(bin);
  }
  async function rozpakujOdpowiedz(b64) {
    const bajty = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (bajty[0] !== 0x50 || bajty[1] !== 0x4b) { const t = new TextDecoder().decode(bajty); return t.trim()[0] === '{' ? t : null; }
    const metoda = bajty[8] | (bajty[9] << 8);
    const start = 30 + (bajty[26] | (bajty[27] << 8)) + (bajty[28] | (bajty[29] << 8));
    const dane = bajty.slice(start);
    if (metoda === 0) return new TextDecoder().decode(dane);
    const st = new Blob([dane]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(st).text();
  }
  const paczka = JSON.parse(JSON.stringify(k));
  paczka.OperationInvokeInput = Object.assign({}, paczka.OperationInvokeInput, {
    OperationName: 'ActionExecute',
    Params: {
      DictIdent: 'csItemsOneBro', ActionIdent: 'csAttachmentsSaveToFileLastVersion', DataSetTypeIdent: 'csAttachments',
      __StartField__: 'FileDesc',
      __SelectedRecords__: '<csSelectedRows><row><csAttachmentsG>' + z.csAttachmentsG + '</csAttachmentsG></row></csSelectedRows>',
      __PageRecords__: '<csPageRecords><row></row></csPageRecords>', __SortList__: '<SortList></SortList>',
      HasParams: '0', ActionExecuteType: 0, LoginProviderObject: null
    },
    DelegateIdent: guid(), RefreshInputObject: null,
    DataTableInitList: {
      '0': { DataSetSQLIdent: 'ActiveRecord', SortList: [], Refresh: false,
        DataTableInit: { DataTable: { FieldDefs: [{ Index: 0, FieldName: 'csAttachmentsId', FieldType: 'number', OriginalFieldType: 'System.Int64' }],
          Rows: [[{ Item: z.csAttachmentsId }]] } } },
      length: 1
    }
  });
  if (paczka.LoginInfo) paczka.LoginInfo.Password = '';
  const r = await fetch(location.origin + ENDPOINT, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ DictIdent: 'csItemsOneBro', Input: b64utf8(JSON.stringify(paczka)), Compress: false })
  });
  let j; try { j = await r.json(); } catch (e) { return { ok: false, blad: 'HTTP ' + r.status }; }
  if (j.Error) return { ok: false, blad: String(j.Error).slice(0, 200) };
  const tresc = j.JSONResult ? await rozpakujOdpowiedz(j.JSONResult) : null;
  if (!tresc) return { ok: false, blad: 'nie rozpakowałem odpowiedzi' };
  const d = JSON.parse(tresc);
  const info = d.OperationInvokeResult && d.OperationInvokeResult.RemoteFileInfoList && d.OperationInvokeResult.RemoteFileInfoList[0];
  if (!info || !info.FileIdent) return { ok: false, blad: 'odpowiedź bez FileIdent' };
  return { ok: true, fileIdent: info.FileIdent, fileName: info.FileName, cpg: k.LoginInfo && k.LoginInfo.CPG };
}

async function otworzZakladkeZalacznikow() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tab = Array.from(document.querySelectorAll('li[title]'))
    .find(li => li.offsetParent !== null && /^za[łl][ąa]czniki$/i.test(li.getAttribute('title').trim()));
  if (!tab) return { ok: false, blad: 'nie widzę zakładki „Załączniki" na karcie' };
  tab.click();
  await sleep(1500);
  return { ok: true };
}

// ---------- Node ----------

function rodzaj(w) {
  return String(w.csAttachmentsTypesTranslatedDesc || w.AttachmentTypeDesc || w.csAttachmentsTypesDesc || w.csAttachmentsTypesG || '?').trim();
}
function dozwolony(r) { return DOZWOLONE.some(re => re.test(r)); }

function wybierzZalaczniki(captured, csItemsId) {
  for (let i = captured.length - 1; i >= 0; i--) {
    const c = captured[i];
    if (!c.fieldNames.includes('csAttachmentsId')) continue;
    const w = c.records.filter(r => !csItemsId || String(r.SourceId) === String(csItemsId));
    if (w.length || c.records.length === 0) return w;
  }
  return null;
}
function idProduktu(captured, sku) {
  for (const c of captured) for (const r of c.records) if (r.Item === sku && r.csItemsId) return r.csItemsId;
  return null;
}

async function main() {
  if (!acquire()) process.exit(3);
  process.on('exit', release);
  const skus = wczytajSku();
  console.log('[start] ' + skus.length + ' SKU, tryb: ' + (TRYB_SONDA ? 'SONDA (bez linków)' : 'linki dla: ' + (DOZWOLONE.map(String).join(', ') || '— brak dozwolonych rodzajów!')));
  if (!TRYB_SONDA && !DOZWOLONE.length) throw new Error('DOZWOLONE jest puste — najpierw --sonda i decyzja, które rodzaje są dla klienta.');

  const poprzedni = fs.existsSync(WYNIK) ? JSON.parse(fs.readFileSync(WYNIK, 'utf8')) : { produkty: {} };
  const wynik = { zbudowano: new Date().toISOString(), zrodlo: 'ERP, zakładka Załączniki + akcja csAttachmentsSaveToFileLastVersion', produkty: Object.assign({}, poprzedni.produkty) };
  const sonda = { zbudowano: new Date().toISOString(), rodzaje: {}, produkty: {} };
  let ok = 0, bledy = 0;

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  await context.addInitScript(podsluchKoperty);
  const page = await context.newPage();
  const captured = [];
  page.on('response', async resp => {
    try {
      if (resp.request().method() !== 'POST') return;
      const body = await resp.text();
      if (!body || body.indexOf('JSONResult') === -1) return;
      // Wszystkie siatki z odpowiedzi, nie tylko pierwsza (extractCardRecord bierze [0]):
      // zakładka Załączniki zwraca csAttachments i csAttachmentsVersions w jednej odpowiedzi.
      const d = decodeJsonResult(body);
      const lista = d && d.Result && d.Result.RefreshObjectReturnList || [];
      lista.forEach((_, i) => {
        const rec = extractCardRecord({ Result: { RefreshObjectReturnList: [lista[i]] } });
        if (rec && rec.records) captured.push(rec);
      });
    } catch (e) { /* pomijamy */ }
  });

  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });

    for (const sku of skus) {
      captured.length = 0;
      const otw = await page.evaluate(openProductCardInPage, { sku });
      if (!otw.ok) { console.warn('[' + sku + '] ' + otw.blad); bledy++; continue; }
      let id = null;
      for (let i = 0; i < 40 && !id; i++) { id = idProduktu(captured, sku); if (!id) await page.waitForTimeout(300); }
      const zak = await page.evaluate(otworzZakladkeZalacznikow);
      let wiersze = null;
      if (zak.ok) for (let i = 0; i < 30 && !wiersze; i++) { wiersze = wybierzZalaczniki(captured, id); if (!wiersze) await page.waitForTimeout(300); }
      if (!wiersze) { console.warn('[' + sku + '] ' + (zak.ok ? 'nie przechwyciłem listy załączników' : zak.blad)); bledy++; await page.evaluate(closeProductCardInPage); continue; }

      const pliki = wiersze.filter(w => String(w.IsFile) !== '0');
      sonda.produkty[sku] = pliki.map(w => ({ rodzaj: rodzaj(w), nazwa: w.LocalFileName || w.FileDesc || '', dodano: w.AddDate || '' }));
      pliki.forEach(w => { const r = rodzaj(w); sonda.rodzaje[r] = (sonda.rodzaje[r] || 0) + 1; });

      if (!TRYB_SONDA) {
        const linki = [];
        for (const w of pliki.filter(w => dozwolony(rodzaj(w)))) {
          const info = await page.evaluate(infoOPlikuWStronie, { csAttachmentsG: w.csAttachmentsG, csAttachmentsId: w.csAttachmentsId });
          if (!info.ok) { console.warn('[' + sku + '] ' + (w.LocalFileName || '') + ': ' + info.blad); continue; }
          const url = PUBLIC_ORIGIN + '/api/attachment/get/' + info.cpg + '/OpenFileIdent/' +
            Buffer.from(info.fileIdent).toString('base64') + '/' + encodeURIComponent(info.fileName);
          linki.push({ rodzaj: rodzaj(w), nazwa: info.fileName, dodano: w.AddDate || '', url });
        }
        wynik.produkty[sku] = linki;
      }
      console.log('[' + sku + '] plików: ' + pliki.length + (TRYB_SONDA ? '' : ', linków: ' + wynik.produkty[sku].length) +
        ' — ' + pliki.map(w => rodzaj(w)).join(' | '));
      ok++;
      await page.evaluate(closeProductCardInPage);
    }
  } finally {
    await browser.close();
  }

  // Kontrola: czy linki otwierają PDF bez logowania (sygnatura, nie sam kod HTTP).
  let zlych = 0;
  if (!TRYB_SONDA) {
    for (const [sku, linki] of Object.entries(wynik.produkty)) for (const l of linki) {
      try {
        const r = await fetch(l.url, { headers: { Range: 'bytes=0-4' } });
        const t = Buffer.from(await r.arrayBuffer()).toString('latin1', 0, 5);
        l.sprawdzono = r.ok && t.startsWith('%PDF') ? 'ok' : 'HTTP ' + r.status;
      } catch (e) { l.sprawdzono = 'błąd: ' + e.message; }
      if (l.sprawdzono !== 'ok') { zlych++; console.warn('[kontrola] ' + sku + ' ' + l.nazwa + ': ' + l.sprawdzono); }
    }
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(WYNIK, JSON.stringify(wynik, null, 1));
  } else {
    fs.writeFileSync(SONDA, JSON.stringify(sonda, null, 1));
    console.log('\n[sonda] rodzaje załączników (liczba plików):');
    Object.entries(sonda.rodzaje).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log('  ' + n + '  ' + r));
  }

  // Sonda jest lokalna (bez logu w repo); bieg z linkami zapisuje log i stan, i sam je wypycha.
  if (!TRYB_SONDA) {
    fs.appendFileSync(RUN_LOG, JSON.stringify({ ts: new Date().toISOString(), sku: skus.length, ok, bledy, zlychLinkow: zlych }) + '\n');
    pushLogs('zalaczniki-maszyn', ok + '/' + skus.length + ' maszyn');
  }
  console.log('\n[koniec] ' + ok + '/' + skus.length + ' kart, błędów: ' + bledy + (TRYB_SONDA ? '' : ', złych linków: ' + zlych));
}

main().catch(err => { console.error(err); process.exit(1); });
