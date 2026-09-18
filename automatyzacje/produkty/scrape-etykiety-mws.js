// Scrapuje z ERP dwa atrybuty potrzebne do custom_label_3 suplementarnego
// feedu GMC: "Produkt delikatny" (isGentle, karta → Dane dodatkowe) i "Typ
// lokalizacji MWS" (StorageLocationType, zakładka "Atrybuty MWS" — Lech nie
// ma do niej dostępu w UI, ale API karty (csitems) zwraca pole niezależnie
// od widoczności zakładki, sprawdzone na SKU 0019010 → "Chlodnia-rolne").
//
// Źródło listy produktów: feed GMC (lib/gmc-feed.js) — ma tylko csItemsId
// (<g:id>) i EAN (<g:mpn>), NIE ma SKU. Dlatego zamiast wyszukiwać w
// katalogu po SKU (jak scrape.js), wyszukujemy PO EAN — dokładnie tą samą
// dwustopniową logiką dopasowania wiersza co EAN_TOOL w
// savpol-historia-faktur.user.js (pickRowByEan), przeniesioną tu do
// Playwrighta. Gdy EAN trafia niejednoznacznie (kilka kartotek podstawowych
// pod tym samym kodem), NIE zgadujemy po cichu — pozycja dostaje status do
// sprawdzenia ręcznego, tak samo jak przy dopasowaniu po nazwie w EAN_TOOL.
//
// Produkty z listy id już obecnych w dotychczasowym suplementarnym feedzie
// (Lech ma dla nich ustalone, że nie należą do żadnej z 3 kategorii) są
// pomijane — nie ma sensu ich scrapować drugi raz.
//
// Sesja przeglądarki jest JEDNA na cały przebieg (logowanie raz), jak w
// scrape-sekwencyjnie.js — stąd "kilkanaście minut" mieści dziesiątki
// produktów bez odtwarzania sesji za każdym razem.
//
// Stan (processedIds/notFoundIds) w state/etykiety-mws.json pozwala uruchamiać
// skrypt wielokrotnie bez scrapowania tych samych id drugi raz. Każdy
// przebieg zapisuje OSOBNY, ponumerowany CSV w wynik/etykiety-mws/ — numer
// rośnie w stanie, nie jest liczony z listingu plików.
//
// Uruchomienie:
//   node scrape-etykiety-mws.js [ile=10] [--suplementarny="C:\...\plik.csv"]
//   node scrape-etykiety-mws.js 10 --suplementarny="C:\Users\l.dudkiewicz\Downloads\suplementarny feed GMC - Arkusz1.csv"

const path = require('path');
const fs = require('fs');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const { login, CATALOG_URL, HEADLESS, decodeJsonResult, extractCardRecord, closeProductCardInPage } = require('./scrape');
const { pobierzListeGmc } = require('./lib/gmc-feed');
const { loadState, saveState, appendRunLog, nastepnyNumerRunu, OUT_DIR } = require('./lib/state-etykiety');

const CARD_MIN_FIELDS = 150; // patrz scrape.js — odróżnia rekord karty od rekordu siatki

const DOMYSLNY_SUPLEMENTARNY = 'C:\\Users\\l.dudkiewicz\\Downloads\\suplementarny feed GMC - Arkusz1.csv';

// ---------- Suplementarny feed: id-y do pominięcia ----------

function wczytajPomijaneId(sciezka) {
  if (!sciezka || !fs.existsSync(sciezka)) {
    console.warn('[suplementarny] Nie znaleziono pliku: ' + sciezka + ' — nic nie pomijam.');
    return new Set();
  }
  const tresc = fs.readFileSync(sciezka, 'utf8');
  const linie = tresc.split(/\r?\n/).filter(Boolean);
  const idy = new Set();
  for (let i = 1; i < linie.length; i++) { // linia 0 = nagłówek
    const id = linie[i].split(',')[0].trim();
    if (id) idy.add(id);
  }
  return idy;
}

// ---------- Wyszukanie w katalogu po EAN + wybór wiersza (port z EAN_TOOL) ----------

