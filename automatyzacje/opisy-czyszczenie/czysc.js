// Headless czyszczenie opisów PDP w ERP: usuwa z pola „Opis produktu"
// zapieczony cross-sell (div.svp-pdp__section z .svp-pdp__cards), blok CSS
// (<style>) i zdejmuje klasę --alt z sekcji przepisów. Źródło prawdy logiki
// zapisu to savpol-historia-faktur.user.js — WSTRZYKUJEMY go do strony z
// shimami GM i wołamy savpolOpisy/savpolZapiszOpisy, czyli dokładnie tę samą,
// sprawdzoną ścieżkę co bulk edit w przeglądarce (test 5 SKU 2026-10-02 OK).
//
// Login i sterowanie headless 1:1 z automatyzacje/produkty/scrape.js.
//
// Przebieg: lista SKU → chunki po CHUNK (domyślnie 50). Po każdym chunku
// AUTOWERYFIKACJA NA FRONCIE (żywy opis z __INITIAL_STATE__ sklepu): czy nie
// został cross-sell/CSS, czy opis się nie „rozjechał" (pusty/za krótki),
// czy to właściwy produkt (item == sku). Anomalia albo padnięta sesja ERP =
// STOP (nie lecimy dalej). Zrobione SKU zapamiętujemy w state/done.txt, więc
// ponowne uruchomienie pomija już wyczyszczone.
//
// Uruchomienie:
//   node czysc.js <plik-z-SKU>            — pełny przebieg (chunki po 50)
//   node czysc.js <plik-z-SKU> --limit 5  — tylko tyle SKU (test)
//   node czysc.js <plik-z-SKU> --chunk 25 — inny rozmiar chunku
//   HEADLESS=true node czysc.js ...       — bez okna (domyślnie widoczna)

const path = require('path');
const fs = require('fs');
const os = require('os');

function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const dotenv = req('dotenv');

// .env: lokalny albo wspólny automatyzacje/.env (oba w .gitignore).
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const HEADLESS = process.env.HEADLESS === 'true';
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const CATALOG_URL = process.env.CATALOG_URL || 'https://erp.savpol.pl/pl/katalog/csitems/';
const USERSCRIPT = path.join(__dirname, '..', '..', 'savpol-historia-faktur.user.js');
// Mapowanie SKU→URL sklepu: repo design_system (inny projekt). Bez ścieżki
// absolutnej w kodzie — składamy z katalogu domowego (repo zasady porządku).
const SKUS_JSONL = path.join(os.homedir(), 'Documents', 'claude_code', 'design_system',
  'pages', '_kit', 'cross-sell', 'skus.jsonl');

const STATE_DIR = path.join(__dirname, 'state');
const DONE_FILE = path.join(STATE_DIR, 'done.txt');
const KOPIE_DIR = path.join(STATE_DIR, 'kopie'); // lokalne kopie opisu sprzed zmiany
const LOG_FILE = path.join(__dirname, 'czysc.log');

const LOGIN_SELECTORS = { username: 'input[name="username"]', password: 'input[name="password"]' };

// Próg długości opisu po czyszczeniu — poniżej uznajemy, że coś się rozjechało
// (wyczyszczone opisy mają ~6–13 tys. znaków; pełen opis bez cross-sell/CSS nie
// spada poniżej ~kilkuset znaków). Pusty/kilkudziesięcioznakowy = alarm.
const MIN_OPIS_LEN = 400;

function logLine(s) {
  const line = '[' + new Date().toISOString() + '] ' + s;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* best-effort */ }
}

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });
  const user = process.env.ERP_LOGIN, pass = process.env.ERP_PASSWORD;
  if (!user || !pass) throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w automatyzacje/.env');
  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, user);
  await page.fill(LOGIN_SELECTORS.password, pass);
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 20000 });
  logLine('login: zalogowano, URL=' + page.url());
}

