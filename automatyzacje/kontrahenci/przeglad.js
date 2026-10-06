// Tygodniowy przegląd WSZYSTKICH kontrahentów: cała lista ERP (filtr
// "Wszyscy", ~2766 stron po 21) porównana z worek.dbo.csCustomers.
//
// Dlaczego cała lista, a nie LastChangeDate: lista nie ma tej kolumny ani
// filtra po niej, a w worku widać, że automatyczne zmiany statusu jej nie
// ruszają (miesiąc przed kopią: status zmieniony u 2158 kontrahentów,
// LastChangeDate tylko u 999). Każda strona listy niesie w odpowiedzi API
// ~92 pola wiersza (status, nazwa, NIP, adres/kontakt, role, opiekun...).
//
// Wynik (wynik/, poza repo — dane osobowe):
//   przeglad-<data>.json  — zmiany per kontrahent, nowi, usunięci, kontrola,
//   przeglad-nowi-id.txt  — wejście dla scrape.js --plik=... (pełna karta).
// Do repo (run-log.jsonl + state/przeglad-ostatni.json) idą tylko liczby.
//
// KONTROLA: numery stron po kolei; unikalnych wierszy = licznik ERP
// "Wszyscy" (na starcie i na końcu). Inaczej przegląd jest NIEPEŁNY i
// --zapisz odmawia.
//
// Uruchomienie:
//   node przeglad.js                 — podgląd: tylko raport, baza bez zmian
//   node przeglad.js --z-pliku=wynik/przeglad-surowe-<data>.json
//                                    — porównanie bez wchodzenia na ERP
//   node przeglad.js --zapisz        — (po akceptacji) UPDATE zmienionych
//                                      + historia w dbo.csCustomersZmiany
// Dlaczego UPDATE, skoro worek jest insert-only: wyjątek dla słownika
// kontrahentów, decyzja Lecha 2026-10-06 na prośbę Michała.

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { pushLogs } = require(path.join(__dirname, '..', 'lib-wspolne', 'git-log-push'));

const LIST_URL = W.ERP_BASE_URL.replace(/\/$/, '') + '/pl/kontrahenci/cscustomers';
const ZAPISZ = process.argv.includes('--zapisz');
const Z_PLIKU = (process.argv.find(a => a.startsWith('--z-pliku=')) || '').slice(10);
const DZIS = new Date().toISOString().slice(0, 10);
const RUN_LOG = path.join(__dirname, 'run-log.jsonl');
const STATE = path.join(__dirname, 'state', 'przeglad-ostatni.json');
const TABELA_ZMIAN = 'csCustomersZmiany';
// Test: tylko N pierwszych stron (przegląd wtedy z definicji NIEPEŁNY).
const MAX_STRON = parseInt((process.argv.find(a => a.startsWith('--max-stron=')) || '').slice(12), 10) || Infinity;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Kolumny techniczne / wyliczane po stronie ERP — nie porównujemy.
const POMIJAJ = new Set(['csCustomersId', 'csCompaniesId', 'Logo', 'LogoSmall', 'KeyWordsAuto']);

// ---------- ERP: cała lista ----------