async function openCardByEanInPage(opts) {
  const { ean } = opts;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, tries = 60, interval = 250) {
    for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(interval); }
    return null;
  }

  const AUX_CARD_SUFFIX = /-[A-Z]$/i;

  function visiblePanels() {
    return Array.from(document.querySelectorAll('.csDBEditSearch'))
      .filter(w => w.offsetParent !== null);
  }
  function catalogSearchInput() {
    const w = visiblePanels()[0];
    return w ? w.querySelector('input.Input') : null;
  }
  function visibleCatalogGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .find(t => t.offsetParent !== null && t.querySelector('td[data-datafield="Item"]')) || null;
  }
  function catalogRows() {
    const grid = visibleCatalogGrid();
    return grid ? Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row')) : [];
  }
  function readMainCellText(cell) {
    if (!cell) return '';
    const main = cell.querySelector('.csDBTextBlock:not(.cs-style-label)');
    if (main) return main.textContent.trim();
    return (cell.getAttribute('title') || cell.textContent || '').trim();
  }
  function readField(row, field) {
    return readMainCellText(row.querySelector('td[data-datafield="' + field + '"]'));
  }
  function readCaption(descCell) {
    const label = descCell ? descCell.querySelector('.cs-style-label') : null;
    return label ? label.textContent.trim() : '';
  }
  function hasCaption(row) {
    return !!readCaption(row.querySelector('td[data-datafield="ItemDesc"]'));
  }

  function pickRowByEan() {
    const rows = catalogRows();
    if (!rows.length) return { row: null, status: 'nie znaleziono EAN w katalogu' };

    const pickBase = (candidates, status) => {
      const noSuffix = candidates.filter(r => !AUX_CARD_SUFFIX.test(readField(r, 'Item')));
      const pool = noSuffix.length ? noSuffix : candidates;
      const plain = pool.filter(r => !hasCaption(r));
      if (plain.length === 1) return { row: plain[0], status };
      if (plain.length > 1) {
        const skus = Array.from(new Set(plain.map(r => readField(r, 'Item'))));
        if (skus.length > 1) {
          return { row: plain[0], status: 'kilka produktów pod tym EAN (' + skus.join(', ') + ') — sprawdź' };
        }
        return { row: plain[0], status };
      }
      return { row: pool[0], status: 'tylko kartoteki dodatkowe — sprawdź' };
    };

    const exact = rows.filter(r => readField(r, 'EAN') === ean);
    if (exact.length) return pickBase(exact, 'ok');
    return pickBase(rows, 'dopasowane przez wyszukiwarkę ERP (kolumna EAN w siatce to kod op. sprzedażowego)');
  }

  // --- Wyszukanie ---
  const input = await waitFor(catalogSearchInput);
  if (!input) return { ok: false, blad: 'nie znalazłem pola wyszukiwania katalogu' };

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(input, ean);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
  await sleep(600);
  await waitFor(() => catalogRows().length > 0, 20, 250);

  const wybor = pickRowByEan();
  if (!wybor.row) {
    return { ok: false, blad: wybor.status };
  }

  const row = wybor.row;
  const sku = readField(row, 'Item');

  const descCell = row.querySelector('td[data-datafield="ItemDesc"]') || row.querySelector('td[data-datafield="Item"]');
  if (descCell) descCell.click();
  await sleep(300);

  const editBtn = Array.from(document.querySelectorAll('[title="Edycja"]'))
    .find(b => b.offsetParent !== null);
  if (!editBtn) return { ok: false, blad: 'nie widzę przycisku „Edycja"' };
  editBtn.click();

  const karta = await waitFor(() =>
    document.querySelector('.csDBEditForm.csItemsOneBro') ||
    document.querySelector('.csDictBaseForm.csItemsOneBro') ||
    Array.from(document.querySelectorAll('li.k-item[aria-controls]')).some(li => /csItemsOneBro_\d+/i.test(li.id || '')),
    60, 500);

  return { ok: true, kartaWidoczna: !!karta, sku, statusDopasowania: wybor.status };
}