// Userscript bez nagłówka ==UserScript== + shimy GM, do wstrzyknięcia
// page.addInitScript (document-start — podsłuch XHR musi stać przed żądaniami
// strony, żeby złapać kopertę sesji).
function zbudujInitScript() {
  let src = fs.readFileSync(USERSCRIPT, 'utf8');
  src = src.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  const shims = [
    'var unsafeWindow = window;',
    'function GM_setValue(k,v){try{localStorage.setItem("gm_"+k,JSON.stringify(v))}catch(e){}}',
    'function GM_getValue(k,d){try{var v=localStorage.getItem("gm_"+k);return v==null?d:JSON.parse(v)}catch(e){return d}}',
    'function GM_openInTab(){} function GM_download(){}',
    // Mirror do apki (vercel) poleci cross-origin fetchem i zwykle padnie na
    // CORS → apkaZadanie dostanie status 0 (lustro:false, niekrytyczne). ERP
    // (same-origin) działa normalnie.
    'function GM_xmlhttpRequest(o){try{fetch(o.url,{method:o.method,headers:o.headers||{},body:o.data}).then(async r=>{var t="";try{t=await r.text()}catch(e){}o.onload&&o.onload({status:r.status,responseText:t})}).catch(e=>{o.onerror&&o.onerror(e)})}catch(e){o.onerror&&o.onerror(e)}}'
  ].join('\n');
  return shims + '\n' + src;
}

// KROK 1 (w stronie): tylko ODCZYT + policzenie, co usunąć. Nic nie zapisuje —
// żeby Node mógł najpierw zrobić lokalną kopię sprzed zmiany (backup w apce idzie
// cross-origin i w headless pada; nie zapisujemy bez drogi powrotu).
async function odczytajWStronie(sku) {
  const w = window;
  if (!w.savpolOpisy) return { sku, ok: false, blad: 'userscript nie wstrzyknięty' };
  const lista = await w.savpolOpisy(sku);
  if (!lista || !lista.ok) return { sku, ok: false, blad: (lista && lista.blad) || 'brak odczytu' };
  const row = (lista.wiersze || []).find(r => /opis produktu/i.test(r.B2BDescriptionTypeTranslatedDesc || ''));
  if (!row) return { sku, ok: false, blad: 'brak wiersza „Opis produktu"' };
  const stara = String(row.ItemDesc1_PL || row.ItemTranslatedDesc1 || '');
  const d = document.createElement('div');
  d.innerHTML = stara;
  let cross = 0, style = 0, alt = 0;
  Array.from(d.querySelectorAll('.svp-pdp__section')).filter(s => s.querySelector('.svp-pdp__cards')).forEach(n => { n.remove(); cross++; });
  d.querySelectorAll('style').forEach(n => { n.remove(); style++; });
  Array.from(d.querySelectorAll('.svp-pdp__section--alt')).filter(s => s.querySelector('.svp-pdp__recipes')).forEach(n => { n.classList.remove('svp-pdp__section--alt'); alt++; });
  const nowa = d.innerHTML;
  const zmiana = !(cross + style + alt === 0 || nowa === stara);
  return { sku, ok: true, zmiana, cross, style, alt, stara, nowa, lenStara: stara.length, lenNowa: nowa.length };
}

// KROK 2 (w stronie): ZAPIS gotowej treści przez sprawdzoną ścieżkę userscriptu.
async function zapiszWStronie(arg) {
  const w = window;
  const zap = await w.savpolZapiszOpisy(arg.sku, { opis: arg.nowa }, { zapisz: true, tolerujNormalizacje: true, pomijajStrazZmian: true });
  return { ok: !!zap.ok, blad: zap.blad, lustro: !!zap.lustro };
}

// ---------- Weryfikacja na froncie (żywy opis ze sklepu) ----------

function wczytajMapeUrl() {
  const map = {};
  if (!fs.existsSync(SKUS_JSONL)) { logLine('UWAGA: brak skus.jsonl (' + SKUS_JSONL + ') — front-check tylko dla znanych URL.'); return map; }
  for (const l of fs.readFileSync(SKUS_JSONL, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    let o; try { o = JSON.parse(l); } catch (e) { continue; }
    if (o.kod_handlowy && o.url) map[String(o.kod_handlowy).padStart(7, '0')] = o.url;
  }
  return map;
}

function parseInitialState(html) {
  const i = html.indexOf('__INITIAL_STATE__'); if (i < 0) return null;
  const j = html.indexOf('{', i); if (j < 0) return null;
  const BS = String.fromCharCode(92), Q = String.fromCharCode(34);
  let depth = 0, inStr = false, esc = false;
  for (let k = j; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === BS) esc = true; else if (c === Q) inStr = false; continue; }
    if (c === Q) inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(j, k + 1)); } catch (e) { return null; } } }
  }
  return null;
}

