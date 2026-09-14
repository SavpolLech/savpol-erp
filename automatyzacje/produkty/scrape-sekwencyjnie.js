// Sekwencyjne scrapowanie produktów: zamiast podawać konkretne SKU (jak
// scrape.js), sam generuje kolejne numery SKU w górę od ostatniego
// przetworzonego (albo od punktu startowego podanego przez Michała) i
// scrapuje je jeden po drugim, w JEDNEJ sesji przeglądarki.
//
// SKU w ERP to 7-cyfrowe numery z zerami wiodącymi (np. "0033223"), rosnące,
// ale NIE każdy kolejny numer musi istnieć w katalogu (dziury w numeracji) —
// numer, którego nie znaleziono, jest pomijany i zapamiętany, żeby nie
// próbować go drugi raz.
//
// Stan (które SKU już zebrane / których nie znaleziono) i dziennik przebiegów
// — ta sama logika co automatyzacje/wz (lib/state.js), patrz komentarz tam.
//
// Uruchomienie:
//   node scrape-sekwencyjnie.js [ile] [--start=0033223]
//   node scrape-sekwencyjnie.js 10                 (domyślny start: od stanu, albo 0033223)
//   node scrape-sekwencyjnie.js 10 --start=0040000 (wymuś inny start, ignorując stan)

const path = require('path');
const fs = require('fs');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', 'wz', '.env') });

const { login, CATALOG_URL, HEADLESS, decodeJsonResult, extractCardRecord, scrapeOneProduct } = require('./scrape');
const { loadState, saveState, appendRunLog } = require('./lib/state');

// Punkt startowy od Michała (2026-09-14): "Ostatni SKU produktu w bazie
// danych to 0033222 [...] startując od 0033223".
const DOMYSLNY_START = '0033223';
const DLUGOSC_SKU = 7;
// Bezpiecznik: ile numerów maksymalnie sprawdzić (znalezionych + dziur),
// żeby długi ciąg dziur w numeracji nie zapętlił skryptu w nieskończoność.
const MAX_PROB_NA_PRZEBIEG = 500;

function formatujSku(n) {
  return String(n).padStart(DLUGOSC_SKU, '0');
}

function main() {
  const args = process.argv.slice(2);
  const startArg = args.find(a => a.startsWith('--start='));
  const iloscArg = args.find(a => !a.startsWith('--'));
  const ileZescrapowac = iloscArg ? parseInt(iloscArg, 10) : 10;

  const state = loadState();
  const przetworzoneNumery = state.processedSkus.concat(state.notFoundSkus).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  let nastepnyNumer;
  if (startArg) {
    nastepnyNumer = parseInt(startArg.slice('--start='.length), 10);
  } else if (przetworzoneNumery.length) {
    nastepnyNumer = Math.max(...przetworzoneNumery) + 1;
  } else {
    nastepnyNumer = parseInt(DOMYSLNY_START, 10);
  }

  return uruchom(nastepnyNumer, ileZescrapowac);
}

async function uruchom(startNumer, ileZescrapowac) {
  const runStarted = Date.now();
  console.log('[start] Sekwencyjne scrapowanie od SKU ' + formatujSku(startNumer) +
    ', cel: ' + ileZescrapowac + ' produktów' + (HEADLESS ? ' (headless)' : ' (widoczna przeglądarka)') + '.');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  const captured = [];
  page.on('response', async (resp) => {
    try {
      if (resp.request().method() !== 'POST') return;
      const ct = (resp.headers()['content-type'] || '');
      if (ct && !/json|text/i.test(ct)) return;
      const body = await resp.text();
      if (!body || body.indexOf('JSONResult') === -1) return;
      const decoded = decodeJsonResult(body);
      if (!decoded) return;
      const rec = extractCardRecord(decoded);
      if (rec && rec.records.length) captured.push(rec);
    } catch (e) { /* odpowiedź nieczytelna/binarna — pomijamy */ }
  });

  const noweZebrane = [];
  const noweNieznalezione = [];
  let bladKoncowy = null;
  let numer = startNumer;
  let prob = 0;

  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    console.log('[katalog] Załadowany.');

    while (noweZebrane.length < ileZescrapowac && prob < MAX_PROB_NA_PRZEBIEG) {
      const sku = formatujSku(numer);
      prob++;
      const czasStart = Date.now();
      const ok = await scrapeOneProduct(page, captured, sku);
      const czasMs = Date.now() - czasStart;
      if (ok) {
        noweZebrane.push(sku);
        console.log('[sekwencja] ' + sku + ': OK (' + (czasMs / 1000).toFixed(1) + ' s). ' +
          'Zebrano ' + noweZebrane.length + '/' + ileZescrapowac + '.');
      } else {
        noweNieznalezione.push(sku);
        console.log('[sekwencja] ' + sku + ': brak w katalogu — pomijam (' + (czasMs / 1000).toFixed(1) + ' s).');
      }
      // Zapis stanu OD RAZU po każdym SKU — padnięcie procesu w środku
      // kosztuje najwyżej ten jeden numer, nie cały przebieg.
      saveState({ newProcessedSkus: noweZebrane, newNotFoundSkus: noweNieznalezione });
      numer++;
    }

    if (prob >= MAX_PROB_NA_PRZEBIEG && noweZebrane.length < ileZescrapowac) {
      console.warn('[sekwencja] UWAGA: osiągnięto limit ' + MAX_PROB_NA_PRZEBIEG +
        ' sprawdzonych numerów, a cel (' + ileZescrapowac + ') nie został osiągnięty — ' +
        'bardzo długa dziura w numeracji SKU albo coś innego nie działa. Sprawdź ręcznie.');
    }
  } catch (err) {
    bladKoncowy = err.message;
    throw err;
  } finally {
    const czasCalyMs = Date.now() - runStarted;
    const podsumowanie = {
      tryb: 'sekwencyjnie',
      startSku: formatujSku(startNumer),
      celIlosc: ileZescrapowac,
      zebraneWTymPrzebiegu: noweZebrane.length,
      nieznalezioneWTymPrzebiegu: noweNieznalezione.length,
      sprawdzoneNumery: prob,
      ostatniSprawdzonySku: formatujSku(numer - 1),
      czasCalyMs,
      sredniCzasNaProduktMs: prob ? Math.round(czasCalyMs / prob) : null,
      blad: bladKoncowy
    };
    appendRunLog(podsumowanie);
    // Dopisz podsumowanie przebiegu też do stanu (tak jak w WZ — runs[] w
    // pliku stanu obok run-log.jsonl), nawet jeśli nic nowego nie zebrano.
    saveState({ runSummary: Object.assign({ ts: new Date().toISOString() }, podsumowanie) });
    await browser.close();
  }

  const czasCalyS = ((Date.now() - runStarted) / 1000).toFixed(1);
  console.log('\n[koniec] Zebrano ' + noweZebrane.length + ' produktów (' + noweNieznalezione.length +
    ' numerów bez produktu, ' + prob + ' sprawdzonych łącznie) w ' + czasCalyS + ' s' +
    (noweZebrane.length ? ' (' + (czasCalyS / noweZebrane.length).toFixed(1) + ' s/produkt średnio)' : '') + '.');
  console.log('[koniec] Stan zapisany w ' + require('./lib/state').STATE_FILE + ', log w ' + require('./lib/state').RUN_LOG_PATH + '.');
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