function pickCardRecordById(captured, csItemsId) {
  let best = null;
  for (const c of captured) {
    if (c.fieldNames.length < CARD_MIN_FIELDS) continue;
    const rec = c.records.find(r => String(r.csItemsId) === String(csItemsId));
    if (!rec) continue;
    if (!best || c.fieldNames.length > best.fieldNames.length) best = { rekord: rec, fieldNames: c.fieldNames };
  }
  return best;
}

// ---------- Reguła custom_label_3 ----------

function ustalCustomLabel3(rekord) {
  const isGentle = rekord.isGentle;
  // Dopasowanie idzie po polu BEZ polskich znaków (StorageLocationType,
  // np. "Chlodnia-rolne") — Desc_PL ("Chłodnia rolne") ma "ł"/"ź", więc
  // prosty regex /chlodni/i by go nie złapał. Desc_PL zostaje tylko do
  // wyświetlenia w kolumnie storageLocationType.
  const storageRaw = rekord.StorageLocationType || '';
  const storage = rekord.StorageLocationTypeDesc_PL || rekord.StorageLocationType || '';
  const kruchy = isGentle === 1 || isGentle === '1' || isGentle === true;
  const chlodnia = /chlodni/i.test(storageRaw);
  const mroznia = /mrozni/i.test(storageRaw);

  const kandydaci = [];
  if (kruchy) kandydaci.push('kruche');
  if (chlodnia) kandydaci.push('chlodnia');
  if (mroznia) kandydaci.push('mroznia');

  if (kandydaci.length === 0) return { label: '', status: 'żadna kategoria (sucha, niekruchy)', isGentle, storage };
  if (kandydaci.length === 1) return { label: kandydaci[0], status: 'ok', isGentle, storage };
  return {
    label: kandydaci[0],
    status: 'KILKA PASUJĄCYCH KATEGORII (' + kandydaci.join(', ') + ') — sprawdź ręcznie',
    isGentle, storage
  };
}

// ---------- CSV ----------

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Format wyj\u015Bciowy narzucony przez Lecha (2026-09-15, skorygowany
// 2026-09-15): TYLKO te 4 kolumny, custom_label_1/2 zawsze puste (rezerwacja
// miejsca pod przysz\u0142e warto\u015Bci \u2014 tak trzyma si\u0119 zgodno\u015B\u0107 z dotychczasowym
// suplementarnym feedem, kt\u00F3ry ma tam realne dane dla INNYCH produkt\u00F3w).
// Klucz to GMC id (csItemsId) \u2014 TA SAMA warto\u015B\u0107 co w kolumnie "id"
// dotychczasowego suplementarnego feedu, \u017Ceby da\u0142o si\u0119 scali\u0107 po tej samej
// kolumnie. Surowe dane robocze (EAN, SKU, nazwa, status do sprawdzenia)
// zostaj\u0105 tylko w konsoli/logu przebiegu, nie trafiaj\u0105 do tego pliku.
const NAGLOWEK_CSV = ['id', 'custom_label_1', 'custom_label_2', 'custom_label_3'];

function utworzCsvRunu(numerRunu) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const nazwaPliku = 'etykiety-run-' + String(numerRunu).padStart(3, '0') + '.csv';
  const sciezka = path.join(OUT_DIR, nazwaPliku);
  fs.writeFileSync(sciezka, '\uFEFF' + NAGLOWEK_CSV.join(',') + '\n', 'utf8');
  return sciezka;
}

// Dopisanie JEDNEGO wiersza od razu po zescrapowaniu produktu \u2014 nie
// czekamy do ko\u0144ca sesji. Padni\u0119cie procesu w \u015Brodku (crash, zawieszony
// ERP, zerwane po\u0142\u0105czenie) kosztuje wtedy najwy\u017Cej ten jeden produkt, nie
// ca\u0142\u0105, kilkunastominutow\u0105 sesj\u0119 \u2014 ta sama zasada co w
// scrape-sekwencyjnie.js (patrz jego komentarz przy saveState).
function dopiszWiersz(sciezkaCsv, wiersz) {
  fs.appendFileSync(sciezkaCsv, [wiersz.id, '', '', wiersz.custom_label_3].map(escCsv).join(',') + '\n', 'utf8');
}