// Zwraca { ok, powod } — ok=false gdy opis na froncie wygląda źle.
async function sprawdzFront(apiRequest, sku, url) {
  if (!url) return { ok: true, powod: 'brak URL — pominięto front (zapis w ERP potwierdzony)' };
  let html;
  try { const r = await apiRequest.get(url, { timeout: 30000 }); if (!r.ok()) return { ok: false, powod: 'HTTP ' + r.status() }; html = await r.text(); }
  catch (e) { return { ok: false, powod: 'błąd pobrania: ' + e.message }; }
  const st = parseInitialState(html);
  let card, d = '';
  try { card = st.csAppWindowsUtils.csAppWindows.csB2BItemCard.dataSets.csB2BItemCard.rows[0]; d = String(card.itemTranslatedDesc || ''); }
  catch (e) { return { ok: false, powod: 'nie wyłuskałem opisu ze strony' }; }
  if (String(card.item) !== sku) return { ok: false, powod: 'item na froncie = ' + card.item + ' (≠ ' + sku + ')' };
  if (/<style/i.test(d)) return { ok: false, powod: 'nadal <style>' };
  if (d.includes('svp-pdp__cards')) return { ok: false, powod: 'nadal cross-sell' };
  const parts = d.split('<div class="svp-pdp__section'); let ra = false;
  for (let i = 1; i < parts.length; i++) if (parts[i].slice(0, 30).includes('--alt') && parts[i].includes('svp-pdp__recipes')) ra = true;
  if (ra) return { ok: false, powod: 'przepisy nadal --alt' };
  if (d.length < MIN_OPIS_LEN) return { ok: false, powod: 'opis podejrzanie krótki (' + d.length + ' zn.)' };
  return { ok: true, powod: d.length + ' zn.' };
}

// ---------- Stan (resume) ----------

function wczytajDone() {
  try { return new Set(fs.readFileSync(DONE_FILE, 'utf8').split(/\r?\n/).filter(Boolean)); }
  catch (e) { return new Set(); }
}
function dopiszDone(sku) {
  try { if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true }); fs.appendFileSync(DONE_FILE, sku + '\n'); }
  catch (e) { /* best-effort */ }
}

function czyPadlaSesja(b) { return /hasło nie jest prawidłow/i.test(String(b || '')); }

