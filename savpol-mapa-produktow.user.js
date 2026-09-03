// ==UserScript==
// @name         Savpol ERP -> Mapa produktów (waga per grupa klientów)
// @namespace    savpol-erp-tools
// @version      1.4.0
// @description  Przechodzi przefiltrowaną listę dokumentów sprzedaży, otwiera każdą fakturę, zbiera SKU/ilości/netto i buduje listę produktów posortowaną po wadze (częstotliwość x obrót), z medianą i P90 sprzedaży. Wynik do schowka jednym klikiem.
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-mapa-produktow.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-mapa-produktow.user.js
// @match        https://erp.savpol.pl/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      esavpol.pl
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[Savpol Mapa Produktów]';
  console.log(LOG, 'Skrypt załadowany. URL:', location.href);

  // ---------- Konfiguracja ----------

  // Skrypt startuje TYLKO na liście dokumentów sprzedaży. Filtry (daty,
  // kontrahenci) ustawia użytkownik ręcznie przed uruchomieniem — skrypt ich
  // nie dotyka, bo cały sens narzędzia to „policz to, co widzę na ekranie".
  const LIST_URL_FRAGMENT = 'erp.savpol.pl/pl/dokumenty-sprzedazy/csdocsheaders4sales';

  const BUTTON_ID = 'savpol-product-map-btn';
  const BUTTON_TEXT = '📊 Mapa produktów';
  const PANEL_ID = 'savpol-product-map-panel';

  const MAX_INVOICES = 500;              // górny limit faktur w jednym przebiegu
  const MAX_PAGES = 60;                  // zabezpieczenie przed nieskończoną pętlą paginacji
  const MAX_CONSECUTIVE_FAILURES = 3;    // tyle nieudanych otwarć z rzędu kończy zbieranie

  // Typy dokumentów brane do analizy. Korekty (FK) są POMIJANE świadomie:
  // mają ujemne ilości i wykrzywiłyby wagę produktu, którego korekta dotyczy.
  // Zanim się je włączy, trzeba zdecydować, czy odejmują od obrotu, czy liczą
  // się jako osobne wystąpienie produktu.
  const DOC_TYPES = ['FA'];

  // Waga produktu to średnia geometryczna dwóch znormalizowanych składników:
  //   penetracja = na ilu procentach faktur produkt wystąpił
  //   obrót      = suma netto produktu / suma netto największego produktu
  // Iloczyn (a nie suma) jest tu celowy: produkt częsty ale groszowy oraz
  // produkt drogi ale kupiony raz mają OBA dostać niską wagę. Suma dałaby im
  // połowę punktów, iloczyn — prawie zero. Wykładniki przesuwają akcent:
  // podnieś `penetration`, jeśli ważniejsza jest powtarzalność niż pieniądze.
  const WEIGHTS = {
    penetration: 1,
    revenue: 1
  };

  // Kolumna z ceną jednostkową, z której liczy się mediana i P90.
  // „Cena" (CUnitPrice) to cena przed rabatem — tak było w zamówieniu.
  // Jeśli kiedyś potrzebna będzie cena faktycznie zapłacona, jest obok jako
  // „Cena po rabacie" (CUnitPriceADis); na sprawdzanych fakturach rabaty były
  // zerowe, więc obie kolumny dawały to samo.
  const PRICE_FIELD = 'CUnitPrice';

  // Próg wagi dla schowka — wartość STARTOWA. Panel pokazuje WSZYSTKO (żeby
  // było widać, co wypadło i jak blisko progu), ale do arkusza idzie tylko to,
  // co przekroczyło próg — arkusz ma być listą zakupową grupy, nie pełnym
  // spisem magazynu. Po zakończeniu przebiegu próg reguluje się w panelu,
  // bo dopiero na gotowej liście widać, gdzie naprawdę wypada granica.
  const COPY_MIN_WEIGHT = 15;

  // Ręczne odstępstwa od progu, po SKU. Próg jest tylko punktem wyjścia —
  // ostateczną listę składa człowiek klikając wiersze, bo o tym, czy produkt
  // należy do listy grupy, decyduje wiedza o towarze, a nie sama arytmetyka.
  // Dwa zbiory, a nie jeden „wybrane", żeby zmiana progu w kodzie nie
  // unieważniała ręcznych decyzji.
  const manualIn = new Set();
  const manualOut = new Set();

  function isSelected(item) {
    if (manualIn.has(item.sku)) return true;
    if (manualOut.has(item.sku)) return false;
    return item.weight > COPY_MIN_WEIGHT;
  }

  function toggleSelected(item) {
    if (isSelected(item)) {
      manualIn.delete(item.sku);
      if (item.weight > COPY_MIN_WEIGHT) manualOut.add(item.sku);
    } else {
      manualOut.delete(item.sku);
      if (!(item.weight > COPY_MIN_WEIGHT)) manualIn.add(item.sku);
    }
  }

  // ---------- Warunki przewozu (esavpol.pl) ----------
  // ERP nie trzyma informacji o tym, czy towar jedzie w chłodni — to wie sklep.
  // Na karcie produktu ikona siedzi w #c-item-icon-and-title, przed <h1>.
  //
  // UWAGA na kształt tego HTML-a: ikona chłodni jest PLIKIEM
  // (src="/dist/temp-chilled.svg"), ale ikona „temperatura pokojowa" jest
  // WKLEJONA jako data:image/svg+xml — nie ma więc nazwy pliku, po której dałoby
  // się ją poznać. Dlatego głównym sygnałem jest alt/title (opisowy i taki sam
  // w obu wariantach), a nazwa pliku ikony służy jako potwierdzenie.
  // Rozpoznawanie po klasie CSS byłoby najgorsze z trzech — klasy w sklepie
  // się zmieniają.
  const COLD_CHAIN = {
    ENABLE: true,

    // Domyślnie do arkusza idą TYLKO produkty bez chłodni — przełącznik
    // w panelu pozwala skopiować wszystko razem z kolumną warunków.
    ONLY_NON_COLD_DEFAULT: true,

    ORIGIN: 'https://esavpol.pl',
    SEARCH_URL: sku => 'https://esavpol.pl/produkty?searchtext=' + encodeURIComponent(sku),
    PRODUCT_LINK_RE: /^\/[a-z0-9ąćęłńóśźż-]+-\d{6,}$/i,

    // Warianty przewozu. Dopasowanie idzie po alt/title ikony (`alt`) albo po
    // nazwie pliku ikony (`file`) — wystarczy jedno trafienie. Wzorce alt są
    // bez polskich znaków tam, gdzie to możliwe („schlodz" nie złapie
    // „schłodzone"), więc oba warianty pisowni są wypisane osobno.
    // Kolejność ma znaczenie: pierwszy trafiony wariant wygrywa.
    VARIANTS: [
      {
        key: 'frozen', label: 'mroźnia', cold: true,
        alt: ['mroż', 'mroz', 'zamroż', 'zamroz', 'frozen'],
        file: ['temp-frozen', 'temp-freeze']
      },
      {
        key: 'chilled', label: 'chłodnia', cold: true,
        alt: ['schłodz', 'schlodz', 'chłodz', 'chlodz', 'chilled'],
        file: ['temp-chilled', 'temp-cool']
      },
      {
        key: 'ambient', label: 'normalnie', cold: false,
        alt: ['pokojow', 'ambient', 'sucho', 'suchym'],
        file: ['temp-ambient', 'temp-room', 'temp-dry']
      }
    ],

    // Warunki przewozu produktu nie zmieniają się z tygodnia na tydzień, więc
    // raz sprawdzone SKU siedzi w cache — kolejny przebieg na tej samej grupie
    // klientów nie odpytuje sklepu od zera.
    CACHE_KEY: 'savpol_cold_chain_v1',
    CACHE_TTL_DAYS: 60,

    // Sklep dostaje 2 żądania na produkt (szukajka + karta). Przerwa między
    // produktami, żeby kilkaset SKU nie wyglądało jak atak.
    THROTTLE_MS: 200,
    TIMEOUT_MS: 15000
  };

  // Pauzy. ERP renderuje siatki asynchronicznie; bez zapasu po otwarciu
  // zakładki czytaliśmy pustą lub połowicznie wyrenderowaną siatkę.
  const DELAY_AFTER_OPEN = 300;
  const DELAY_AFTER_CLOSE = 300;
  const DELAY_AFTER_PAGE = 400;

  // ---------- Przerwanie ----------

  const ABORT = { requested: false };

  function requestAbort() {
    ABORT.requested = true;
    console.warn(LOG, 'Zażądano przerwania — kończę po bieżącej fakturze.');
  }

  function throwIfAborted() {
    if (ABORT.requested) {
      const e = new Error('ABORTED');
      e.aborted = true;
      throw e;
    }
  }

  // ---------- Narzędzia ----------

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fn, tries = 40, interval = 250) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ERP podaje liczby po polsku („1 580,21", ze spacją nierozdzielającą).
  function parsePl(raw) {
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[\s ]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function formatPl(n, decimals = 2) {
    return n.toFixed(decimals).replace('.', ',');
  }

  // Percentyl z interpolacją liniową (metoda „inclusive", ta sama co
  // PERCENTYL/PERCENTILE w arkuszach) — wyniki będą się zgadzać, jeśli
  // policzysz je potem w Excelu z surowych danych.
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function formatEta(msLeft) {
    const sec = Math.round(msLeft / 1000);
    if (sec < 60) return '~' + sec + ' s';
    const min = Math.round(sec / 60);
    if (min < 60) return '~' + min + ' min';
    const h = Math.floor(min / 60);
    return '~' + h + ' godz. ' + (min % 60) + ' min';
  }

  function formatElapsed(ms) {
    const sec = Math.round(ms / 1000);
    const min = Math.floor(sec / 60);
    return min > 0 ? min + ' min ' + (sec % 60) + ' s' : sec + ' s';
  }

  // ---------- Odczyt DOM ----------

  // KLUCZOWE: obie siatki (lista i pozycje faktury) siedzą w DOM jednocześnie,
  // bo zakładki ERP nie są niszczone przy przełączaniu. Wybór po samym
  // istnieniu selektora czytałby pozycje z poprzedniej, ukrytej zakładki,
  // więc każda siatka musi być filtrowana po widoczności.
  function visibleGrids() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .filter(t => t.offsetParent !== null);
  }

  function getVisibleListGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }

  function getVisiblePositionsGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="PositionItemDesc"]')
      && !t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }

  function getVisibleToolbar() {
    return Array.from(document.querySelectorAll('#ToolBarPanel'))
      .find(t => t.offsetParent !== null) || null;
  }

  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }

  // Typ dokumentu nie jest osobną kolumną — siedzi jako pierwszy pogrubiony
  // div w komórce DocNumber („FA", obok napisu „Faktura sprzedaży").
  function rowDocType(row) {
    const cell = row.querySelector('td[data-datafield="DocNumber"]');
    if (!cell) return null;
    const bold = cell.querySelector('.cs-style-text-bold');
    if (!bold) return null;
    const txt = (bold.textContent || '').trim();
    return /^[A-Z]{2,4}$/.test(txt) ? txt : null;
  }

  function rowDocNumber(row) {
    const cell = row.querySelector('td[data-datafield="DocNumber"]');
    return cell ? cell.getAttribute('title') : null;
  }

  function targetRows() {
    return listRows().filter(r => DOC_TYPES.includes(rowDocType(r)));
  }

  function getActiveTabDocNumber() {
    const el = document.querySelector('li.k-state-active .k-link[title]');
    if (!el) return null;
    const title = el.getAttribute('title') || '';
    const idx = title.indexOf(':');
    return idx >= 0 ? title.slice(idx + 1).trim() : title.trim();
  }

  // SKU nie ma własnej kolumny. Nazwa i SKU dzielą komórkę PositionItemDesc:
  // nazwa to zwykły div (i tylko ona trafia do atrybutu title, przez co jest
  // NIEUCIĘTA — dlatego bierzemy ją stąd, a nie z textContent), SKU to div
  // pogrubiony poniżej.
  function extractPositions(docNumber) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      const descCell = row.querySelector('td[data-datafield="PositionItemDesc"]');
      if (!descCell) return null;
      const skuEl = descCell.querySelector('.cs-style-text-bold');
      const sku = skuEl ? (skuEl.textContent || '').trim() : '';
      if (!sku) return null;
      const title = f => {
        const c = row.querySelector('td[data-datafield="' + f + '"]');
        return c ? (c.getAttribute('title') || '') : '';
      };
      return {
        doc: docNumber,
        sku: sku,
        name: descCell.getAttribute('title') || '',
        unit: title('Unit'),
        qty: parsePl(title('QuantityUnits')),
        net: parsePl(title('CNAmount')),
        price: parsePl(title(PRICE_FIELD))
      };
    }).filter(Boolean);
  }

  // ---------- Paginacja ----------
  // Liczniki pagera w ERP potrafią kłamać w trakcie przeładowania, dlatego
  // pętla opiera się na stanie przycisku „next" i na deduplikacji numerów
  // dokumentów, a nie na „.ResultsCountValue". Licznik rekordów służy WYŁĄCZNIE
  // do paska postępu i szacowania czasu — pomyłka tam nic nie psuje.

  function getVisiblePager() {
    return Array.from(document.querySelectorAll('.csDataPager'))
      .find(el => el.offsetParent !== null) || null;
  }

  function pagerHasNextPage(pager) {
    if (!pager) return false;
    const next = pager.querySelector('.NextPageButton');
    return !!next && !next.className.split(/\s+/).includes('inactive');
  }

  function pagerRecordCount(pager) {
    if (!pager) return null;
    const e = pager.querySelector('.ResultsCountValue');
    if (!e) return null;
    const raw = (e.value || e.textContent || '').replace(/\s/g, '');
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function describePager(pager) {
    if (!pager) return '(brak widocznego pagera)';
    const val = sel => {
      const e = pager.querySelector(sel);
      return e ? (e.value || e.textContent || '').trim() : '?';
    };
    const next = pager.querySelector('.NextPageButton');
    return ['strona=' + val('.ActivePageNoInput'), 'stron=' + val('.TotalPagesCount'),
      'rekordów=' + val('.ResultsCountValue'),
      'nextClass="' + (next ? next.className : 'brak') + '"'].join(' | ');
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
    await sleep(DELAY_AFTER_PAGE);
    if (!changed) {
      console.warn(LOG, 'Numer strony nie zmienił się po kliknięciu. Przed:', beforeVal,
        '| po:', describePager(getVisiblePager()));
    }
    return !!changed;
  }

  // ---------- Zbieranie ----------
  // Przerwanie jest MIĘKKIE: to, co zebrano do tej pory, i tak idzie do wyniku,
  // żeby kilkuminutowy przebieg nie przepadał. Wynik częściowy jest oznaczany
  // w panelu, żeby nie wziąć go potem za pełny obraz.

  async function collectAll(ui) {
    const positions = [];
    const processedDocs = new Set();
    let consecutiveFailures = 0;
    let processed = 0;
    let pageNum = 1;

    const total = pagerRecordCount(getVisiblePager());
    ui.total(total);

    while (processed < MAX_INVOICES && pageNum <= MAX_PAGES) {
      throwIfAborted();

      // Pusta strona to najczęściej „siatka jeszcze się ładuje", nie „brak
      // faktur" — bez tej pauzy przebieg kończył się zerem, mimo że sekundę
      // później dane były na miejscu.
      if (targetRows().length === 0) {
        await waitFor(() => targetRows().length > 0, 20, 300);
      }

      const docsOnPage = targetRows()
        .map(rowDocNumber)
        .filter(doc => doc && !processedDocs.has(doc));

      ui.phase('Strona ' + pageNum + ': ' + docsOnPage.length + ' nowych faktur');

      for (const targetDoc of docsOnPage) {
        throwIfAborted();
        if (processed >= MAX_INVOICES) break;

        // Wiersz pobierany na nowo za każdym razem — siatka bywa
        // przerenderowana po zamknięciu zakładki, a stara referencja
        // wskazywałaby wtedy na element wyrzucony z DOM.
        const row = targetRows().find(r => rowDocNumber(r) === targetDoc);
        if (!row) {
          console.warn(LOG, 'Nie znaleziono wiersza dla', targetDoc);
          continue;
        }

        processedDocs.add(targetDoc);

        const btn = row.querySelector('td[data-datafield="DocNumber"] .csButtonAction');
        if (!btn) {
          // Brak przycisku akcji to zwykle kwestia uprawnień: dokument widać,
          // ale nie wolno go otworzyć.
          console.warn(LOG, 'Brak przycisku akcji dla', targetDoc);
          continue;
        }

        btn.click();

        const grid = await waitFor(() => getVisiblePositionsGrid());
        if (!grid) {
          consecutiveFailures++;
          console.error(LOG, 'Nie udało się otworzyć faktury', targetDoc,
            '(porażka ' + consecutiveFailures + ')');

          // ODZYSKIWANIE. Bez tego jedna nieudana faktura kładła cały przebieg:
          // otwarta zakładka przykrywała listę, więc każdy kolejny dokument
          // kończył się „nie znaleziono wiersza" i wynik był pusty.
          const stray = document.querySelector('li.k-state-active .csCloseButton_span');
          if (stray) stray.click();
          await waitFor(() => getVisibleListGrid());
          await sleep(DELAY_AFTER_CLOSE);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(LOG, consecutiveFailures, 'nieudanych otwarć z rzędu — przerywam.');
            return { positions, invoices: processed, partial: true };
          }
          continue;
        }

        consecutiveFailures = 0;
        await sleep(DELAY_AFTER_OPEN);

        const docNumber = getActiveTabDocNumber() || targetDoc;
        const rows = extractPositions(docNumber);
        processed++;
        positions.push(...rows);

        ui.progress(processed, docNumber + ': ' + rows.length + ' pozycji');

        const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
        if (closeBtn) closeBtn.click();
        await waitFor(() => getVisibleListGrid());
        await sleep(DELAY_AFTER_CLOSE);
      }

      if (processed >= MAX_INVOICES) break;

      const pager = getVisiblePager();
      if (!pagerHasNextPage(pager)) {
        ui.phase('Brak kolejnych stron.');
        break;
      }

      ui.phase('Przechodzę do strony ' + (pageNum + 1) + '...');
      if (!await goToNextPage(pager)) {
        console.warn(LOG, 'Paginacja stanęła. Zebrano', processed, 'faktur. Pager:',
          describePager(getVisiblePager()));
        return { positions, invoices: processed, partial: true };
      }
      pageNum++;
    }

    return { positions, invoices: processed, partial: false };
  }

  // ---------- Agregacja i waga ----------

  function aggregate(positions, invoiceCount) {
    const bySku = new Map();

    for (const p of positions) {
      let e = bySku.get(p.sku);
      if (!e) {
        e = { sku: p.sku, name: p.name, units: new Set(), docs: new Set(),
          qty: 0, net: 0, lines: 0, prices: [] };
        bySku.set(p.sku, e);
      }
      // Nazwa może się różnić między fakturami (zmiana kartoteki w czasie) —
      // zostawiamy najdłuższą, bo krótsza bywa uciętą wersją tej samej.
      if (p.name && p.name.length > (e.name || '').length) e.name = p.name;
      if (p.unit) e.units.add(p.unit);
      e.docs.add(p.doc);
      e.qty += p.qty;
      e.net += p.net;
      e.lines++;
      // Próbka do mediany i P90: CENA JEDNOSTKOWA z jednego wystąpienia
      // produktu na fakturze, jedna obserwacja na pozycję, nieważona ilością.
      // Odpowiada na „po ile zwykle ten produkt schodzi", a nie „ile łącznie
      // za niego zapłacono" — wartość pozycji zależy od wielkości zamówienia
      // i mediana z niej nie mówi nic o cenie.
      e.prices.push(p.price);
    }

    const items = Array.from(bySku.values());
    const maxNet = items.reduce((m, i) => Math.max(m, i.net), 0) || 1;
    const denom = WEIGHTS.penetration + WEIGHTS.revenue;

    for (const i of items) {
      i.invoices = i.docs.size;
      i.penetration = invoiceCount ? i.invoices / invoiceCount : 0;
      i.revenueShare = i.net / maxNet;
      // Ważona średnia geometryczna. Zero w którymkolwiek składniku daje zero —
      // i tak ma być, bo produkt bez obrotu albo bez powtarzalności nie jest
      // częścią „listy, którą bierze ta grupa klientów".
      i.weight = 100 * Math.pow(
        Math.pow(i.penetration, WEIGHTS.penetration) * Math.pow(i.revenueShare, WEIGHTS.revenue),
        1 / denom
      );
      i.unit = Array.from(i.units).join('/');

      const sorted = i.prices.slice().sort((a, b) => a - b);
      i.median = percentile(sorted, 0.5);
      i.p90 = percentile(sorted, 0.9);
    }

    items.sort((a, b) => b.weight - a.weight);
    items.forEach((i, idx) => { i.rank = idx + 1; });
    return items;
  }

  // ---------- Warunki przewozu: cache ----------

  function gmGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* brak storage nie może kłaść przebiegu */ }
  }

  function loadColdCache() {
    const raw = gmGet(COLD_CHAIN.CACHE_KEY, null);
    const cache = (raw && typeof raw === 'object') ? raw : {};
    const maxAge = COLD_CHAIN.CACHE_TTL_DAYS * 86400000;
    const now = Date.now();
    // Wpisy przestarzałe znikają przy wczytaniu, więc plik nie puchnie i nie
    // trzeba nigdzie osobno czyścić.
    for (const sku of Object.keys(cache)) {
      if (!cache[sku] || !cache[sku].ts || now - cache[sku].ts > maxAge) delete cache[sku];
    }
    return cache;
  }

  // ---------- Warunki przewozu: sklep ----------

  // GM_xmlhttpRequest, a nie fetch, bo lecimy z erp.savpol.pl na esavpol.pl —
  // fetch zablokowałby CORS. Wymaga @connect esavpol.pl w nagłówku skryptu.
  function fetchShopText(url) {
    return new Promise(resolve => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        resolve({ ok: false, error: 'brak GM_xmlhttpRequest' });
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: COLD_CHAIN.TIMEOUT_MS,
        onload: r => resolve({ ok: r.status >= 200 && r.status < 400, status: r.status, text: r.responseText || '' }),
        onerror: () => resolve({ ok: false, error: 'błąd sieci' }),
        ontimeout: () => resolve({ ok: false, error: 'timeout' })
      });
    });
  }

  // Adres karty produktu z wyników wyszukiwania. Link poznajemy po kształcie
  // (slug + co najmniej 6 cyfr), a z kandydatów wybieramy ten, który zawiera
  // dokładnie nasze SKU — inaczej 0004714 trafiłoby w 00047140.
  function findProductPath(html, sku) {
    const linkRe = /href="([^"]+)"/ig;
    const paths = new Set();
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1].replace(COLD_CHAIN.ORIGIN, '');
      if (COLD_CHAIN.PRODUCT_LINK_RE.test(href)) paths.add(href);
    }
    const list = Array.from(paths);
    const exact = list.find(h => new RegExp('(^|[^0-9])' + sku + '([^0-9]|$)').test(h));
    return { path: exact || list[0] || null, exact: !!exact, candidates: list.length };
  }

  // Warunki przewozu z HTML karty produktu.
  function readTransportFromHtml(html) {
    // Zakres zawężamy do kontenera z ikoną i tytułem, żeby nie złapać ikony
    // z sekcji „podobne produkty", gdyby taka doszła. Kontener bywa OGROMNY,
    // bo ikona „temperatura pokojowa" jest wklejona jako data:image/svg+xml
    // (kilka kB samej ścieżki), więc zakres domykamy na </h1>, a nie na
    // sztywnej liczbie znaków — inaczej alt wypadałby poza wycinek.
    const idx = html.indexOf('c-item-icon-and-title');
    let scope = html;
    let scoped = false;
    if (idx >= 0) {
      const tail = html.slice(idx);
      const end = tail.indexOf('</h1>');
      scope = end >= 0 ? tail.slice(0, end) : tail.slice(0, 400000);
      scoped = true;
    }

    // Atrybuty każdego <img> w zakresie. Kolejność atrybutów w tagu jest
    // dowolna, więc czytamy je osobno, a nie jednym wzorcem na cały tag.
    const imgs = (scope.match(/<img\b[^>]*>/ig) || []).map(tag => ({
      alt: (tag.match(/\balt="([^"]*)"/i) || [, ''])[1],
      title: (tag.match(/\btitle="([^"]*)"/i) || [, ''])[1],
      // Z data-URI bierzemy tylko początek — reszta to kilka kB ścieżek SVG.
      src: (tag.match(/\bsrc="([^"]*)"/i) || [, ''])[1].slice(0, 200)
    }));

    if (!imgs.length) {
      // Każdy wariant ma jakąś ikonę, także „temperatura pokojowa". Brak
      // obrazka znaczy więc „nie odczytałem strony", a nie „wożone normalnie" —
      // dlatego to NIE jest traktowane jako brak chłodni.
      return { kind: '(brak ikony)', label: 'nie odczytano', cold: false, known: false, scoped: scoped };
    }

    for (const img of imgs) {
      const alt = (img.alt + ' ' + img.title).toLowerCase();
      const src = img.src.toLowerCase();
      for (const v of COLD_CHAIN.VARIANTS) {
        const hitAlt = v.alt.some(k => alt.includes(k));
        const hitFile = v.file.some(k => src.includes(k));
        if (hitAlt || hitFile) {
          return {
            kind: v.key, label: v.label, cold: v.cold, known: true, scoped: scoped,
            evidence: (hitAlt ? 'alt="' + (img.alt || img.title) + '"' : 'plik ikony ' + img.src)
          };
        }
      }
    }

    // Ikona jest, ale nieznana. NIE zgadujemy: produkt dostaje etykietę do
    // ręcznego sprawdzenia i nie jest odsiewany, bo wyrzucenie dobrego produktu
    // jest gorsze od zostawienia jednego do weryfikacji.
    const firstAlt = imgs.map(i => i.alt || i.title).filter(Boolean)[0] || '(bez alt)';
    return {
      kind: 'nieznany', label: 'nieznane: ' + firstAlt, cold: false, known: false,
      scoped: scoped, evidence: 'alt="' + firstAlt + '"'
    };
  }

  async function resolveTransport(sku, cache) {
    if (cache[sku]) return cache[sku];

    const search = await fetchShopText(COLD_CHAIN.SEARCH_URL(sku));
    if (!search.ok) {
      return { label: 'brak danych', cold: false, known: false, error: search.error || ('HTTP ' + search.status) };
    }
    const hit = findProductPath(search.text, sku);
    if (!hit.path) {
      // Zero kandydatów może znaczyć „nie ma w sklepie" ALBO „wyniki dorysowuje
      // JavaScript". Rozróżnia to raport na końcu przebiegu — jeśli ANI JEDEN
      // produkt nie ma linku, to drugie.
      return { label: 'nie ma w sklepie', cold: false, known: false, error: 'brak linku w wynikach' };
    }

    const page = await fetchShopText(COLD_CHAIN.ORIGIN + hit.path);
    if (!page.ok) {
      return { label: 'brak danych', cold: false, known: false, error: page.error || ('HTTP ' + page.status) };
    }

    const t = readTransportFromHtml(page.text);
    const entry = {
      label: t.label, cold: t.cold, known: t.known, kind: t.kind,
      url: COLD_CHAIN.ORIGIN + hit.path, exactSku: hit.exact, ts: Date.now()
    };
    cache[sku] = entry;
    return entry;
  }

  // Sprawdzamy TYLKO produkty nad progiem wagi. Reszta i tak nie trafia do
  // arkusza, a każdy produkt to dwa żądania do sklepu — przy kilkuset SKU
  // różnica jest między minutą a kwadransem.
  async function annotateTransport(items, ui) {
    const cache = loadColdCache();
    // Tylko produkty bez ustalonych warunków. Po obniżeniu progu w panelu
    // dociągane są WYŁĄCZNIE te, które właśnie weszły — reszta ma już flagę
    // i sklep nie jest pytany o nią po raz drugi.
    const todo = copyItems(items).filter(i => !i.transport);
    if (!todo.length) return { checked: 0, failed: 0 };
    const started = Date.now();
    let done = 0;

    ui.phase('Sprawdzam warunki przewozu w sklepie...');
    for (const item of todo) {
      throwIfAborted();
      const fromCache = !!cache[item.sku];
      const t = await resolveTransport(item.sku, cache);
      item.transport = t.label;
      item.cold = !!t.cold;
      item.transportKnown = t.known !== false;
      item.transportUrl = t.url || null;
      done++;

      const elapsed = Date.now() - started;
      ui.bar(done / todo.length);
      ui.counts(done + ' z ' + todo.length + ' produktów',
        done < todo.length ? formatEta((elapsed / done) * (todo.length - done)) + ' do końca' : formatElapsed(elapsed));
      ui.detail(item.sku + ' — ' + item.transport);

      if (!fromCache) await sleep(COLD_CHAIN.THROTTLE_MS);
    }

    gmSet(COLD_CHAIN.CACHE_KEY, cache);

    const failed = todo.filter(i => !i.transportKnown);
    if (failed.length === todo.length && todo.length > 0) {
      console.error(LOG, 'Nie udało się ustalić warunków przewozu dla ŻADNEGO produktu. ' +
        'Najczęstsze przyczyny: brak zgody @connect esavpol.pl w Tampermonkey, ' +
        'wylogowanie ze sklepu albo wyniki wyszukiwania renderowane JavaScriptem ' +
        '(wtedy w surowym HTML nie ma linków i trzeba to robić inaczej).');
    }
    if (failed.length) {
      console.warn(LOG, 'Bez rozpoznanych warunków przewozu: ' +
        failed.map(i => i.sku + ' (' + i.transport + ')').join(', '));
    }
    return { checked: todo.length, failed: failed.length };
  }

  // ---------- Wynik do arkusza ----------

  // Kolumny idą do arkusza, więc liczby są formatowane po polsku (przecinek
  // dziesiętny), a separatorem jest TAB — Excel i Arkusze Google rozkładają
  // taki wklej na kolumny bez żadnego importu.
  //
  // SKU z apostrofem na początku, bo arkusz inaczej czyta „0007719" jako liczbę
  // i gubi wiodące zera, a bez nich numer nie pasuje do niczego w ERP.
  const CLIPBOARD_COLUMNS = [
    ['SKU', i => "'" + i.sku],
    ['Nazwa', i => i.name],
    ['Mediana ceny', i => formatPl(i.median, 2)],
    ['P90 ceny', i => formatPl(i.p90, 2)]
  ];

  // Przy kopiowaniu WSZYSTKIEGO dochodzi kolumna z warunkami przewozu — bez
  // niej nie dałoby się w arkuszu odróżnić chłodni od reszty. W trybie
  // domyślnym (bez chłodni) kolumna jest zbędna, bo wszystkie wiersze mają
  // tę samą wartość, więc wklej zostaje czterokolumnowy.
  const TRANSPORT_COLUMN = ['Przewóz', i => i.transport || ''];

  // Kandydaci do arkusza: zaznaczone wiersze (próg + ręczne poprawki). Ten sam
  // zestaw idzie do sprawdzania w sklepie, więc chłodnia nie jest tu jeszcze
  // brana pod uwagę.
  function copyItems(items) {
    return items.filter(isSelected);
  }

  function clipboardRows(items, onlyNonCold) {
    return copyItems(items).filter(i => !onlyNonCold || !i.cold);
  }

  // Bez wiersza nagłówka: wklej ma trafiać od razu w dane, bo arkusz, do
  // którego to idzie, ma już własne nagłówki. Nazwy kolumn zostają w
  // CLIPBOARD_COLUMNS jako dokumentacja kolejności.
  function buildTsv(items, onlyNonCold) {
    const cols = onlyNonCold ? CLIPBOARD_COLUMNS : CLIPBOARD_COLUMNS.concat([TRANSPORT_COLUMN]);
    return clipboardRows(items, onlyNonCold)
      .map(i => cols.map(c => String(c[1](i))).join('\t'))
      .join('\n');
  }

  // Zapis do schowka odpala się z kliknięcia użytkownika, dlatego
  // navigator.clipboard działa (bez gestu przeglądarka odrzuca zapis).
  // execCommand zostaje jako zapas.
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- Panel postępu i wyniku ----------

  let panel = null;
  let panelKeepAlive = null;

  function createPanel() {
    removePanel();

    const box = document.createElement('div');
    box.id = PANEL_ID;
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
      'width:560px', 'max-width:94vw', 'max-height:82vh', 'box-sizing:border-box',
      'display:flex', 'flex-direction:column',
      'padding:14px 16px', 'background:#1f2933', 'color:#f5f7fa', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
    ].join(';');

    box.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="flex:1;font-size:13px">Mapa produktów</strong>',
      '  <button data-role="stop" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '    padding:2px 8px;border:0;border-radius:4px;background:#5a3a3a;color:#ffd9d4">Przerwij</button>',
      '  <span data-role="close" title="Zamknij panel" style="cursor:pointer;opacity:.6;padding:0 6px;font-size:16px;line-height:1">&times;</span>',
      '</div>',
      '<div data-role="phase" style="margin-bottom:6px;opacity:.85">Startuję...</div>',
      '<div style="height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden">',
      '  <div data-role="bar" style="height:100%;width:0%;background:#4c9aff;transition:width .2s"></div>',
      '</div>',
      '<div style="display:flex;margin-top:6px;font-size:12px;opacity:.75">',
      '  <span data-role="count" style="flex:1"></span>',
      '  <span data-role="time"></span>',
      '</div>',
      '<div data-role="detail" style="margin-top:8px;font-size:12px;opacity:.7;word-break:break-word"></div>',
      // flex-direction i gap są tu, a nie w treści wyniku, bo treść jest
      // przerysowywana po każdej zmianie progu. `min-height:0` pozwala tabeli
      // się skrócić i przewijać, zamiast rozpychać panel poza ekran.
      '<div data-role="resultbox" style="display:none;margin-top:10px;padding-top:10px;',
      '    border-top:1px solid rgba(255,255,255,.15);min-height:0;',
      '    flex-direction:column;gap:8px"></div>'
    ].join('');

    document.body.appendChild(box);
    panel = box;

    // Zakładki ERP potrafią przerenderować drzewo i wyrzucić panel z DOM —
    // wtedy przebieg trwa, ale użytkownik traci z oczu postęp. Ten sam węzeł
    // jest doczepiany ponownie, więc nasłuchy i treść wyniku zostają całe.
    panelKeepAlive = setInterval(() => {
      if (panel && !panel.isConnected) document.body.appendChild(panel);
    }, 1000);

    const el = r => box.querySelector('[data-role="' + r + '"]');
    el('close').addEventListener('click', () => { requestAbort(); removePanel(); });
    el('stop').addEventListener('click', () => {
      requestAbort();
      el('stop').disabled = true;
      el('stop').textContent = 'Przerywam...';
    });

    const started = Date.now();
    let totalCount = null;

    return {
      el: el,
      // Liczba rekordów wg pagera. Może być null (pager zerowany na czas
      // ładowania) — wtedy pasek działa w trybie „nie wiem ile jeszcze".
      total(n) { totalCount = n && n > 0 ? n : null; },
      phase(text) { el('phase').textContent = text; },
      // Sterowanie paskiem wprost — używa go etap sprawdzania sklepu, który ma
      // własny licznik (produkty), inny niż etap zbierania faktur.
      bar(frac) { el('bar').style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; },
      counts(left, right) {
        el('count').textContent = left || '';
        el('time').textContent = right || '';
      },
      detail(text) { el('detail').textContent = text || ''; },
      progress(done, detail) {
        const elapsed = Date.now() - started;
        if (totalCount) {
          const pct = Math.min(100, (done / totalCount) * 100);
          el('bar').style.width = pct + '%';
          el('count').textContent = done + ' z ' + totalCount + ' faktur';
          // Średnia z całego przebiegu, nie z ostatniej faktury — pojedyncza
          // wolna faktura nie ma wtedy rozhuśtać szacunku.
          const perItem = elapsed / done;
          el('time').textContent = done < totalCount
            ? formatEta(perItem * (totalCount - done)) + ' do końca'
            : formatElapsed(elapsed);
        } else {
          el('count').textContent = done + ' faktur';
          el('time').textContent = formatElapsed(elapsed);
        }
        if (detail) el('detail').textContent = detail;
      },
      finish(text, ok) {
        const stop = el('stop');
        if (stop) stop.remove();
        el('phase').textContent = text;
        el('bar').style.width = '100%';
        el('bar').style.background = ok ? '#36b37e' : '#ff5630';
        const elapsed = formatElapsed(Date.now() - started);
        el('time').textContent = elapsed;
        return elapsed;
      }
    };
  }

  function removePanel() {
    if (panelKeepAlive) { clearInterval(panelKeepAlive); panelKeepAlive = null; }
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    panel = null;
  }

  function transportCell(i) {
    if (!i.transport) return '';
    if (i.cold) return '<span style="color:#7cc4ff">' + i.transport + '</span>';
    if (i.transportKnown === false) return '<span style="color:#ffab00">' + i.transport + '</span>';
    return '<span style="opacity:.55">' + i.transport + '</span>';
  }

  // Stan przełącznika chłodni przeżywa przerysowanie panelu (a to następuje po
  // każdej zmianie progu), więc trzyma się poza funkcją rysującą.
  let onlyNonColdState = COLD_CHAIN.ONLY_NON_COLD_DEFAULT;

  // Blokada na czas dociągania danych ze sklepu. Bez niej szybkie klikanie
  // w wiersze odpalałoby kilka nakładających się przebiegów po tych samych SKU.
  let selectionBusy = false;

  function showResults(ui, items, meta) {
    const totalNet = items.reduce((s, i) => s + i.net, 0);
    const hasTransport = items.some(i => i.transport);

    const elapsed = ui.finish(meta.partial
      ? 'Zatrzymane w trakcie — wynik częściowy'
      : 'Gotowe', !meta.partial);
    // Licznik po zakończeniu podsumowuje CAŁY przebieg. Bez tego zostawał na
    // nim stan ostatniego etapu („6 z 6 produktów"), co wyglądało, jakby
    // przebieg objął sześć faktur.
    ui.counts(meta.invoices + ' faktur → ' + items.length + ' produktów', elapsed);

    const candidates = copyItems(items);
    const coldCount = candidates.filter(i => i.cold).length;
    const unknownCount = candidates.filter(i => i.transport && i.transportKnown === false).length;

    ui.el('detail').textContent = items.length + ' produktów z ' + meta.invoices +
      ' faktur, obrót netto ' + formatPl(totalNet, 2) + ' PLN. ' +
      'Zaznaczonych: ' + candidates.length + ' (próg wagi ' + COPY_MIN_WEIGHT + ').' +
      (hasTransport ? ' W chłodni/mroźni: ' + coldCount +
        (unknownCount ? ', nierozpoznanych: ' + unknownCount : '') + '.' : '') +
      (meta.partial ? ' Przebieg nie objął całej listy — potraktuj to jako próbkę.' : '');

    // WSZYSTKIE produkty, nie pierwsze 40: skoro listę składa się klikaniem,
    // każdy wiersz musi być dostępny. Tabela ma własne przewijanie.
    // Niezaznaczone są wyszarzone, a nie ukryte — widać wtedy, co siedzi tuż
    // pod progiem i co warto dobrać ręcznie.
    const rows = items.map(i =>
      '<tr data-sku="' + i.sku + '" title="Kliknij, żeby ' +
      (isSelected(i) ? 'usunąć z listy' : 'dodać do listy') + '" style="cursor:pointer;' +
      (isSelected(i) ? '' : 'opacity:.4') + '">' +
      '<td style="padding:2px 4px;text-align:center;' +
      (isSelected(i) ? 'color:#36b37e' : 'opacity:.5') + '">' +
      (isSelected(i) ? '&#10003;' : '&#183;') + '</td>' +
      '<td style="padding:2px 4px;opacity:.5">' + i.rank + '</td>' +
      '<td style="padding:2px 4px;font-weight:600;white-space:nowrap">' + i.sku + '</td>' +
      '<td style="padding:2px 4px">' + i.name + '</td>' +
      '<td style="padding:2px 4px;text-align:right;font-weight:600">' + formatPl(i.weight, 1) + '</td>' +
      '<td style="padding:2px 4px;text-align:right">' + formatPl(i.median, 2) + '</td>' +
      '<td style="padding:2px 4px;text-align:right">' + formatPl(i.p90, 2) + '</td>' +
      (hasTransport ? '<td style="padding:2px 4px;white-space:nowrap">' + transportCell(i) + '</td>' : '') +
      '<td style="padding:2px 4px;text-align:right;opacity:.7">' + i.invoices + '</td>' +
      '</tr>').join('');

    const rb = ui.el('resultbox');
    rb.style.display = 'flex';
    rb.innerHTML = [
      '<div style="flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px">',
      '  <span style="opacity:.65;flex:1 1 220px;min-width:0">Kliknij wiersz, żeby dodać',
      '    produkt do listy albo go usunąć</span>',
      (manualIn.size || manualOut.size)
        ? '<button data-role="reset" type="button" style="flex:0 0 auto;cursor:pointer;' +
          'font:inherit;font-size:11px;padding:2px 8px;border:1px solid rgba(255,255,255,.25);' +
          'border-radius:4px;background:transparent;color:#f5f7fa">wróć do progu (' +
          (manualIn.size + manualOut.size) + ')</button>'
        : '',
      '</div>',
      hasTransport ? '<label style="flex:0 0 auto;display:flex;gap:6px;align-items:center;' +
        'font-size:12px;cursor:pointer"><input data-role="onlynoncold" type="checkbox"' +
        (onlyNonColdState ? ' checked' : '') + '>' +
        '<span>tylko bez chłodni i mroźni</span></label>' : '',
      '<button data-role="copy" type="button" style="flex:0 0 auto;width:100%;cursor:pointer;',
      '    font:inherit;font-size:12px;padding:7px 10px;border:0;border-radius:4px;',
      '    background:#36b37e;color:#04231a;font-weight:600"></button>',
      // Tabela jest JEDYNYM elementem, który wolno skracać i przewijać.
      '<div style="flex:1 1 auto;overflow:auto;min-height:0">',
      '  <table style="border-collapse:collapse;font-size:11px;width:100%">',
      '    <thead><tr style="text-align:left;opacity:.6">',
      '      <th style="padding:2px 4px"></th>',
      '      <th style="padding:2px 4px"></th><th style="padding:2px 4px">SKU</th>',
      '      <th style="padding:2px 4px">Nazwa</th>',
      '      <th style="padding:2px 4px;text-align:right">Waga</th>',
      '      <th style="padding:2px 4px;text-align:right">Med. cena</th>',
      '      <th style="padding:2px 4px;text-align:right">P90 cena</th>',
      hasTransport ? '<th style="padding:2px 4px">Przewóz</th>' : '',
      '      <th style="padding:2px 4px;text-align:right">Fkt</th>',
      '    </tr></thead><tbody>', rows, '</tbody></table>',
      '</div>'
    ].join('');

    const copyBtn = rb.querySelector('[data-role="copy"]');
    const toggle = rb.querySelector('[data-role="onlynoncold"]');
    // Bez danych ze sklepu przełącznika nie ma, a wtedy filtr chłodni musi być
    // WYŁĄCZONY — inaczej brak informacji cicho wyciąłby część listy.
    const onlyNonCold = () => (toggle ? toggle.checked : false);

    function refreshCopyLabel() {
      copyBtn.textContent = '📋 Kopiuj do arkusza (' +
        clipboardRows(items, onlyNonCold()).length + ' wierszy)';
    }
    refreshCopyLabel();
    if (toggle) toggle.addEventListener('change', () => {
      onlyNonColdState = toggle.checked;
      refreshCopyLabel();
    });

    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(buildTsv(items, onlyNonCold()));
      copyBtn.textContent = ok ? '✔ Skopiowane — wklej do arkusza' : '✘ Nie udało się skopiować';
      setTimeout(refreshCopyLabel, 2500);
    });

    // ---------- Ręczne składanie listy ----------

    // Dodanie produktu spod progu wpuszcza SKU, które nigdy nie było
    // sprawdzane w sklepie — wtedy dociągamy warunki przewozu dla tego
    // jednego produktu. Usunięcie z listy nigdy nic nie dociąga.
    async function toggleRow(sku) {
      if (selectionBusy) return;
      const item = items.find(i => i.sku === sku);
      if (!item) return;

      toggleSelected(item);

      const pending = COLD_CHAIN.ENABLE && copyItems(items).some(i => !i.transport);
      if (!pending) { showResults(ui, items, meta); return; }

      selectionBusy = true;
      try {
        await annotateTransport(items, ui);
      } catch (err) {
        if (err && err.aborted) console.warn(LOG, 'Dociąganie warunków przewozu przerwane.');
        else console.error(LOG, 'Dociąganie warunków przewozu nie udało się:', err);
      } finally {
        selectionBusy = false;
        // Przerysowanie odtwarza panel z nowym zaznaczeniem i świeżymi flagami;
        // stan przełącznika chłodni siedzi poza tą funkcją, więc nie przepada.
        showResults(ui, items, meta);
      }
    }

    // Nasłuch na tbody, nie na każdym wierszu: wierszy jest tyle, ile
    // produktów, a panel przerysowuje się po każdym kliknięciu.
    const tbody = rb.querySelector('tbody');
    if (tbody) tbody.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-sku]');
      if (tr) toggleRow(tr.getAttribute('data-sku'));
    });

    const resetBtn = rb.querySelector('[data-role="reset"]');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (selectionBusy) return;
      manualIn.clear();
      manualOut.clear();
      showResults(ui, items, meta);
    });

    console.log(LOG, 'Wynik:', items);
    console.log(LOG, 'TSV (tylko bez chłodni):');
    console.log(buildTsv(items, true));
  }

  async function run() {
    ABORT.requested = false;
    const ui = createPanel();

    try {
      const res = await collectAll(ui);
      const items = aggregate(res.positions, res.invoices);

      // Warunki przewozu dopiero TERAZ, gdy znane są wagi: sprawdzamy wyłącznie
      // produkty nad progiem, więc sklep dostaje kilkadziesiąt żądań, a nie
      // kilkaset. Przerwanie w tym etapie zostawia wynik z faktur nienaruszony —
      // po prostu bez flag chłodni.
      if (COLD_CHAIN.ENABLE && items.length) {
        try {
          await annotateTransport(items, ui);
        } catch (err) {
          if (err && err.aborted) {
            console.warn(LOG, 'Sprawdzanie warunków przewozu przerwane — ' +
              'pokazuję wynik bez pełnych flag chłodni.');
          } else {
            console.error(LOG, 'Sprawdzanie warunków przewozu nie udało się:', err);
          }
        }
      }

      if (!items.length) {
        ui.finish('Nic nie zebrałem', false);
        ui.el('detail').textContent = 'Żadna faktura nie dała pozycji. Sprawdź, czy lista ' +
          'jest przefiltrowana i czy widać na niej dokumenty typu ' + DOC_TYPES.join('/') + '.';
        return;
      }
      showResults(ui, items, res);
    } catch (err) {
      if (err && err.aborted) {
        console.warn(LOG, 'Przebieg przerwany przez użytkownika.');
        if (panel) {
          ui.finish('Przerwane', false);
          ui.el('detail').textContent = 'Nic nie policzyłem — uruchom ponownie, ' +
            'żeby przejść listę od początku.';
        }
        return;
      }
      console.error(LOG, err);
      if (panel) {
        ui.finish('Błąd', false);
        ui.el('detail').textContent = (err && err.message ? err.message : String(err)) +
          ' — szczegóły w konsoli.';
      }
    }
  }

  // ---------- Wstrzyknięcie przycisku ----------

  // Przycisk siada w toolbarze listy, obok „Pokaż"/„Korekta", tak samo jak
  // „🧩 Zbuduj opis" w skrypcie katalogowym — klasy są ERP-owe, żeby wyglądał
  // jak część aplikacji, a nie naklejka.
  function insertButtonIfNeeded() {
    if (!location.href.includes(LIST_URL_FRAGMENT)) return;
    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + BUTTON_ID)) return;

    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="caption" title="Ustaw filtry listy, potem kliknij. ' +
      'Skrypt otworzy po kolei każdą fakturę i policzy wagi produktów.">' + BUTTON_TEXT + '</div>';
    btn.addEventListener('click', () => {
      if (document.getElementById(PANEL_ID)) {
        console.log(LOG, 'Przebieg już trwa albo panel jest otwarty.');
        return;
      }
      run();
    });
    toolbar.appendChild(btn);
    console.log(LOG, 'Przycisk wstrzyknięty do toolbara.');
  }

  // Zakładki ERP są tworzone i niszczone bez przeładowania strony, więc
  // jednorazowe wstrzyknięcie na starcie nie wystarcza — obserwator dokłada
  // przycisk za każdym razem, gdy lista wraca na wierzch.
  const observer = new MutationObserver(() => insertButtonIfNeeded());
  observer.observe(document.body, { childList: true, subtree: true });
  insertButtonIfNeeded();
})();
