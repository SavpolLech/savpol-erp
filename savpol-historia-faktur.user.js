// ==UserScript==
// @name         Savpol ERP -> Historia faktur produktu (CSV)
// @namespace    savpol-erp-tools
// @version      2.4
// @description  Pobiera historię faktur (Wszystkie, od 1 stycznia 2024) dla wybranego produktu, z obsługą paginacji, analizuje co-occurrence i eksportuje kandydatów do cross-sellingu do CSV
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Savpol Historia Faktur] Skrypt załadowany. URL:', location.href);

  const TARGET_URL_FRAGMENT = 'erp.savpol.pl/pl/katalog/csitems/';
  const BUTTON_ID = 'savpol-invoice-history-btn';

  // ---------- Konfiguracja ----------
  const MAX_INVOICES = 100;                       // limit pobieranych faktur
  const HISTORY_START_DATE = new Date(2024, 0, 1); // od stycznia 2024
  const MAX_PAGES = 50;                            // zabezpieczenie przed nieskończoną pętlą paginacji

  const EXPORT_RAW_HISTORY = true;                 // dodatkowy CSV z pełną historią (debug reguł)

  // ---------- Konfiguracja analizy cross-sell ----------
  const CROSS_SELL = {
    // MIN_COUNT jest głównym progiem, MIN_SHARE tylko podłogą przy małym N.
    //
    // Dlaczego nie odwrotnie: koncentracja koszyka zależy od roli produktu.
    // Krem pistacjowy ma lidera 41% (wąskie zastosowanie), orzech laskowy
    // tylko 11% (wsad do wielu receptur, sygnał się rozprasza). Sztywny próg
    // procentowy nie może obsłużyć obu — 25% dawało 1 kandydata, 10% dawało
    // 2 dla orzecha i 4 dla kremu. Liczba wspólnych faktur jest stabilniejsza.
    MIN_COUNT: 4,
    MIN_SHARE: 5,       // podłoga szumu; przy N<80 zaczyna wiązać mocniej niż MIN_COUNT
    TOP_N: 4,           // ile kandydatów w finalnej liście

    // Maksymalna gramatura opakowania (kg lub L) dopuszczalna w sprzedaży
    // wysyłkowej. Worki 25kg to czyste B2B; 10kg (np. cukier puder) jeszcze ujdzie.
    MAX_PACK_KG: 10,

    // Max 1 produkt na "rodzinę" (pierwszy znaczący wyraz nazwy), żeby lista
    // nie wyglądała jak jedna rekomendacja powtórzona trzy razy
    // (cukier kryształ + puder + wanilinowy).
    ONE_PER_FAMILY: true
  };

  // ---------- Konfiguracja: filtr dostępności katalogowej (Zadanie 2) ----------
  // Odczyt na żywo, bez cache — stan magazynowy zmienia się codziennie.
  const AVAILABILITY = {
    ENABLE: true,             // wyłącznik całej funkcji; false = zachowanie identyczne z v1.9
    REJECT_LOW_ROTATING: true // "Towar nisko rotujący" -> odrzuć (decyzja właściciela produktu)
  };

  // ---------- Konfiguracja: wykluczenie po grupie katalogowej (Zadanie 3) ----------
  // Grupa jest dostępna tylko przez ten sam odczyt katalogu co filtr dostępności
  // (Zadanie 2), więc realnie działa tylko, gdy AVAILABILITY.ENABLE = true.
  const GROUP_FILTER = {
    ENABLE: true // wyłącznik; false = grupa nie wpływa na wynik (zachowanie sprzed Zadania 3)
  };

  // ---------- Konfiguracja: cache kategorii/gramatury (Zadanie 4) ----------
  // Kategoria i gramatura są stabilne w czasie, więc nadają się do trwałego
  // cache w GM storage (przetrwa reload strony i restart przeglądarki).
  // Stan magazynowy (DYS., podpis "nisko rotujący") zmienia się codziennie
  // i NIE jest tu cachowany — patrz applyAvailabilityFilter(), zawsze
  // odczyt na żywo z katalogu.
  //
  // Cache jest NARASTAJĄCY: zapisujemy tylko kandydatów faktycznie
  // sprawdzonych w danym uruchomieniu — bez zrzutu całego katalogu.
  const CATALOG_CACHE = {
    ENABLE: true, // wyłącznik; false = brak odczytu/zapisu cache (zachowanie sprzed Zadania 4)
    KEY: 'savpol_catcache_v1' // jeden klucz GM; wartość to { [sku]: { group, packKg, ts } }
  };

  // Wyrazy pomijane przy ustalaniu rodziny produktu — nie niosą kategorii.
  const FAMILY_STOPWORDS = ['bt', 'mini', 'nowe', 'op', 'opak', 'do', 'na', 'z', 'w', 'i', 'ze'];

  // Lista wykluczeń jest ŚWIADOMIE otwarta — dopisuj kolejne pozycje
  // (produkty wycofane, sezonowe, z długim lead-time itp.).
  //
  // ERP nie udostępnia przy produkcie informacji o sposobie przechowywania,
  // więc kategoria jest zgadywana z nazwy. Tam gdzie nazwa nie wystarcza,
  // używaj list skuDeny/skuAllow — decyzja per SKU zawsze wygrywa z heurystyką.
  const EXCLUSIONS = {
    // ---- Grupy produktów z ERP (kolumna "GRUPA PRODUKTU" w katalogu) ----
    //
    // UWAGA: te grupy zawierają NAJWIĘCEJ produktów niewysyłkowych, ale nie
    // wyłącznie takie. Odrzucenie całej grupy odcina też pozycje, które wysłać
    // można — znane przypadki opisane w CROSS-SELL.md. Wyjątki dopisuj do
    // skuAllow, które wygrywa z tą listą.
    //
    // Dopasowanie po PREFIKSIE ścieżki, więc "B2B\Kategorie\Nabiał" łapie także
    // wszystkie podgrupy poniżej, a "...\Lodziarskie produkty\Wafle" tylko ten liść.
    //
    // AKTYWNE od Zadania 3 — grupa jest odczytywana live z katalogu w tym samym
    // kroku co filtr dostępności (Zadanie 2), patrz applyAvailabilityFilter().
    groupDeny: [
      'B2B\\Kategorie\\Dekorowanie\\Dekoracje cukrowe',
      'B2B\\Kategorie\\Dekorowanie\\Dekoracje marcepanowe',
      'B2B\\Kategorie\\Dekorowanie\\Dekoracje opłatkowe',
      'B2B\\Kategorie\\Nabiał',
      'B2B\\Kategorie\\Lodziarskie produkty\\Wafle',
      'B2B\\Kategorie\\Dodatki spożywcze\\Drożdże',
      'B2B\\Kategorie\\Pieczywo, ciasta',
      'B2B\\Kategorie\\Mięso, wędliny, ryby',
      'B2B\\Kategorie\\Gastronomiczne produkty\\Farsze'
    ],

    // Wyjątki podkategorii — wygrywają z groupDeny, gdy ścieżka produktu jest
    // dłuższym/bardziej szczegółowym prefiksem niż wpis na denyliście.
    // Zmierzone na anchorach 0022850/0031629 (Zadanie 3): "Dekoracje cukrowe"
    // łapało też suche, wysyłkowe posypki (np. 0012535 Mini pianki), więc ta
    // podgałąź jest jawnie wypuszczona, reszta grupy zostaje zablokowana.
    groupAllow: [
      'B2B\\Kategorie\\Dekorowanie\\Dekoracje cukrowe\\Posypki'
    ],

    // Zawsze wykluczaj te SKU (chłodnia/mrożonka/wycofane, czego nazwa nie zdradza).
    // Format: '0005261': 'Serowe prod. Wykwintny — chłodnia'
    skuDeny: {},

    // Nigdy nie wykluczaj tych SKU — ratunek na fałszywe trafienia reguł.
    // Wygrywa z regułami nazwowymi ORAZ z progiem gramatury.
    skuAllow: {},

    // Dopasowanie po fragmencie nazwy (gdziekolwiek), case-insensitive.
    // Zamiast samego stringa można podać { frag, unless: [...] } — wtedy trafienie
    // jest anulowane, jeśli nazwa zawiera któryś z fragmentów `unless`.
    substring: [
      'margaryn',   // margaryny profesjonalne (Palma BIELMAR, MILENA, Esperto ALFAPRO...)
      'mrożon',     // mrożona / mrożony / mrożone / mrożonka / mrożonek
      'croissant',  // ciasta gotowe — mrożone, ale "mrożon" nie występuje w nazwie

      // Dostawcy mrożonego pieczywa. Wykluczenie po marce, bo asortyment jest
      // szeroki i nazwy typu produktu nie mają wspólnego rdzenia: croissanty,
      // blaty z ciasta francuskiego, rogaliki, precle, ciabatty, briosze, muffiny.
      // Reguła na typ produktu wymagałaby dopisywania pozycji bez końca.
      'vandemoortele',
      'europastry',
      'panesco',

      'jajow',      // masa jajowa pasteryzowana

      // Jaja gotowane OVOVITA (w zalewie / wiaderko) = chłodnia.
      // Wyjątek na "proszk" chroni "Jaja kurze w proszku worek 10kg - OVOPOL",
      // które są shelf-stable — analogicznie do mleka w proszku.
      { frag: 'jaja', unless: ['proszk'] },

      'twarog',     // nadzienie twarogowe / prod. twarogowy (odmiana bez "ó")
      'serow',      // nadzienia i produkty cukiernicze serowe (Sermiks, Sernik Wiedeński, ProSer)
      'serek',      // serek kremowy/homogenizowany — nabiał świeży, "ser" po granicy słowa go nie łapie

      // Rdzeń "śmietan-" łapie wszystkie zaobserwowane formy: Śmietana, Śmietanka,
      // "Śmietano pod. Kremówka", Śmietankowa. Wyjątki to produkty shelf-stable,
      // które tylko mają śmietankę w nazwie smaku.
      { frag: 'śmietan', unless: ['aromat', 'budyń', 'fix', 'proszk'] }
    ],

    // Nazwa MUSI się zaczynać od podanego fragmentu.
    prefix: [
      // Potrzebne OBA rdzenie: "wafel" (l. poj.) i "wafl-" (l. mnoga, "Wafle
      // płaskie... HANMART"). Żaden nie jest prefiksem drugiego — "wafl" nie
      // pasuje do "wafel", bo między "waf" i "l" stoi "e".
      'wafel',      // Wafel Stożek, Wafel Rożek, Wafel Gigante
      'wafl'        // Wafle płaskie, Wafli...
    ],

    // Wszystkie fragmenty z grupy muszą wystąpić w nazwie (dowolna kolejność).
    // Chroni drożdże suche/instant przed przypadkowym wykluczeniem.
    allOf: [
      ['drożdż', 'śwież'],
      ['drożdż', 'płynn'],
      ['drożdż', 'przemysłow'],
      // Mleko UHT (bag in box i kartony) = chłodnia. Warunek na "uht" chroni
      // mleko w proszku i skondensowane, które zostają w rankingu.
      ['mleko', 'uht'],
      // Kremy roślinne do bicia (Decor Up) = chłodnia. Warunek na "roślinn"
      // jest konieczny — samo "krem" wyrzuciłoby połowę asortymentu
      // (kremy pistacjowe, orzechowe, budyniowe), w tym typowe anchory.
      ['krem', 'roślinn'],
      // Białko płynne pasteryzowane (BALTICOVO) = chłodnia, ta sama półka
      // co masa jajowa. Warunek na "płynn" chroni białko w proszku i albuminę.
      // UWAGA: wywnioskowane z decyzji o masie jajowej i jajach gotowanych,
      // nie potwierdzone wprost — patrz CROSS-SELL.md.
      ['białko', 'płynn']
    ],

    // Dopasowanie na granicy słowa — "ser" nie łapie "deser"/"serwetki".
    words: [
      'mascarpone', 'twaróg', 'jogurt', 'żółtko', 'ser', 'masło',
      'boczek', 'salami', 'kebab', 'parówki', 'wędlina', 'kiełbasa'
    ],

    // Wyjątki: jeśli nazwa pasuje do reguły z `words`, ale zawiera któryś
    // z tych fragmentów — NIE wykluczamy.
    wordExceptions: {
      // masło kakaowe oraz pasty/polewy o smaku masła solonego = shelf-stable
      'masło': ['kakaowe', 'delipasta', 'polewa']
    }
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fn, tries = 40, interval = 250) {
    for (let i = 0; i < tries; i++) {
      const val = fn();
      if (val) return val;
      await sleep(interval);
    }
    return null;
  }

  // ---------- Krok 0: otwórz "Historia produktu" ----------
  function openHistory() {
    const el = document.querySelector('[title="Historia produktu"]');
    if (el) { el.click(); return true; }
    return false;
  }

  // ---------- SKU głównego produktu (z inputa "Produkt" w filtrach) ----------
  function getMainProductSku() {
    const panels = Array.from(document.querySelectorAll('.cs-layout-search-panel'))
      .filter(el => el.offsetParent !== null);
    for (const panel of panels) {
      const input = panel.querySelector('input[placeholder="Produkt"]');
      if (input) {
        const sku = input.getAttribute('title') || input.value;
        if (sku) return sku.trim();
      }
    }
    return null;
  }

  // ---------- Krok 1: znajdź panel filtrów (odporne na duplikaty) ----------
  function findFilterPanel() {
    const panels = Array.from(document.querySelectorAll('.cs-layout-search-panel'))
      .filter(el => el.offsetParent !== null);
    for (const panel of panels) {
      const dateInput = panel.querySelector('input[placeholder="Od"]');
      const allLabel = Array.from(panel.querySelectorAll('.csDBRadioGroupItemLabel'))
        .find(l => l.textContent.trim() === 'Wszystkie');
      if (dateInput && allLabel) {
        return { panel, dateInput, allLabel };
      }
    }
    return null;
  }

  async function setFilters() {
    const found = await waitFor(findFilterPanel);
    if (!found) throw new Error('Nie znaleziono panelu z filtrami daty i radio.');

    const { dateInput, allLabel } = found;

    const dp = unsafeWindow.jQuery(dateInput).data('kendoDatePicker');
    if (!dp) throw new Error('Brak instancji kendoDatePicker.');

    dp.value(HISTORY_START_DATE);
    dp.trigger('change');
    unsafeWindow.jQuery(dateInput).trigger('blur');
    await sleep(300);

    allLabel.click();

    // Czekaj aż lista faktycznie się odświeży (zamiast sztywnego sleep)
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
        .filter(row => row.offsetParent !== null);
      return rows.length > 0;
    }, 40, 300);

    await sleep(500); // dodatkowy zapas na pełne wyrenderowanie
  }

  // ---------- Krok 2: iteracja po fakturach FA ----------
  function visibleGridRows() {
    return Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
      .filter(row => row.offsetParent !== null);
  }

  function getVisibleInvoiceGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .find(t => t.offsetParent !== null
        && t.querySelectorAll('tr.cs-grid-data-row').length > 0
        && t.querySelector('td[data-datafield="Item"]')
        && t.querySelector('td[data-datafield="PositionItemDesc"]'));
  }

  function extractInvoiceRows(docNumber) {
    const grid = getVisibleInvoiceGrid();
    if (!grid) return [];
    const rows = Array.from(grid.querySelectorAll('tbody tr'));
    return rows.map(row => {
      const skuCell = row.querySelector('td[data-datafield="Item"]');
      const nameCell = row.querySelector('td[data-datafield="PositionItemDesc"]');
      const qtyCell = row.querySelector('td[data-datafield="QuantityUnits"]');
      if (!skuCell) return null;
      return {
        doc: docNumber,
        sku: skuCell.getAttribute('title') || '',
        product: nameCell ? nameCell.getAttribute('title') : '',
        qty: qtyCell ? qtyCell.getAttribute('title') : ''
      };
    }).filter(Boolean);
  }

  function getActiveTabDocNumber() {
    const el = document.querySelector('li.k-state-active .k-link[title]');
    if (!el) return null;
    const title = el.getAttribute('title');
    const idx = title.indexOf(':');
    return idx >= 0 ? title.slice(idx + 1).trim() : title.trim();
  }

  function getFaRows() {
    return visibleGridRows().filter(row => {
      const cell = row.querySelector('td[data-datafield="DocType"]');
      return cell && cell.getAttribute('title') === 'FA';
    });
  }

  // ---------- Paginacja widoku historii produktu ----------
  // Uwaga: liczniki ".ResultsCountValue" / ".TotalPagesCount" potrafią po zmianie
  // strony pokazywać błędne wartości (zaobserwowany bug interfejsu), dlatego
  // NIE są używane do sterowania pętlą. Zamiast tego opieramy się na stanie
  // przycisku "następna strona" oraz na deduplikacji numerów dokumentów.
  function getVisiblePager() {
    return Array.from(document.querySelectorAll('.csDataPager'))
      .find(el => el.offsetParent !== null) || null;
  }

  function pagerHasNextPage(pager) {
    if (!pager) return false;
    const next = pager.querySelector('.NextPageButton');
    return !!next && !next.className.split(' ').includes('inactive');
  }

  async function goToNextPage(pager) {
    const inputBefore = pager.querySelector('.ActivePageNoInput');
    const beforeVal = inputBefore ? inputBefore.value : null;
    const next = pager.querySelector('.NextPageButton');
    if (!next) return false;
    next.click();

    const changed = await waitFor(() => {
      const p = getVisiblePager();
      const inp = p && p.querySelector('.ActivePageNoInput');
      return inp && inp.value !== beforeVal;
    }, 40, 250);

    await sleep(400); // zapas na pełne wyrenderowanie wierszy nowej strony
    return !!changed;
  }

  async function collectAllInvoices(maxCount, onProgress) {
    const results = [];
    const processedDocs = new Set();
    let invoicesProcessed = 0;
    let pageNum = 1;

    while (invoicesProcessed < maxCount && pageNum <= MAX_PAGES) {

      // Numery dokumentów FA na bieżącej stronie, które jeszcze nie były przetworzone
      const faDocNumbers = getFaRows()
        .map(row => {
          const cell = row.querySelector('td[data-datafield="DocNumber"]');
          return cell ? cell.getAttribute('title') : null;
        })
        .filter(doc => doc && !processedDocs.has(doc));

      if (onProgress) onProgress(`Strona ${pageNum}: ${faDocNumbers.length} nowych faktur FA...`);

      for (const targetDoc of faDocNumbers) {
        if (invoicesProcessed >= maxCount) break;

        // Wiersz pobieramy na nowo za każdym razem (odporność na odświeżenia DOM)
        const row = getFaRows().find(r => {
          const c = r.querySelector('td[data-datafield="DocNumber"]');
          return c && c.getAttribute('title') === targetDoc;
        });
        if (!row) { console.warn('Nie znaleziono wiersza dla', targetDoc); continue; }

        processedDocs.add(targetDoc);

        const docNumberCell = row.querySelector('td[data-datafield="DocNumber"]');
        const btn = docNumberCell.querySelector('.csButtonAction');
        if (!btn) { console.warn('Brak przycisku dla', targetDoc); continue; }

        btn.click();

        const grid = await waitFor(() => getVisibleInvoiceGrid());
        if (!grid) {
          console.error('Nie udało się otworzyć faktury:', targetDoc);
          continue;
        }
        await sleep(300);

        const docNumber = getActiveTabDocNumber() || targetDoc;
        const invoiceRows = extractInvoiceRows(docNumber);
        invoicesProcessed++;

        if (onProgress) onProgress(`[${invoicesProcessed}/${maxCount}] ${docNumber}: ${invoiceRows.length} pozycji`);
        results.push(...invoiceRows);

        const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
        if (closeBtn) closeBtn.click();

        await waitFor(() => visibleGridRows().length > 0);
        await sleep(300);
      }

      if (invoicesProcessed >= maxCount) break;

      // Sprawdź czy jest kolejna strona listy faktur
      const pager = getVisiblePager();
      if (!pagerHasNextPage(pager)) {
        if (onProgress) onProgress(`Brak kolejnych stron. Zebrano ${invoicesProcessed} faktur.`);
        break;
      }

      if (onProgress) onProgress(`Przechodzę do strony ${pageNum + 1}...`);
      const moved = await goToNextPage(pager);
      if (!moved) {
        console.warn('[Savpol Historia Faktur] Nie udało się przejść do kolejnej strony — przerywam.');
        break;
      }
      pageNum++;
    }

    return results;
  }

  // ---------- Krok 3: CSV ----------
  function downloadCSV(data, mainSku) {
    const header = 'Numer dokumentu;Produkt;SKU;Ilość\n';
    const body = data.map(r =>
      `"${r.doc}";"${r.product}";"${r.sku}";"${r.qty}"`
    ).join('\n');
    const csv = header + body;
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historia_faktur_${mainSku || 'produkt'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Krok 4: analiza cross-sell ----------

  // Uwaga: \b w JS działa na ASCII, więc dla "śmietana"/"żółtko"/"masło"
  // granicę słowa budujemy na klasach Unicode (wymaga flagi /u).
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  const wordRegexCache = new Map();
  function wordRegex(word) {
    if (!wordRegexCache.has(word)) {
      wordRegexCache.set(word, new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegex(word)}([^\\p{L}\\p{N}]|$)`, 'u'
      ));
    }
    return wordRegexCache.get(word);
  }

  // Składanie do postaci bez diakrytyków. W nazwach z ERP trafiają się literówki
  // typu "Krem roslinny" (przy poprawnym "śnieżnobiały" w tej samej nazwie),
  // które psują dopasowanie reguł. Dopasowujemy więc obie strony po złożeniu:
  // "roslinn" i "roślinn" trafiają w tę samą regułę.
  //
  // Uwaga: NFD nie rozkłada "ł" — nie ma znaku łączącego, więc wymaga
  // osobnego podstawienia po zmianie na małe litery.
  function fold(text) {
    return (text || '')
      .toLocaleLowerCase('pl-PL')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l');
  }

  // Grupa produktu z siatki katalogu przychodzi zawinięta w komórce — bywa
  // rozbita na wiele linii, a nazwa liścia potrafi się powtórzyć pod ścieżką.
  // Dlatego przed dopasowaniem sklejamy białe znaki.
  function normalizeGroupPath(group) {
    return fold((group || '').replace(/\s+/g, ' ').trim());
  }

  // Dopasowanie po prefiksie: grupa nadrzędna łapie wszystkie podgrupy.
  // Zwraca dopasowany prefiks albo null.
  function findGroupExclusion(group) {
    const path = normalizeGroupPath(group);
    if (!path) return null;
    for (const allowed of EXCLUSIONS.groupAllow) {
      const prefix = normalizeGroupPath(allowed);
      if (!path.startsWith(prefix)) continue;
      const next = path.charAt(prefix.length);
      if (next === '' || next === '\\' || next === ' ') return null; // wyjątek podkategorii wygrywa z denylistą
    }
    for (const denied of EXCLUSIONS.groupDeny) {
      const prefix = normalizeGroupPath(denied);
      if (!path.startsWith(prefix)) continue;
      // Po prefiksie musi stać separator ścieżki, spacja (powtórzona nazwa
      // liścia w zawiniętej komórce) albo koniec — inaczej "Nabiał" złapałby
      // "Nabiałowe zamienniki".
      const next = path.charAt(prefix.length);
      if (next === '' || next === '\\' || next === ' ') return denied;
    }
    return null;
  }

  // Zwraca nazwę dopasowanej reguły (do logu) albo null, jeśli produkt przechodzi.
  function findExclusion(productName) {
    const name = fold(productName);
    if (!name) return null;

    for (const rule of EXCLUSIONS.substring) {
      const frag = fold(typeof rule === 'string' ? rule : rule.frag);
      if (!name.includes(frag)) continue;
      const unless = (typeof rule === 'string' ? [] : rule.unless || []);
      if (unless.some(ex => name.includes(fold(ex)))) continue;
      return `substring:${frag}`;
    }

    for (const frag of EXCLUSIONS.prefix) {
      if (name.startsWith(fold(frag))) return `prefix:${frag}`;
    }

    for (const group of EXCLUSIONS.allOf) {
      if (group.every(frag => name.includes(fold(frag)))) {
        return `allOf:${group.join('+')}`;
      }
    }

    for (const word of EXCLUSIONS.words) {
      const w = fold(word);
      if (!wordRegex(w).test(name)) continue;
      const exceptions = EXCLUSIONS.wordExceptions[word] || [];
      const excused = exceptions.some(ex => name.includes(fold(ex)));
      if (!excused) return `word:${word}`;
    }

    return null;
  }

  // ---------- Gramatura opakowania ----------
  // Z nazwy wyciągamy wszystkie liczby z jednostką masy/objętości i bierzemy
  // największą. Liczby bez jednostki (kody typu "263004", "op. 12 worków")
  // są ignorowane, bo nie opisują opakowania.
  function biggestPackKg(productName) {
    const name = (productName || '').toLocaleLowerCase('pl-PL');
    const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)(?![a-ząćęłńóśźż])/g;
    let max = null, m;
    while ((m = re.exec(name)) !== null) {
      const value = parseFloat(m[1].replace(',', '.'));
      if (!isFinite(value)) continue;
      const unit = m[2];
      const kg = (unit === 'kg' || unit === 'l') ? value : value / 1000;
      if (max === null || kg > max) max = kg;
    }
    return max;
  }

  // Rodzina produktu = pierwszy znaczący wyraz nazwy (cukier, polewa, pojemnik...).
  function familyKey(productName) {
    const tokens = fold(productName)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    for (const t of tokens) {
      if (t.length < 3) continue;
      if (FAMILY_STOPWORDS.includes(t)) continue;
      if (/^\d+$/.test(t)) continue;
      return t;
    }
    return fold(productName);
  }

  function sameSku(a, b) {
    return (a || '').trim().toLocaleLowerCase('pl-PL') === (b || '').trim().toLocaleLowerCase('pl-PL');
  }

  function analyzeCrossSell(rows, anchorSku) {
    // Grupujemy pozycje po numerze faktury.
    const byDoc = new Map();
    for (const r of rows) {
      if (!byDoc.has(r.doc)) byDoc.set(r.doc, []);
      byDoc.get(r.doc).push(r);
    }

    // Krok 1 — N = liczba faktur, w których faktycznie widać anchor.
    const anchorDocs = [];
    for (const [doc, items] of byDoc) {
      if (items.some(it => sameSku(it.sku, anchorSku))) anchorDocs.push(doc);
    }
    const N = anchorDocs.length;

    // Krok 2 — co-occurrence: liczymy FAKTURY, nie pozycje.
    const stats = new Map(); // sku -> { sku, name, count }
    for (const doc of anchorDocs) {
      const seenInDoc = new Set();
      for (const it of byDoc.get(doc)) {
        const sku = (it.sku || '').trim();
        if (!sku || sameSku(sku, anchorSku)) continue;
        const key = sku.toLocaleLowerCase('pl-PL');
        if (seenInDoc.has(key)) continue;
        seenInDoc.add(key);
        if (!stats.has(key)) stats.set(key, { sku, name: it.product || '', count: 0 });
        stats.get(key).count++;
      }
    }

    // Krok 3 — wykluczenia kategorii + gramatury hurtowej.
    const excluded = [];
    const kept = [];
    for (const entry of stats.values()) {
      // Nadpisania per SKU mają pierwszeństwo nad całą heurystyką nazwową.
      const skuKey = (entry.sku || '').trim();
      if (Object.prototype.hasOwnProperty.call(EXCLUSIONS.skuDeny, skuKey)) {
        excluded.push({ ...entry, rule: `skuDeny:${EXCLUSIONS.skuDeny[skuKey] || 'ręcznie'}` });
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(EXCLUSIONS.skuAllow, skuKey)) {
        kept.push(entry);
        continue;
      }

      const rule = findExclusion(entry.name);
      if (rule) { excluded.push({ ...entry, rule }); continue; }

      const packKg = biggestPackKg(entry.name);
      if (packKg !== null && packKg > CROSS_SELL.MAX_PACK_KG) {
        excluded.push({ ...entry, rule: `pack:${packKg}kg` });
        continue;
      }

      kept.push(entry);
    }

    // Krok 4 — próg sygnału.
    const ranked = kept
      .map(e => ({ ...e, share: N > 0 ? (e.count / N) * 100 : 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl-PL'));

    const qualified = ranked.filter(
      e => e.count >= CROSS_SELL.MIN_COUNT && e.share >= CROSS_SELL.MIN_SHARE
    );

    // Krok 5 — max 1 produkt na rodzinę (ranking jest już posortowany malejąco,
    // więc zostaje najmocniejszy przedstawiciel rodziny).
    const droppedByFamily = [];
    let finalList = qualified;
    if (CROSS_SELL.ONE_PER_FAMILY) {
      const seenFamilies = new Set();
      finalList = [];
      for (const e of qualified) {
        const family = familyKey(e.name);
        if (seenFamilies.has(family)) {
          droppedByFamily.push({ ...e, family });
          continue;
        }
        seenFamilies.add(family);
        finalList.push(e);
      }
    }

    return {
      N,
      anchorSku,
      candidates: finalList.slice(0, CROSS_SELL.TOP_N),
      dedupedRanked: finalList, // pula do filtra dostępności (Zadanie 2)
      weakSignal: finalList.length === 0,
      ranked,           // pełny ranking po wykluczeniach (debug)
      excluded,         // co i przez którą regułę wypadło (debug)
      droppedByFamily   // odrzucone jako duplikat rodziny (debug)
    };
  }

  // ---------- Krok 4b: filtr dostępności w katalogu (bez cache — stan zmienia się codziennie) ----------

  // SKU z dopiskiem po numerze (np. "0022850-R", "0022850-M") to osobna kartoteka
  // tego samego produktu, prowadzona pod inny kanał obrotu (nie online).
  // Odrzucamy zawsze, niezależnie od stanu i podpisu — decyzja właściciela produktu.
  function isAuxiliaryKartoteka(sku) {
    return /-[A-Za-z]/.test((sku || '').trim());
  }

  function findVisibleCatalogSearchInput() {
    const widget = Array.from(document.querySelectorAll('.csDBEditSearch'))
      .find(w => w.offsetParent !== null);
    return widget ? widget.querySelector('input.Input') : null;
  }

  function getVisibleCatalogGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .find(t => t.offsetParent !== null
        && t.querySelector('td[data-datafield="Item"]')
        && t.querySelector('td[data-datafield="QStockAv"]'));
  }

  // Pole "Szukaj" w katalogu NIE jest widgetem Kendo (w przeciwieństwie do
  // kendoDatePicker w setFilters()) — wystarczą natywne zdarzenia.
  async function searchCatalog(query) {
    const input = await waitFor(findVisibleCatalogSearchInput);
    if (!input) throw new Error('Nie znaleziono pola wyszukiwania katalogu.');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }));
    await sleep(400);
    await waitFor(() => getVisibleCatalogGrid() !== null, 40, 250);
    await sleep(400);
  }

  // Atrybut title komórki GRUPA PRODUKTU zawiera tylko liść ścieżki — pełna
  // ścieżka jest w treści pierwszego div.csDBTextBlock (patrz Zadanie 1).
  function readGroupPath(cell) {
    if (!cell) return '';
    const main = cell.querySelector('.csDBTextBlock:not(.cs-style-label)');
    return main ? main.textContent.trim() : cell.textContent.trim();
  }

  // Podpis pod nazwą produktu ("Market", "Towar nisko rotujący") to drugi
  // div.csDBTextBlock.cs-style-label w komórce OPIS.
  function readCaption(descCell) {
    const label = descCell ? descCell.querySelector('.cs-style-label') : null;
    return label ? label.textContent.trim() : '';
  }

  async function lookupCatalogItem(sku) {
    await searchCatalog(sku);
    const grid = getVisibleCatalogGrid();
    if (!grid) return null;
    const rows = Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row'));
    const row = rows.find(r => {
      const c = r.querySelector('td[data-datafield="Item"]');
      return c && c.getAttribute('title') === sku;
    });
    if (!row) return null;

    const dysCell = row.querySelector('td[data-datafield="QStockAv"]');
    const groupCell = row.querySelector('td[data-datafield="ItemsGroupTranslatedDesc"]');
    const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
    const dysText = dysCell ? (dysCell.getAttribute('title') || '') : '';
    const dys = parseFloat(dysText.replace(/\s/g, '').replace(',', '.')) || 0;

    return { sku, dys, group: readGroupPath(groupCell), caption: readCaption(descCell) };
  }

  function findTabLiByText(text) {
    return Array.from(document.querySelectorAll('li.k-item'))
      .filter(li => li.offsetParent !== null)
      .find(li => li.textContent.includes(text)) || null;
  }

  async function switchToCatalogTab() {
    const tab = findTabLiByText('Katalog');
    if (!tab) return false;
    (tab.querySelector('span.k-link') || tab).click();
    await waitFor(() => getVisibleCatalogGrid() !== null || findVisibleCatalogSearchInput() !== null, 20, 200);
    await sleep(300);
    return true;
  }

  // ---------- Cache kategorii/gramatury (Zadanie 4, GM_setValue/GM_getValue) ----------
  function loadCatalogCache() {
    if (!CATALOG_CACHE.ENABLE) return {};
    try {
      return GM_getValue(CATALOG_CACHE.KEY, {}) || {};
    } catch (err) {
      console.warn('[Cross-sell] Nie udało się odczytać cache kategorii/gramatury:', err);
      return {};
    }
  }

  function saveCatalogCache(cache) {
    if (!CATALOG_CACHE.ENABLE) return;
    try {
      GM_setValue(CATALOG_CACHE.KEY, cache);
    } catch (err) {
      console.warn('[Cross-sell] Nie udało się zapisać cache kategorii/gramatury:', err);
    }
  }

  // Zapisuje/aktualizuje wpis dla jednego SKU. Wołane tylko dla kandydatów,
  // których faktycznie sprawdziliśmy w katalogu (cache narastający, Zadanie 4).
  function rememberCatalogInfo(cache, sku, group, packKg) {
    const key = (sku || '').trim();
    if (!key) return;
    cache[key] = { group: group || '', packKg: (packKg === null || packKg === undefined) ? null : packKg, ts: Date.now() };
  }

  // Przechodzi po pełnym (zdeduplikowanym po rodzinie) rankingu i dobiera
  // kolejnych kandydatów z rankingu, gdy poprzedni odpada na dostępności.
  async function applyAvailabilityFilter(dedupedRanked, topN, onProgress) {
    const kept = [];
    const rejected = [];
    const groupsSeen = new Set();
    const cache = loadCatalogCache();
    let cacheUpdates = 0;
    for (const entry of dedupedRanked) {
      if (kept.length >= topN) break;

      if (isAuxiliaryKartoteka(entry.sku)) {
        rejected.push({ ...entry, reason: 'kartoteka pomocnicza (sufiks SKU)' });
        continue;
      }

      if (onProgress) onProgress(`Sprawdzam dostępność: ${entry.sku}...`);
      const info = await lookupCatalogItem(entry.sku);
      if (!info) {
        rejected.push({ ...entry, reason: 'nie znaleziono w katalogu' });
        continue;
      }

      if (info.group) groupsSeen.add(info.group);

      // Cache narastający (Zadanie 4): kategoria i gramatura są stabilne, więc
      // zapisujemy je dla każdego sprawdzonego kandydata. Stanu magazynowego
      // (DYS., podpis) NIE zapisujemy — patrz komentarz przy CATALOG_CACHE.
      if (CATALOG_CACHE.ENABLE) {
        rememberCatalogInfo(cache, entry.sku, info.group, biggestPackKg(entry.name));
        cacheUpdates++;
        saveCatalogCache(cache);
      }

      // Grupa katalogowa (Zadanie 3) — wygrywa z regułami nazwowymi, ale
      // skuAllow wygrywa z grupą (ratunek na fałszywe trafienia denylisty grup).
      const skuKey = (entry.sku || '').trim();
      const hasSkuAllow = Object.prototype.hasOwnProperty.call(EXCLUSIONS.skuAllow, skuKey);
      if (GROUP_FILTER.ENABLE && !hasSkuAllow) {
        const groupRule = findGroupExclusion(info.group);
        if (groupRule) {
          rejected.push({ ...entry, group: info.group, reason: `grupa:${groupRule}` });
          continue;
        }
      }

      if (AVAILABILITY.REJECT_LOW_ROTATING && info.caption === 'Towar nisko rotujący') {
        rejected.push({ ...entry, reason: 'Towar nisko rotujący' });
        continue;
      }
      if (info.dys <= 0) {
        rejected.push({ ...entry, reason: `brak stanu (DYS.=${info.dys})` });
        continue;
      }

      kept.push({ ...entry, dys: info.dys, group: info.group, caption: info.caption });
    }
    return { kept, rejected, groupsSeen: Array.from(groupsSeen), cacheUpdates, cacheSize: Object.keys(cache).length };
  }

  function logAvailability(avail) {
    console.log(`[Cross-sell] Filtr dostępności — zaakceptowani (${avail.kept.length}):`);
    console.table(avail.kept.map(e => ({ nazwa: e.name, SKU: e.sku, DYS: e.dys, grupa: e.group || '' })));
    if (avail.rejected.length) {
      console.log(`[Cross-sell] Filtr dostępności — odrzuceni (${avail.rejected.length}):`);
      console.table(avail.rejected.map(e => ({ nazwa: e.name, SKU: e.sku, powód: e.reason })));
    }
    if (avail.groupsSeen && avail.groupsSeen.length) {
      const unlisted = avail.groupsSeen.filter(g => !findGroupExclusion(g));
      if (unlisted.length) {
        console.log('[Cross-sell] Grupy wśród sprawdzanych kandydatów spoza denylisty (sprawdź, czy nie brakuje gałęzi):');
        console.table(unlisted.map(g => ({ grupa: g })));
      }
    }
    if (CATALOG_CACHE.ENABLE && avail.cacheUpdates !== undefined) {
      console.log(`[Cross-sell] Cache kategorii/gramatury (GM storage): ${avail.cacheUpdates} zapisanych/odświeżonych w tym uruchomieniu, ${avail.cacheSize} łącznie.`);
    }
  }

  function formatShare(share) {
    return share.toFixed(1).replace('.', ',');
  }

  function downloadCrossSellCSV(result) {
    const header = 'nazwa;kod_SKU;liczba_wystapien;udzial_procent\n';
    let body;

    if (result.weakSignal) {
      // Pusta lista + jawna flaga, zamiast wymuszania słabych kandydatów.
      body = `"sygnał zbyt słaby";"";"0";"0,0"`;
    } else {
      body = result.candidates.map(c =>
        `"${c.name}";"${c.sku}";"${c.count}";"${formatShare(c.share)}"`
      ).join('\n');
    }

    const csv = header + body + '\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cross_sell_${result.anchorSku || 'produkt'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function logAnalysis(result) {
    console.log(`[Cross-sell] Anchor: ${result.anchorSku}, N = ${result.N} faktur`);
    console.log(`[Cross-sell] Ranking po wykluczeniach (${result.ranked.length}):`);
    console.table(result.ranked.map(e => ({
      nazwa: e.name, SKU: e.sku, wystąpienia: e.count, udział: formatShare(e.share) + '%'
    })));
    if (result.excluded.length) {
      console.log(`[Cross-sell] Wykluczone (${result.excluded.length}):`);
      console.table(result.excluded.map(e => ({
        nazwa: e.name, SKU: e.sku, wystąpienia: e.count, reguła: e.rule
      })));
    }
    if (result.droppedByFamily.length) {
      console.log(`[Cross-sell] Odrzucone jako duplikat rodziny (${result.droppedByFamily.length}):`);
      console.table(result.droppedByFamily.map(e => ({
        nazwa: e.name, SKU: e.sku, wystąpienia: e.count, rodzina: e.family
      })));
    }
    if (result.weakSignal) {
      console.warn(`[Cross-sell] Sygnał zbyt słaby — żaden kandydat nie osiągnął ` +
        `${CROSS_SELL.MIN_COUNT} wystąpień i ${CROSS_SELL.MIN_SHARE}% udziału.`);
    }
  }

  // ---------- Główny pipeline ----------
  async function runFullPipeline(button) {
    const originalText = button.textContent;
    try {
      button.textContent = 'Otwieram historię...';
      const opened = openHistory();
      if (!opened) throw new Error('Nie znaleziono przycisku "Historia produktu". Czy produkt jest zaznaczony?');
      await sleep(500);

      const mainSku = await waitFor(getMainProductSku);

      button.textContent = 'Ustawiam filtry...';
      await setFilters();

      button.textContent = 'Pobieram faktury...';
      const data = await collectAllInvoices(MAX_INVOICES, (msg) => {
        button.textContent = msg;
        console.log(msg);
      });

      button.textContent = 'Analizuję cross-sell...';
      const analysis = analyzeCrossSell(data, mainSku);
      logAnalysis(analysis);

      let historyTabLi = null;
      if (AVAILABILITY.ENABLE) {
        historyTabLi = document.querySelector('li.k-state-active'); // zapamiętane PRZED przejściem do katalogu
        button.textContent = 'Sprawdzam dostępność w katalogu...';
        await switchToCatalogTab();
        const avail = await applyAvailabilityFilter(analysis.dedupedRanked, CROSS_SELL.TOP_N, (msg) => { button.textContent = msg; });
        logAvailability(avail);
        analysis.candidates = avail.kept;
        analysis.weakSignal = analysis.weakSignal || avail.kept.length === 0;
      }

      if (EXPORT_RAW_HISTORY) {
        downloadCSV(data, mainSku);
        await sleep(300); // przeglądarki gubią drugi download bez odstępu
      }

      downloadCrossSellCSV(analysis);

      button.textContent = analysis.weakSignal
        ? `Sygnał zbyt słaby (N=${analysis.N})`
        : `Gotowe: ${analysis.candidates.length} kandydatów (N=${analysis.N})`;
      await sleep(2000);

      // Zamknij zakładkę "Historia produktu" — po ewentualnym przełączeniu na katalog
      // (filtr dostępności) aktywna zakładka to już nie ta sama, więc zamykamy
      // po zapamiętanej referencji, nie po klasie .k-state-active.
      if (AVAILABILITY.ENABLE) {
        if (historyTabLi) {
          const closeBtn = historyTabLi.querySelector('.csCloseButton_span');
          if (closeBtn) closeBtn.click();
        }
      } else {
        const summaryCloseBtn = document.querySelector('li.k-state-active .csCloseButton_span');
        if (summaryCloseBtn) {
          await sleep(300);
          summaryCloseBtn.click();
        }
      }

      button.textContent = originalText;
    } catch (err) {
      console.error('[Savpol Historia Faktur] Błąd:', err);
      button.textContent = 'Błąd — zobacz konsolę';
      setTimeout(() => { button.textContent = originalText; }, 3000);
    }
  }

  // ---------- Wstrzyknięcie przycisku ----------
  function getVisibleToolbar() {
    return Array.from(document.querySelectorAll('#ToolBarPanel'))
      .find(t => t.offsetParent !== null);
  }

  function insertButtonIfNeeded() {
    if (!location.href.includes(TARGET_URL_FRAGMENT)) return;
    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + BUTTON_ID)) return;

    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="caption" title="Pobierz historię faktur">Pobierz historię faktur</div>';
    btn.addEventListener('click', () => runFullPipeline(btn));
    toolbar.appendChild(btn);
  }

  setInterval(insertButtonIfNeeded, 1000);

})();