async function main() {
  const args = process.argv.slice(2);
  const plik = args.find(a => !a.startsWith('--'));
  if (!plik) { console.error('Podaj plik z listą SKU: node czysc.js <plik> [--limit N] [--chunk N]'); process.exit(1); }
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;
  const chunk = args.includes('--chunk') ? parseInt(args[args.indexOf('--chunk') + 1], 10) : 50;

  const wszystkie = fs.readFileSync(plik, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const done = wczytajDone();
  let lista = wszystkie.filter(s => !done.has(s));
  if (lista.length > limit) lista = lista.slice(0, limit);
  const urlMap = wczytajMapeUrl();

  logLine('START: ' + wszystkie.length + ' SKU w pliku, ' + done.size + ' już zrobionych, do zrobienia teraz: '
    + lista.length + ' (chunk=' + chunk + (limit !== Infinity ? ', limit=' + limit : '') + ', ' + (HEADLESS ? 'headless' : 'okno') + ')');
  if (!lista.length) { logLine('Nic do zrobienia.'); return { zrobione: 0, bledy: 0, przerwano: false }; }

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => logLine('[błąd strony] ' + err.message));
  await page.addInitScript({ content: zbudujInitScript() });

  let zrobione = 0, bledy = 0, przerwano = false, powodStop = '';
  const problemy = [];
  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    await page.waitForFunction(() => typeof window.savpolZapiszOpisy === 'function', { timeout: 15000 });
    logLine('katalog załadowany, userscript aktywny.');

    for (let start = 0; start < lista.length && !przerwano; start += chunk) {
      const paczka = lista.slice(start, start + chunk);
      const nrChunku = Math.floor(start / chunk) + 1;
      const ileChunkow = Math.ceil(lista.length / chunk);
      logLine('--- CHUNK ' + nrChunku + '/' + ileChunkow + ' (' + paczka.length + ' SKU) ---');
      const zapisaneWChunku = [];

      for (const sku of paczka) {
        // Krok 1: odczyt (bez zapisu).
        let r;
        try { r = await page.evaluate(odczytajWStronie, sku); }
        catch (e) { r = { sku, ok: false, blad: 'evaluate-odczyt: ' + e.message }; }

        if (!r.ok) {
          logLine('  ✗ ' + sku + ' — ' + r.blad);
          bledy++; problemy.push(sku + ': ' + r.blad);
          if (czyPadlaSesja(r.blad)) { przerwano = true; powodStop = 'sesja ERP wygasła przy ' + sku; break; }
          await page.waitForTimeout(150); continue;
        }
        if (!r.zmiana) { logLine('  · ' + sku + ' — nic do usunięcia, pomijam'); dopiszDone(sku); await page.waitForTimeout(150); continue; }

        // Krok 2: LOKALNA KOPIA sprzed zmiany — dopiero potem zapis.
        try {
          if (!fs.existsSync(KOPIE_DIR)) fs.mkdirSync(KOPIE_DIR, { recursive: true });
          fs.writeFileSync(path.join(KOPIE_DIR, sku + '.html'), r.stara, 'utf8');
        } catch (e) {
          logLine('  ✗ ' + sku + ' — nie zapisałem kopii lokalnej (' + e.message + '), POMIJAM zapis');
          bledy++; problemy.push(sku + ': brak kopii lokalnej — ' + e.message);
          continue;
        }

        // Krok 3: zapis.
        let zap;
        try { zap = await page.evaluate(zapiszWStronie, { sku, nowa: r.nowa }); }
        catch (e) { zap = { ok: false, blad: 'evaluate-zapis: ' + e.message }; }

        if (zap.ok) {
          logLine('  ✓ ' + sku + ' — cross=' + r.cross + ' style=' + r.style + ' alt=' + r.alt
            + ' (' + r.lenStara + '→' + r.lenNowa + ')' + (zap.lustro ? '' : ' [lustro:nie]'));
          zapisaneWChunku.push(sku);
        } else {
          logLine('  ✗ ' + sku + ' — zapis odrzucony: ' + zap.blad);
          bledy++; problemy.push(sku + ': ' + zap.blad);
          if (czyPadlaSesja(zap.blad)) { przerwano = true; powodStop = 'sesja ERP wygasła przy ' + sku; break; }
        }
        await page.waitForTimeout(200);
      }
      if (przerwano) break;

      // --- Autoweryfikacja na froncie dla zapisanych w tym chunku ---
      logLine('  weryfikacja na froncie: ' + zapisaneWChunku.length + ' szt...');
      for (const sku of zapisaneWChunku) {
        const fr = await sprawdzFront(context.request, sku, urlMap[sku]);
        if (fr.ok) { dopiszDone(sku); zrobione++; }
        else {
          logLine('  ⚠ FRONT ' + sku + ' — ' + fr.powod);
          problemy.push('FRONT ' + sku + ': ' + fr.powod);
          przerwano = true; powodStop = 'anomalia na froncie: ' + sku + ' (' + fr.powod + ')';
          break;
        }
      }
      if (!przerwano) logLine('  CHUNK ' + nrChunku + ' OK (' + zapisaneWChunku.length + ' zweryfikowanych na froncie).');
    }
  } catch (err) {
    logLine('[BŁĄD GŁÓWNY] ' + err.message);
    try { await page.screenshot({ path: path.join(__dirname, 'debug-blad.png'), fullPage: true }); } catch (e) {}
    przerwano = true; powodStop = 'wyjątek: ' + err.message;
  } finally {
    await browser.close();
  }

  logLine('KONIEC: zrobione+zweryfikowane=' + zrobione + ', błędy=' + bledy
    + (przerwano ? ', PRZERWANO: ' + powodStop : ', cała lista przerobiona'));
  if (problemy.length) logLine('Problemy:\n  ' + problemy.join('\n  '));
  return { zrobione, bledy, przerwano, powodStop, problemy };
}

if (require.main === module) {
  main().then(r => process.exit(r.przerwano ? 2 : 0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { main };