// ---------- Główny przebieg ----------

async function scrapeJedenProdukt(page, captured, wpis) {
  captured.length = 0;
  const wynik = await page.evaluate(openCardByEanInPage, { ean: wpis.ean });
  if (!wynik.ok) {
    console.warn('[produkt] id=' + wpis.id + ' EAN=' + wpis.ean + ': ' + wynik.blad);
    return { ok: false, blad: wynik.blad };
  }

  let trafienie = null;
  for (let i = 0; i < 60 && !trafienie; i++) {
    trafienie = pickCardRecordById(captured, wpis.id);
    if (!trafienie) await page.waitForTimeout(300);
  }

  if (!trafienie) {
    console.warn('[produkt] id=' + wpis.id + ' SKU=' + wynik.sku + ': nie przechwyciłem odpowiedzi karty (csItemsId nie zgadza się z wynikiem API — sprawdź czy to na pewno ten wiersz).');
    await page.evaluate(closeProductCardInPage);
    return { ok: false, blad: 'brak przechwyconej odpowiedzi API dla csItemsId=' + wpis.id };
  }

  const etykieta = ustalCustomLabel3(trafienie.rekord);
  const wiersz = {
    id: wpis.id,
    ean: wpis.ean,
    sku: wynik.sku,
    nazwa: wpis.title || trafienie.rekord.ItemDesc || '',
    isGentle: etykieta.isGentle,
    storageLocationType: etykieta.storage,
    custom_label_3: etykieta.label,
    status: wynik.statusDopasowania === 'ok' ? etykieta.status : (wynik.statusDopasowania + ' | ' + etykieta.status)
  };

  const zamkniecie = await page.evaluate(closeProductCardInPage);
  if (!zamkniecie.ok) console.warn('[produkt] id=' + wpis.id + ': ' + zamkniecie.blad);

  return { ok: true, wiersz };
}