async function pobierzListe() {
  const { chromium } = W.req('playwright');
  const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', 'produkty', 'lib', 'decode'));
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();

  let odpowiedzi = 0, ostatnia = [];
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    if (!/"DictIdent"\s*:\s*"csCustomers"/.test(r.request().postData() || '')) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    for (const x of ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList || []) {
      const k = extractCardRecord({ Result: { RefreshObjectReturnList: [x] } });
      if (k && k.fieldNames.includes('CustomerIdent')) { ostatnia = k.records; odpowiedzi++; }
    }
  });
  const czekaj = async (przed, ms = 20000) => {
    for (let t = 0; t < ms && odpowiedzi === przed; t += 150) await sleep(150);
    return odpowiedzi !== przed;
  };
  const pager = () => page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(e => e.offsetParent);
    if (!p) return null;
    const m = /([\d\s ]+)\s*rekord\S*\s*z\s*([\d\s ]+)/.exec(p.textContent.replace(/\s+/g, ' '));
    const i = p.querySelector('.ActivePageNoInput');
    const next = p.querySelector('.NextPageButton');
    return { rekordow: m ? parseInt(m[1].replace(/\D/g, ''), 10) : null, stron: m ? parseInt(m[2].replace(/\D/g, ''), 10) : null,
      strona: i ? parseInt(i.value, 10) : null,
      dalej: !!next && next.offsetParent !== null && !/\b(inactive|csDisplayNone)\b/.test(next.className) };
  });

  const wiersze = new Map();
  const start = Date.now();
  let erpStart = null, erpKoniec = null, stronOk = true, przeczytanych = 0, ostatniaStrona = 0;
  try {
    await W.login(page);
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="CustomerDesc"]', { timeout: 40000 });
    let p = odpowiedzi;
    await page.locator('input.csDBRadioGroupItemInput:visible').first().check({ force: true }); // Wszyscy
    await czekaj(p); await sleep(800);
    let pg = await pager();
    erpStart = pg.rekordow;
    console.log('[przeglad] ERP "Wszyscy": ' + erpStart + ' kontrahentów, ' + pg.stron + ' stron.');
    for (;;) {
      if (pg.strona !== ostatniaStrona + 1) { stronOk = false; console.warn('[przeglad] przeskok stron: ' + ostatniaStrona + ' → ' + pg.strona); }
      ostatniaStrona = pg.strona;
      for (const r of ostatnia) wiersze.set(String(r.csCustomersId), r);
      przeczytanych += ostatnia.length;
      if (pg.strona % 100 === 0) {
        const min = (Date.now() - start) / 60000;
        console.log('[przeglad] strona ' + pg.strona + '/' + pg.stron + ' (' + min.toFixed(1) + ' min, ~' +
          (min / pg.strona * (pg.stron - pg.strona)).toFixed(0) + ' min do końca)');
      }
      if (!pg.dalej || pg.strona >= MAX_STRON) break;
      p = odpowiedzi;
      await page.locator('.csDataPager:visible .NextPageButton').first().click();
      if (!await czekaj(p)) { stronOk = false; console.warn('[przeglad] brak odpowiedzi po stronie ' + pg.strona); break; }
      await sleep(120 + Math.random() * 200);
      pg = await pager();
    }
    erpKoniec = (await pager()).rekordow;
  } finally {
    await browser.close();
  }
  const surowe = { pobrano: new Date().toISOString(), minut: +((Date.now() - start) / 60000).toFixed(1),
    erpStart, erpKoniec, stron: ostatniaStrona, stronOk, przeczytanych, wiersze: Array.from(wiersze.values()) };
  fs.mkdirSync(W.OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(W.OUT_DIR, 'przeglad-surowe-' + DZIS + '.json'), JSON.stringify(surowe), 'utf8');
  return surowe;
}

// ---------- Porównanie ----------

const pusty = v => v === null || v === undefined || v === '';
const LICZBOWE = /^(int|bigint|smallint|tinyint|bit|decimal|numeric|float|real|money)$/;

// Wartość ERP (z listy) → typ kolumny; null = pole puste.
function erpNaTyp(v, col) {
  if (pusty(v)) return null;
  return W.wartosc(v, Object.assign({}, col, { IS_NULLABLE: 'YES' }));
}

function rowne(db, erp, col) {
  if (pusty(db) && pusty(erp)) return true;
  // NULL w bazie vs 0 w ERP (flagi) to niewypełnione pole, nie zmiana (jak w mm/wz/pz/produkty).
  if (LICZBOWE.test(col.DATA_TYPE) && pusty(db) && Number(erp) === 0) return true;
  if (pusty(db) || pusty(erp)) return false;
  if (col.DATA_TYPE === 'uniqueidentifier') return String(db).toLowerCase() === String(erp).toLowerCase();
  if (/date/.test(col.DATA_TYPE)) {
    // ERP podaje czas do sekundy, baza ma milisekundy.
    const a = new Date(db).getTime(), b = new Date(erp).getTime();
    return Math.floor(a / 1000) === Math.floor(b / 1000);
  }
  if (LICZBOWE.test(col.DATA_TYPE)) return Number(db) === Number(erp);
  return String(db) === String(erp);
}

