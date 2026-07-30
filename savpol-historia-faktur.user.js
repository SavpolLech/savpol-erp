// ==UserScript==
// @name         Savpol ERP -> Historia faktur produktu (CSV)
// @namespace    savpol-erp-tools
// @version      1.9
// @description  Pobiera historię faktur (Wszystkie, od 1 stycznia 2024) dla wybranego produktu, z obsługą paginacji, analizuje co-occurrence i eksportuje kandydatów do cross-sellingu do CSV
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
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
    MIN_COUNT: 3,       // minimalna liczba wspólnych faktur (chroni przy małym N)
    // 25% okazało się nieosiągalne przy szerokim asortymencie: na 100 fakturach
    // anchor 0022850 miał 408 różnych partnerów i mediana 9 pozycji na fakturze,
    // więc próg przepuszczał tylko jeden uniwersalny surowiec (cukier).
    MIN_SHARE: 10,      // minimalny udział procentowy
    TOP_N: 4,           // ile kandydatów w finalnej liście

    // Maksymalna gramatura opakowania (kg lub L) dopuszczalna w sprzedaży
    // wysyłkowej. Worki 25kg to czyste B2B; 10kg (np. cukier puder) jeszcze ujdzie.
    MAX_PACK_KG: 10,

    // Max 1 produkt na "rodzinę" (pierwszy znaczący wyraz nazwy), żeby lista
    // nie wyglądała jak jedna rekomendacja powtórzona trzy razy
    // (cukier kryształ + puder + wanilinowy).
    ONE_PER_FAMILY: true
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
    // NIEAKTYWNE: grupa nie jest dostępna w widoku historii faktur, tylko
    // w katalogu produktów. Aktywuje się po dopisaniu odczytu katalogu
    // (patrz CROSS-SELL.md, roadmapa krok 1-2).
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
      'jajow',      // masa jajowa pasteryzowana
      'twarog',     // nadzienie twarogowe / prod. twarogowy (odmiana bez "ó")
      'serow',      // nadzienia i produkty cukiernicze serowe (Sermiks, Sernik Wiedeński, ProSer)

      // Rdzeń "śmietan-" łapie wszystkie zaobserwowane formy: Śmietana, Śmietanka,
      // "Śmietano pod. Kremówka", Śmietankowa. Wyjątki to produkty shelf-stable,
      // które tylko mają śmietankę w nazwie smaku.
      { frag: 'śmietan', unless: ['aromat', 'budyń', 'fix', 'proszk'] }
    ],

    // Nazwa MUSI się zaczynać od podanego fragmentu.
    prefix: [
      'wafel'       // wafle, rożki, kubki lodowe (MIRAN, GRODCONO, NOWE MIRAN...)
    ],

    // Wszystkie fragmenty z grupy muszą wystąpić w nazwie (dowolna kolejność).
    // Chroni drożdże suche/instant przed przypadkowym wykluczeniem.
    allOf: [
      ['drożdż', 'śwież'],
      ['drożdż', 'płynn'],
      ['drożdż', 'przemysłow'],
      // Mleko UHT (bag in box i kartony) = chłodnia. Warunek na "uht" chroni
      // mleko w proszku i skondensowane, które zostają w rankingu.
      ['mleko', 'uht']
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

  // Grupa produktu z siatki katalogu przychodzi zawinięta w komórce — bywa
  // rozbita na wiele linii, a nazwa liścia potrafi się powtórzyć pod ścieżką.
  // Dlatego przed dopasowaniem sklejamy białe znaki.
  function normalizeGroupPath(group) {
    return (group || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pl-PL');
  }

  // Dopasowanie po prefiksie: grupa nadrzędna łapie wszystkie podgrupy.
  // Zwraca dopasowany prefiks albo null.
  function findGroupExclusion(group) {
    const path = normalizeGroupPath(group);
    if (!path) return null;
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
    const name = (productName || '').toLocaleLowerCase('pl-PL');
    if (!name) return null;

    for (const rule of EXCLUSIONS.substring) {
      const frag = (typeof rule === 'string' ? rule : rule.frag).toLocaleLowerCase('pl-PL');
      if (!name.includes(frag)) continue;
      const unless = (typeof rule === 'string' ? [] : rule.unless || []);
      if (unless.some(ex => name.includes(ex.toLocaleLowerCase('pl-PL')))) continue;
      return `substring:${frag}`;
    }

    for (const frag of EXCLUSIONS.prefix) {
      if (name.startsWith(frag.toLocaleLowerCase('pl-PL'))) return `prefix:${frag}`;
    }

    for (const group of EXCLUSIONS.allOf) {
      if (group.every(frag => name.includes(frag.toLocaleLowerCase('pl-PL')))) {
        return `allOf:${group.join('+')}`;
      }
    }

    for (const word of EXCLUSIONS.words) {
      const w = word.toLocaleLowerCase('pl-PL');
      if (!wordRegex(w).test(name)) continue;
      const exceptions = EXCLUSIONS.wordExceptions[word] || [];
      const excused = exceptions.some(ex => name.includes(ex.toLocaleLowerCase('pl-PL')));
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
    const tokens = (productName || '')
      .toLocaleLowerCase('pl-PL')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    for (const t of tokens) {
      if (t.length < 3) continue;
      if (FAMILY_STOPWORDS.includes(t)) continue;
      if (/^\d+$/.test(t)) continue;
      return t;
    }
    return (productName || '').toLocaleLowerCase('pl-PL');
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
      weakSignal: finalList.length === 0,
      ranked,           // pełny ranking po wykluczeniach (debug)
      excluded,         // co i przez którą regułę wypadło (debug)
      droppedByFamily   // odrzucone jako duplikat rodziny (debug)
    };
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

      if (EXPORT_RAW_HISTORY) {
        downloadCSV(data, mainSku);
        await sleep(300); // przeglądarki gubią drugi download bez odstępu
      }

      downloadCrossSellCSV(analysis);

      button.textContent = analysis.weakSignal
        ? `Sygnał zbyt słaby (N=${analysis.N})`
        : `Gotowe: ${analysis.candidates.length} kandydatów (N=${analysis.N})`;
      await sleep(2000);

      // Zamknij zakładkę zestawienia
      const summaryCloseBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (summaryCloseBtn) {
        await sleep(300);
        summaryCloseBtn.click();
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