async function main() {
  const args = process.argv.slice(2);
  const iloscArg = args.find(a => !a.startsWith('--'));
  const minutyArg = args.find(a => a.startsWith('--minuty='));
  const minutyLimit = minutyArg ? parseFloat(minutyArg.slice('--minuty='.length)) : null;
  // Gdy podano limit czasu, a nie podano liczby — bierzemy z zapasem (sesja
  // i tak skończy się po czasie, limit liczby jest tylko górnym sufitem).
  const ileZescrapowac = iloscArg ? parseInt(iloscArg, 10) : (minutyLimit ? 100000 : 10);
  const deadline = minutyLimit ? Date.now() + minutyLimit * 60000 : null;
  const suplArg = args.find(a => a.startsWith('--suplementarny='));
  const sciezkaSuplementarna = suplArg ? suplArg.slice('--suplementarny='.length).replace(/^"|"$/g, '') : DOMYSLNY_SUPLEMENTARNY;

  console.log('[start] Pobieram feed GMC...');
  const { wpisy, lacznieWFeedzie, bezMpn } = await pobierzListeGmc();
  console.log('[start] Feed GMC: ' + lacznieWFeedzie + ' pozycji, ' + wpisy.length + ' z EAN-em (' + bezMpn + ' bez EAN — pominięte).');

  const pomijaneId = wczytajPomijaneId(sciezkaSuplementarna);
  console.log('[start] Suplementarny feed: ' + pomijaneId.size + ' id do pominięcia (już ustalone, żadna z 3 kategorii).');

  const state = loadState();
  const jużZrobione = new Set(state.processedIds.concat(state.notFoundIds));

  const doZrobienia = wpisy.filter(w => !pomijaneId.has(w.id) && !jużZrobione.has(w.id)).slice(0, ileZescrapowac);
  if (!doZrobienia.length) {
    console.log('[koniec] Brak nowych id do scrapowania (wszystko już zrobione albo pominięte).');
    return;
  }
  console.log('[start] Do zescrapowania w tym przebiegu: ' + doZrobienia.length + ' (cel: ' + ileZescrapowac + ').');

  const runStarted = Date.now();
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
    } catch (e) { /* nieczytelne — pomijamy */ }
  });

  const numerRunu = nastepnyNumerRunu();
  const sciezkaCsv = utworzCsvRunu(numerRunu);
  // Rezerwujemy numer runu OD RAZU (nie na końcu) — kolejne uruchomienie
  // (np. następna sesja orkiestracji) ma już następny wolny numer, nawet
  // gdyby ten proces padł zaraz po starcie.
  saveState({ runNumber: numerRunu });

  const zebrane = [];
  let liczbaNieznalezionych = 0;
  let bladKoncowy = null;

  try {
    await login(page);
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
    console.log('[katalog] Załadowany. Zapis na bieżąco do: ' + sciezkaCsv);

    for (const wpis of doZrobienia) {
      if (deadline && Date.now() >= deadline) {
        console.log('[sesja] Limit czasu (' + minutyLimit + ' min) osiągnięty — kończę sesję.');
        break;
      }
      const czasStart = Date.now();
      const wynik = await scrapeJedenProdukt(page, captured, wpis);
      const czasS = ((Date.now() - czasStart) / 1000).toFixed(1);
      if (wynik.ok) {
        zebrane.push(wynik.wiersz);
        dopiszWiersz(sciezkaCsv, wynik.wiersz);
        saveState({ newProcessedIds: [wpis.id] });
        console.log('[produkt] id=' + wpis.id + ' SKU=' + wynik.wiersz.sku + ' → custom_label_3="' +
          wynik.wiersz.custom_label_3 + '" (' + wynik.wiersz.status + ') — ' + czasS + ' s. ' +
          'Zebrano ' + zebrane.length + ' w tej sesji.');
      } else {
        liczbaNieznalezionych++;
        saveState({ newNotFoundIds: [wpis.id] });
        console.log('[produkt] id=' + wpis.id + ': pominięty (' + wynik.blad + ') — ' + czasS + ' s.');
      }
    }
  } catch (err) {
    bladKoncowy = err.message;
    throw err;
  } finally {
    const czasCalyMs = Date.now() - runStarted;
    const podsumowanie = {
      numerRunu,
      celIlosc: ileZescrapowac,
      doZrobieniaWTymPrzebiegu: doZrobienia.length,
      zebraneWTymPrzebiegu: zebrane.length,
      nieznalezioneWTymPrzebiegu: liczbaNieznalezionych,
      czasCalyMs,
      sredniCzasNaProduktMs: doZrobienia.length ? Math.round(czasCalyMs / doZrobienia.length) : null,
      plikCsv: sciezkaCsv,
      blad: bladKoncowy
    };
    // Stan produktów jest już zapisany na bieżąco (patrz saveState w pętli
    // wyżej) — tu dopisujemy tylko podsumowanie przebiegu do dziennika.
    appendRunLog(podsumowanie);
    saveState({ runSummary: Object.assign({ ts: new Date().toISOString() }, podsumowanie) });
    await browser.close();

    console.log('\n[koniec] Zebrano ' + zebrane.length + '/' + doZrobienia.length +
      ' (' + liczbaNieznalezionych + ' nie znaleziono) w ' + (czasCalyMs / 1000).toFixed(1) + ' s.');
    if (sciezkaCsv) console.log('[koniec] Zapisano: ' + sciezkaCsv);
    // "żadna kategoria" to normalny, częsty wynik (większość towarów jest
    // sucha i niekrucha) — nie wart wypisywania. Flagujemy tylko naprawdę
    // niepewne przypadki: kilka pasujących kategorii naraz albo dopasowanie
    // EAN przez zapasową ścieżkę wyszukiwarki (kolumna EAN ≠ EAN kartoteki).
    const doSprawdzenia = zebrane.filter(w => /sprawdź|KILKA/i.test(w.status));
    if (doSprawdzenia.length) {
      console.log('[koniec] UWAGA — ' + doSprawdzenia.length + ' pozycji do ręcznego sprawdzenia:');
      doSprawdzenia.forEach(w => console.log('  id=' + w.id + ' SKU=' + w.sku + ': ' + w.status));
    }
  }
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