const pokaz = v => v === null || v === undefined ? null : v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 19) : String(v);

async function porownaj(pool, surowe) {
  const meta = new Map((await W.schema.fetchColumnsMeta(pool, 'dbo', W.PROD_TABLE,
    (await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='" + W.PROD_TABLE + "'")).recordset.map(r => r.COLUMN_NAME)))
    .found.map(c => [c.COLUMN_NAME, c]));
  const polaListy = Object.keys(surowe.wiersze[0] || {});
  const kolumny = polaListy.filter(f => meta.has(f) && !POMIJAJ.has(f) && !meta.get(f).IS_COMPUTED).map(f => meta.get(f));
  console.log('[przeglad] Porównuję ' + kolumny.length + ' kolumn wspólnych dla listy ERP i csCustomers.');

  const db = new Map();
  const rs = await pool.request().query('SELECT CAST(csCustomersId AS varchar(30)) AS _id, ' +
    kolumny.map(c => '[' + c.COLUMN_NAME + ']').join(', ') + ' FROM dbo.' + W.PROD_TABLE + ' WHERE csCompaniesId = ' + Number(W.COMPANY_ID));
  rs.recordset.forEach(r => db.set(r._id, r));

  const zmiany = [], nowi = [], perPole = {};
  const erpIds = new Set();
  for (const w of surowe.wiersze) {
    const id = String(w.csCustomersId);
    erpIds.add(id);
    const d = db.get(id);
    if (!d) { nowi.push({ csCustomersId: id, CustomerIdent: w.CustomerIdent || '' }); continue; }
    const pola = [];
    for (const c of kolumny) {
      const nowa = erpNaTyp(w[c.COLUMN_NAME], c);
      if (!rowne(d[c.COLUMN_NAME], nowa, c)) {
        pola.push({ pole: c.COLUMN_NAME, baza: pokaz(d[c.COLUMN_NAME]), erp: pokaz(nowa) });
        perPole[c.COLUMN_NAME] = (perPole[c.COLUMN_NAME] || 0) + 1;
      }
    }
    if (pola.length) zmiany.push({ csCustomersId: id, CustomerIdent: w.CustomerIdent || '', pola });
  }
  const usunieci = Array.from(db.keys()).filter(id => !erpIds.has(id));
  return { kolumny, zmiany, nowi, usunieci, perPole };
}

// ---------- Zapis (po akceptacji) ----------

async function zapisz(pool, wynik, surowe) {
  await pool.request().query(`IF OBJECT_ID('dbo.${TABELA_ZMIAN}', 'U') IS NULL
    CREATE TABLE dbo.${TABELA_ZMIAN} (
      Id bigint IDENTITY(1,1) PRIMARY KEY, csCustomersId bigint NOT NULL, Pole nvarchar(128) NOT NULL,
      Stara nvarchar(max) NULL, Nowa nvarchar(max) NULL, Zrodlo nvarchar(50) NOT NULL,
      Wykryto datetime2 NOT NULL, Zapisano datetime2 NOT NULL DEFAULT SYSUTCDATETIME())`);
  const meta = new Map(wynik.kolumny.map(c => [c.COLUMN_NAME, c]));
  const erp = new Map(surowe.wiersze.map(w => [String(w.csCustomersId), w]));
  let ok = 0;
  for (const z of wynik.zmiany) {
    const tx = new W.sql.Transaction(pool);
    await tx.begin();
    try {
      const u = new W.sql.Request(tx);
      u.input('id', W.sql.BigInt, z.csCustomersId);
      const set = z.pola.map((p, i) => {
        const c = meta.get(p.pole);
        u.input('v' + i, W.mssqlType(c), W.wartosc(erp.get(z.csCustomersId)[p.pole], c));
        return '[' + p.pole + '] = @v' + i;
      });
      await u.query('UPDATE dbo.' + W.PROD_TABLE + ' SET ' + set.join(', ') + ' WHERE csCustomersId = @id');
      for (const p of z.pola) {
        await new W.sql.Request(tx)
          .input('id', W.sql.BigInt, z.csCustomersId).input('pole', W.sql.NVarChar(128), p.pole)
          .input('s', W.sql.NVarChar(W.sql.MAX), p.baza).input('n', W.sql.NVarChar(W.sql.MAX), p.erp)
          .input('w', W.sql.DateTime2, new Date(surowe.pobrano))
          .query('INSERT INTO dbo.' + TABELA_ZMIAN + ' (csCustomersId, Pole, Stara, Nowa, Zrodlo, Wykryto) VALUES (@id, @pole, @s, @n, \'przeglad-listy\', @w)');
      }
      await tx.commit();
      ok++;
    } catch (e) {
      await tx.rollback();
      console.error('[przeglad] UPDATE ' + z.csCustomersId + ' nieudany: ' + e.message);
    }
  }
  return ok;
}

// ---------- main ----------

async function main() {
  let surowe;
  if (Z_PLIKU) {
    surowe = JSON.parse(fs.readFileSync(path.resolve(Z_PLIKU), 'utf8'));
    console.log('[przeglad] Z pliku ' + Z_PLIKU + ' (pobrano ' + surowe.pobrano + ').');
  } else {
    W.zajmijErp();
    surowe = await pobierzListe();
  }
  const unikalnych = surowe.wiersze.length;
  const pelny = surowe.stronOk && unikalnych === surowe.erpStart && surowe.erpStart === surowe.erpKoniec;
  console.log('[przeglad] Odczytano ' + unikalnych + ' unikalnych kontrahentów (' + surowe.przeczytanych + ' wierszy, ' +
    surowe.stron + ' stron, ' + surowe.minut + ' min). ERP: ' + surowe.erpStart + ' / ' + surowe.erpKoniec + ' — ' +
    (pelny ? 'KOMPLETNY' : 'NIEPEŁNY'));

  const pool = await W.polacz();
  let wynik, zapisanych = null;
  try {
    wynik = await porownaj(pool, surowe);
    if (ZAPISZ) {
      if (!pelny) throw new Error('Przegląd niepełny — nie zapisuję zmian.');
      zapisanych = await zapisz(pool, wynik, surowe);
    }
  } finally {
    await pool.close();
  }

  const raport = {
    pobrano: surowe.pobrano, pelny, erp: surowe.erpStart, odczytanych: unikalnych, minut: surowe.minut,
    zmienionych: wynik.zmiany.length, nowych: wynik.nowi.length, usunietych: wynik.usunieci.length,
    perPole: wynik.perPole, zapisanych
  };
  fs.writeFileSync(path.join(W.OUT_DIR, 'przeglad-' + DZIS + '.json'),
    JSON.stringify(Object.assign({}, raport, { zmiany: wynik.zmiany, nowi: wynik.nowi, usunieci: wynik.usunieci }), null, 1), 'utf8');
  fs.writeFileSync(path.join(W.OUT_DIR, 'przeglad-nowi-id.txt'), wynik.nowi.map(n => n.csCustomersId).join('\n') + '\n', 'utf8');

  console.log('[przeglad] Zmienionych: ' + raport.zmienionych + ', nowych: ' + raport.nowych + ', usuniętych w ERP: ' + raport.usunietych +
    (zapisanych !== null ? ', zaktualizowanych w bazie: ' + zapisanych : ' (podgląd — baza bez zmian)'));
  console.log('[przeglad] Zmiany per pole: ' + Object.entries(wynik.perPole).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(', '));

  // Do repo tylko liczby (repo jest de facto publiczne).
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(raport, null, 1) + '\n', 'utf8');
  fs.appendFileSync(RUN_LOG, JSON.stringify(Object.assign({ typ: 'przeglad', ts: new Date().toISOString(), tryb: ZAPISZ ? 'zapis' : 'podglad' }, raport)) + '\n', 'utf8');
  if (!Z_PLIKU && !process.argv.includes('--bez-push')) pushLogs('kontrahenci', 'przegląd ' + (ZAPISZ ? 'z zapisem' : 'podgląd'));
  if (!pelny) process.exitCode = 2;
}

main().catch(err => { console.error('[przeglad] BŁĄD:', err.message); process.exit(1); });
