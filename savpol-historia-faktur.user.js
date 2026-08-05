// ==UserScript==
// @name         Savpol ERP -> Historia faktur produktu (CSV)
// @namespace    savpol-erp-tools
// @version      2.10.0
// @description  Pobiera historię faktur (Wszystkie, od 1 stycznia 2024) dla wybranego produktu, analizuje co-occurrence, filtruje po logistyce i dostępności, zwraca SKU do cross-sellingu w schowku i CSV
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Savpol Historia Faktur] Skrypt załadowany. URL:', location.href);

  const TARGET_URL_FRAGMENT = 'erp.savpol.pl/pl/katalog/csitems/';
  const BUTTON_ID = 'savpol-invoice-history-btn';
  const ORIGINAL_BUTTON_TEXT = 'Pobierz historię faktur';

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

  // ---------- Konfiguracja: nakładka z postępem ----------
  // Pływające okno w prawym dolnym rogu. Napis na przycisku w toolbarze jest
  // ciasny i gubi się wśród kontrolek ERP, a przebieg trwa kilka minut —
  // użytkownik musi widzieć, że coś się dzieje i na którym etapie.
  const PROGRESS = {
    ENABLE: true,
    // 0 = nakładka zostaje do zamknięcia krzyżykiem albo do kolejnego przebiegu.
    // Domyślnie zostaje, bo końcowy panel jest nośnikiem WYNIKU (SKU + przycisk
    // Kopiuj), nie tylko postępu — autoukrywanie zabierało go, zanim dało się
    // użyć. Wartość > 0 = liczba ms do samoukrycia.
    //
    // Sama ta wartość nie wystarcza: ERP przerysowuje widok i potrafi wyrzucić
    // element z DOM, więc nakładka jest dodatkowo doczepiana z powrotem —
    // patrz progressKeepAlive przy createProgressOverlay().
    HIDE_AFTER_MS: 0
  };

  // ---------- Konfiguracja: stan katalogu po zakończeniu ----------
  // Po sprawdzeniu kandydatów wyszukiwarka katalogu zostaje z SKU ostatniego
  // z nich, co jest mylące — widok pokazuje przypadkowy produkt z rekomendacji,
  // nie ten, który analizowaliśmy. Przywracamy w niej anchora.
  const FINISH = {
    SEARCH_ANCHOR: true
  };

  // ---------- Konfiguracja: SKU do schowka ----------
  // Główny wynik pracy skryptu: lista SKU rozdzielona przecinkami, gotowa
  // do wklejenia (np. 0020669,0006418,0003863,0005105).
  const CLIPBOARD = {
    ENABLE: true,
    SEPARATOR: ','
  };

  // ---------- Przerywanie pracy ----------
  // Przebieg trwa kilka minut i nie da się go ubić inaczej niż przeładowaniem
  // strony, co gubi otwarte zakładki ERP. Przerywanie jest KOOPERACYJNE:
  // flaga jest sprawdzana w bezpiecznych punktach (między fakturami, między
  // stronami paginacji, między kandydatami, w każdej iteracji waitFor), więc
  // skrypt kończy bieżącą operację i wychodzi, zamiast urwać się w środku
  // klikania po DOM.
  const ABORT = {
    requested: false,
    running: false
  };

  function requestAbort() {
    if (!ABORT.running || ABORT.requested) return;
    ABORT.requested = true;
    console.warn('[Savpol Historia Faktur] Zgłoszono przerwanie — kończę przy najbliższym bezpiecznym punkcie.');
  }

  // Rzuca błąd oznaczony isAbort, żeby catch w pipeline odróżnił przerwanie
  // użytkownika od prawdziwej awarii (inny komunikat, brak eksportu).
  function throwIfAborted() {
    if (!ABORT.requested) return;
    const err = new Error('Przerwano przez użytkownika');
    err.isAbort = true;
    throw err;
  }

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

    // Wzorzec prawidłowego SKU produktu. Pozycje niepasujące to usługi i opłaty,
    // nie towary — np. "Dostawa - Kurier DPD" o SKU "KurierDPD". Wpadają na
    // faktury i przy niskim N potrafią wejść na pierwsze miejsce rankingu
    // (anchor 0023990, N=10: dostawa miała 40% udziału).
    // Dopuszczone sufiksy kartotek pomocniczych (-M, -R, -P) — odsiewa je
    // dopiero isAuxiliaryKartoteka() na etapie filtra dostępności.
    skuPattern: /^[0-9]{6,8}(-[A-Z])?$/,

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

      // "Kremówka do ubijania 33% UHT" — śmietanka, ale rdzeń "śmietan" jej nie
      // łapie, bo słowo brzmi "krem-ówka". Wcześniej wpadała tylko wtedy, gdy
      // nazwa zaczynała się od "Śmietano pod. Kremówka...".
      'kremowk',    // Kremówka / kremówki (po fold() bez diakrytyków)

      // "Parówka Hot Dog catering - Indykpol" — w `words` stało 'parówki'
      // w liczbie mnogiej i liczba pojedyncza przeciekała.
      'parówk',

      // "Szynka gotowana plastry - ALFAPRO" = chłodnia. Ani `wędlina`,
      // ani `kiełbasa` jej nie łapały. Rdzeń, bo szynka/szynki/szynkowa.
      'szynk',


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
      // Uwaga: tu wchodzą tylko PEŁNE słowa. Rdzenie (np. 'parówk') trafiają
      // do `substring`, bo po granicy słowa rdzeń nigdy nie dopasuje formy
      // odmienionej — po "parówk" stoi litera, więc granica nie wypada.
      'boczek', 'salami', 'kebab', 'wędlina', 'kiełbasa'
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
      throwIfAborted();  // najdłuższe oczekiwania siedzą tutaj (do 10 s)
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

  // Zrzut stanu pagera do diagnozy. Zaobserwowano przebieg, w którym
  // pagerHasNextPage() zwracał true, a przejście na stronę 2 nie następowało
  // (anchor 0031018, zebrane 20 faktur). Nie wiadomo jeszcze, czy pager
  // naprawdę miał kolejną stronę, czy tylko nie oznaczył przycisku jako
  // nieaktywnego — te dane to rozstrzygną, zamiast zgadywać i zmieniać logikę.
  function describePager(pager) {
    if (!pager) return '(brak widocznego pagera)';
    const val = el => { const e = pager.querySelector(el); return e ? (e.value || e.textContent || '').trim() : '?'; };
    const next = pager.querySelector('.NextPageButton');
    return [
      'strona=' + val('.ActivePageNoInput'),
      'stron=' + val('.TotalPagesCount'),
      'rekordow=' + val('.ResultsCountValue'),
      'nextClass="' + (next ? next.className : 'brak przycisku') + '"'
    ].join(' | ');
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
    if (!changed) {
      console.warn('[Savpol Historia Faktur] Numer strony nie zmienił się po kliknięciu. ' +
        'Pager przed: ' + beforeVal + ' | po: ' + describePager(getVisiblePager()));
    }
    return !!changed;
  }

  // Przerwanie jest MIĘKKIE: łapiemy je tutaj i zwracamy faktury zebrane do tej
  // pory, żeby kilka minut scrapowania nie przepadło. Wynik z niepełnej próby
  // jest oznaczany jako częściowy na każdym wyjściu (nakładka, konsola, nazwa CSV).
  async function collectAllInvoices(maxCount, onProgress, sink) {
    const results = sink || [];
    const processedDocs = new Set();
    let invoicesProcessed = 0;
    let pageNum = 1;

    while (invoicesProcessed < maxCount && pageNum <= MAX_PAGES) {
      throwIfAborted();

      // Numery dokumentów FA na bieżącej stronie, które jeszcze nie były przetworzone
      const faDocNumbers = getFaRows()
        .map(row => {
          const cell = row.querySelector('td[data-datafield="DocNumber"]');
          return cell ? cell.getAttribute('title') : null;
        })
        .filter(doc => doc && !processedDocs.has(doc));

      if (onProgress) onProgress(`Strona ${pageNum}: ${faDocNumbers.length} nowych faktur FA`, { done: invoicesProcessed, total: maxCount });

      for (const targetDoc of faDocNumbers) {
        throwIfAborted();
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

        if (onProgress) onProgress(`${docNumber}: ${invoiceRows.length} pozycji`, { done: invoicesProcessed, total: maxCount });
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
        if (onProgress) onProgress(`Brak kolejnych stron. Zebrano ${invoicesProcessed} faktur.`, { done: invoicesProcessed, total: invoicesProcessed });
        break;
      }

      if (onProgress) onProgress(`Przechodzę do strony ${pageNum + 1}...`, { done: invoicesProcessed, total: maxCount });
      const moved = await goToNextPage(pager);
      if (!moved) {
        console.warn('[Savpol Historia Faktur] Nie udało się przejść do kolejnej strony — przerywam. ' +
          'Zebrano ' + invoicesProcessed + ' faktur. Stan pagera: ' + describePager(getVisiblePager()));
        break;
      }
      pageNum++;
    }

    return results;
  }

  // Opakowanie łapiące przerwanie — zwraca { rows, aborted }.
  async function collectAllInvoicesInterruptible(maxCount, onProgress) {
    const collected = [];
    try {
      const rows = await collectAllInvoices(maxCount, onProgress, collected);
      return { rows, aborted: false };
    } catch (err) {
      if (err && err.isAbort) {
        console.warn(`[Savpol Historia Faktur] Przerwano — zachowuję ${collected.length} zebranych pozycji.`);
        return { rows: collected, aborted: true };
      }
      throw err;
    }
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
      const skuKey = (entry.sku || '').trim();

      // Usługi i opłaty (dostawa, transport) nie są produktami — odsiewamy
      // je po formacie SKU, przed jakąkolwiek regułą nazwową.
      if (EXCLUSIONS.skuPattern && !EXCLUSIONS.skuPattern.test(skuKey)) {
        excluded.push({ ...entry, rule: 'nieprodukt:format SKU' });
        continue;
      }

      // Nadpisania per SKU mają pierwszeństwo nad całą heurystyką nazwową.
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

  // Wyszukiwarka MUSI być szukana wewnątrz panelu zakładki "Katalog", nie
  // "pierwsza widoczna w dokumencie" — widok historii produktu ma własne panele
  // wyszukiwania i przy przełączonej zakładce SKU trafiały właśnie tam.
  // Objaw: skrypt szukał kandydatów w historii faktur zamiast w katalogu.
  function findVisibleCatalogSearchInput() {
    const panel = getCatalogPanel();
    const scope = panel || document;
    const widget = Array.from(scope.querySelectorAll('.csDBEditSearch'))
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
    // Weryfikacja PRZY KAŻDYM wyszukaniu, nie raz przed pętlą. Aktywna zakładka
    // może się zmienić w trakcie sprawdzania kandydatów, a wtedy kolejne
    // iteracje wpisywałyby SKU w wyszukiwarkę historii faktur.
    if (!isCatalogTabActive()) {
      console.warn('[Cross-sell] Zakładka katalogu nieaktywna — przełączam ponownie.');
      const back = await switchToCatalogTab();
      if (!back) {
        throw new Error('Nie udało się wrócić na zakładkę "Katalog" — przerywam, ' +
          'żeby nie wpisywać SKU w widoku historii faktur.');
      }
    }

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

  // Zakładka listy katalogu — rozpoznawana po ZAWARTOŚCI panelu, nie po nazwie.
  //
  // Dopasowanie po etykiecie zawiodło dwukrotnie: substring "Katalog" trafiał
  // w kartę produktu ("Katalog: 0030078"), a wymóg dokładnego "Katalog" nie
  // trafiał w nic (log z realnego przebiegu: 18 widocznych li.k-item i zero
  // trafień). Etykiety zależą od tego, jak użytkownik nawigował, a li.k-item
  // to w tym ERP także pozycje menu w lewym panelu.
  //
  // Dlatego szukamy panelu, który FAKTYCZNIE zawiera wyszukiwarkę i siatkę
  // katalogu. Sprawdzamy obecność w DOM, nie widoczność — panel nieaktywnej
  // zakładki jest ukryty, ale jego treść istnieje.
  function tabLabel(li) {
    return (li.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Kandydaci na zakładki: tylko li.k-item powiązane z panelem przez
  // aria-controls. Pozycje menu tego atrybutu nie mają, więc wypadają.
  function listTabCandidates() {
    return Array.from(document.querySelectorAll('li.k-item[aria-controls]'))
      .filter(li => li.offsetParent !== null)
      .map(li => ({ li, panel: document.getElementById(li.getAttribute('aria-controls')) }))
      .filter(t => t.panel);
  }

  // Sygnatura listy katalogu: wyszukiwarka + siatka z kolumną stanu (QStockAv).
  // Karta produktu i historia faktur nie mają tej kombinacji.
  function panelLooksLikeCatalog(panel) {
    const hasSearch = panel.querySelector('.csDBEditSearch input.Input') !== null;
    const hasStockGrid = Array.from(panel.querySelectorAll('.cs-grid-data-table'))
      .some(t => t.querySelector('td[data-datafield="QStockAv"]'));
    return { hasSearch, hasStockGrid, score: (hasSearch ? 2 : 0) + (hasStockGrid ? 2 : 0) };
  }

  function findCatalogTabLi() {
    const candidates = listTabCandidates();

    // 1. Panel z pełną sygnaturą katalogu.
    const full = candidates.find(t => {
      const m = panelLooksLikeCatalog(t.panel);
      return m.hasSearch && m.hasStockGrid;
    });
    if (full) return full.li;

    // 2. Panel z wyszukiwarką i jakąkolwiek siatką — katalog przed pierwszym
    //    wyszukaniem może nie mieć jeszcze wiersza z kolumną stanu.
    const partial = candidates.find(t =>
      t.panel.querySelector('.csDBEditSearch input.Input') !== null
      && t.panel.querySelector('.cs-grid-data-table') !== null);
    if (partial) return partial.li;

    // 3. Ostatnia deska ratunku: etykieta. Zostawiona, bo gdy panel jest jeszcze
    //    niezaładowany, nazwa to jedyna wskazówka. Karty produktu ("Katalog: X")
    //    odrzucamy jawnie.
    const byLabel = candidates.find(t => /^katalog$/i.test(tabLabel(t.li)));
    return byLabel ? byLabel.li : null;
  }

  // Panel treści zakładki katalogu. Kendo wiąże zakładkę z panelem przez
  // aria-controls, więc bierzemy go z powiązania, a nie z kolejności w DOM.
  function getCatalogPanel() {
    const tab = findCatalogTabLi();
    if (!tab) return null;
    const id = tab.getAttribute('aria-controls');
    return id ? document.getElementById(id) : null;
  }

  // Zakładka katalogu jest aktywna, gdy Kendo oznaczyło ją k-state-active
  // ORAZ jej panel jest faktycznie widoczny. Sama widoczność siatki nie
  // wystarcza — siatka katalogu może zostać w DOM po przełączeniu zakładki.
  function isCatalogTabActive() {
    const tab = findCatalogTabLi();
    if (!tab || !tab.classList.contains('k-state-active')) return false;
    const panel = getCatalogPanel();
    return !!panel && panel.offsetParent !== null;
  }

  async function switchToCatalogTab() {
    const tab = findCatalogTabLi();
    if (!tab) {
      // Log linia po linii — tablica zwija sie w konsoli do Array(n)
      // i diagnoza wymaga klikania.
      console.error('[Cross-sell] Nie znaleziono panelu katalogu. Kandydaci na zakladki:');
      const diag = listTabCandidates();
      if (!diag.length) console.error('  (brak li.k-item[aria-controls])');
      diag.forEach(t => {
        const m = panelLooksLikeCatalog(t.panel);
        console.error(`  "${tabLabel(t.li)}"  search=${m.hasSearch}  stockGrid=${m.hasStockGrid}`);
      });
      console.error('[Cross-sell] Wszystkie widoczne li.k-item: '
        + Array.from(document.querySelectorAll('li.k-item'))
            .filter(li => li.offsetParent !== null)
            .map(li => '"' + tabLabel(li) + '"').join(' | '));
      return false;
    }
    if (!isCatalogTabActive()) {
      (tab.querySelector('span.k-link') || tab).click();
    }
    const ready = await waitFor(() => (isCatalogTabActive()
      && getVisibleCatalogGrid() !== null
      && findVisibleCatalogSearchInput() !== null) || null, 20, 200);
    await sleep(300);
    return ready !== null;
  }

  // Przechodzi po pełnym (zdeduplikowanym po rodzinie) rankingu i dobiera
  // kolejnych kandydatów z rankingu, gdy poprzedni odpada na dostępności.
  async function applyAvailabilityFilter(dedupedRanked, topN, onProgress) {
    const kept = [];
    const rejected = [];
    let checked = 0; // ilu kandydatów faktycznie odpytaliśmy w katalogu
    const groupsSeen = new Set();
    let aborted = false;
    for (const entry of dedupedRanked) {
      if (ABORT.requested) { aborted = true; break; }  // miękkie: zachowaj sprawdzonych
      if (kept.length >= topN) break;

      if (isAuxiliaryKartoteka(entry.sku)) {
        rejected.push({ ...entry, reason: 'kartoteka pomocnicza (sufiks SKU)' });
        continue;
      }

      if (onProgress) onProgress(`Sprawdzam dostępność: ${entry.sku}...`);
      checked++;
      let info;
      try {
        info = await lookupCatalogItem(entry.sku);
      } catch (err) {
        if (err && err.isAbort) { aborted = true; break; }
        throw err;
      }
      if (!info) {
        rejected.push({ ...entry, reason: 'nie znaleziono w katalogu' });
        continue;
      }

      if (info.group) groupsSeen.add(info.group);

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
    return {
      kept, rejected, aborted,
      groupsSeen: Array.from(groupsSeen),
      checked, poolSize: dedupedRanked.length
    };
  }

  function logAvailability(avail) {
    console.log(`[Cross-sell] Filtr dostępności — zaakceptowani (${avail.kept.length}):`);
    console.table(avail.kept.map(e => ({ nazwa: e.name, SKU: e.sku, DYS: e.dys, grupa: e.group || '' })));
    if (avail.rejected.length) {
      console.log(`[Cross-sell] Filtr dostępności — odrzuceni (${avail.rejected.length}):`);
      console.table(avail.rejected.map(e => ({ nazwa: e.name, SKU: e.sku, powód: e.reason })));
    }
    // Pętla przerywa się po zebraniu TOP_N, więc grupy znamy tylko dla części
    // puli. Wypisujemy pokrycie jawnie — inaczej pusta lista "grup spoza
    // denylisty" wyglądałaby na potwierdzenie kompletności, a nie na brak danych.
    if (avail.poolSize !== undefined) {
      console.log(`[Cross-sell] Sprawdzono w katalogu ${avail.checked} z ${avail.poolSize} pozycji puli ` +
        `(pętla kończy się po zebraniu ${CROSS_SELL.TOP_N} kandydatów) — grupy pozostałych ${avail.poolSize - avail.checked} są nieznane.`);
    }
    if (avail.groupsSeen && avail.groupsSeen.length) {
      const unlisted = avail.groupsSeen.filter(g => !findGroupExclusion(g));
      if (unlisted.length) {
        console.log('[Cross-sell] Grupy wśród sprawdzonych kandydatów spoza denylisty (sprawdź, czy nie brakuje gałęzi):');
        console.table(unlisted.map(g => ({ grupa: g })));
      }
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
    // Nazwa pliku niesie informację o niepełnej próbie — inaczej częściowy
    // wynik jest nieodróżnialny od pełnego po samej zawartości.
    // Nazwa pliku niesie zastrzeżenia — inaczej wynik obniżonej jakości jest
    // nieodróżnialny od pełnego po samej zawartości.
    const marks = (result.partial ? '_CZESCIOWE' : '') + (result.unverified ? '_BEZ_WERYFIKACJI' : '');
    a.download = `cross_sell_${result.anchorSku || 'produkt'}${marks}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Wynik główny: SKU do schowka ----------
  // GM_setClipboard działa bez gestu użytkownika i bez uprawnień przeglądarki,
  // dlatego jest ścieżką pierwszego wyboru. navigator.clipboard zostaje jako
  // zapas, gdy skrypt działa bez @grant (np. po ręcznej edycji nagłówka).
  function skusToText(candidates) {
    return candidates.map(c => (c.sku || '').trim()).filter(Boolean).join(CLIPBOARD.SEPARATOR);
  }

  function copySkusToClipboard(text) {
    if (!text) return Promise.resolve(false);

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(text, 'text');
        return Promise.resolve(true);
      } catch (err) {
        console.warn('[Cross-sell] GM_setClipboard zawiodło, próbuję navigator.clipboard:', err);
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(err => {
        console.warn('[Cross-sell] navigator.clipboard zawiodło:', err);
        return false;
      });
    }

    return Promise.resolve(false);
  }

  // Wynik wypisujemy zawsze, niezależnie od tego, czy zapis do schowka się udał —
  // wtedy zostaje do skopiowania ręcznie z konsoli.
  async function deliverSkus(candidates) {
    const text = skusToText(candidates);
    if (!text) {
      console.warn('[Cross-sell] Brak SKU do skopiowania.');
      return { text, copied: false };
    }

    console.log('%c[Cross-sell] SKU do cross-sellingu:', 'font-weight:bold');
    console.log(text);

    if (!CLIPBOARD.ENABLE) return { text, copied: false };

    const copied = await copySkusToClipboard(text);
    console.log(copied
      ? '[Cross-sell] Skopiowano do schowka.'
      : '[Cross-sell] NIE udało się zapisać do schowka — skopiuj z linii powyżej.');
    return { text, copied };
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
  // Przywraca w katalogu wyszukanie anchora. Krok kosmetyczny i CELOWO
  // nieblokujący: wynik jest już policzony, więc awaria tutaj nie może go
  // zniweczyć — logujemy ostrzeżenie i idziemy dalej.
  async function searchAnchorInCatalog(anchorSku) {
    if (!FINISH.SEARCH_ANCHOR || !anchorSku) return false;
    try {
      if (!isCatalogTabActive()) {
        const switched = await switchToCatalogTab();
        if (!switched) {
          console.warn('[Cross-sell] Nie mogę wrócić na katalog — pomijam ' +
            'przywrócenie wyszukania anchora ' + anchorSku + '.');
          return false;
        }
      }
      await searchCatalog(anchorSku);
      console.log('[Cross-sell] Katalog pozostawiony na anchorze ' + anchorSku + '.');
      return true;
    } catch (err) {
      console.warn('[Cross-sell] Nie udało się przywrócić wyszukania anchora ' +
        anchorSku + ':', err && err.message || err);
      return false;
    }
  }

  // Zamyka zakładkę "Historia produktu". Po przełączeniu na katalog aktywną
  // zakładką nie jest już historia, więc gdy mamy zapamiętaną referencję,
  // zamykamy po niej; bez referencji — po zakładce aktywnej.
  async function closeHistoryTab(historyTabLi) {
    if (historyTabLi) {
      const closeBtn = historyTabLi.querySelector('.csCloseButton_span');
      if (closeBtn) closeBtn.click();
      return;
    }
    const activeCloseBtn = document.querySelector('li.k-state-active .csCloseButton_span');
    if (activeCloseBtn) {
      await sleep(300);
      activeCloseBtn.click();
    }
  }

  async function runFullPipeline(button) {
    // Drugie kliknięcie w trakcie pracy = żądanie przerwania, nie drugi przebieg.
    if (ABORT.running) {
      requestAbort();
      button.textContent = 'Przerywam...';
      return;
    }

    const originalText = ORIGINAL_BUTTON_TEXT;
    ABORT.running = true;
    ABORT.requested = false;
    const ui = PROGRESS.ENABLE ? createProgressOverlay() : noopProgress();
    try {
      ui.phase('Otwieram historię produktu...');
      button.textContent = 'Otwieram historię...';
      const opened = openHistory();
      if (!opened) throw new Error('Nie znaleziono przycisku "Historia produktu". Czy produkt jest zaznaczony?');
      await sleep(500);

      const mainSku = await waitFor(getMainProductSku);
      ui.detail('Produkt: ' + (mainSku || '?'));

      ui.phase('Ustawiam filtry (od 1.01.2024, wszystkie)...');
      button.textContent = 'Ustawiam filtry...';
      await setFilters();

      ui.phase('Pobieram faktury...');
      button.textContent = 'Pobieram faktury...';
      const collect = await collectAllInvoicesInterruptible(MAX_INVOICES, (msg, n) => {
        button.textContent = msg;
        ui.detail(msg);
        if (n) ui.count(n.done, n.total);
        console.log(msg);
      });
      const data = collect.rows;
      let partial = collect.aborted;

      // Przerwanie bez ani jednej faktury nie ma czego analizować.
      if (partial && data.length === 0) {
        const err = new Error('Przerwano przed odczytaniem pierwszej faktury');
        err.isAbort = true;
        throw err;
      }
      // Dalsze etapy mają już przebiegać do końca — inaczej sam fakt przerwania
      // ubiłby analizę, dla której faktury właśnie zebraliśmy.
      ABORT.requested = false;

      ui.phase(partial ? 'Przerwano — analizuję zebrane faktury...' : 'Analizuję cross-sell...');
      ui.detail(data.length + ' pozycji z ' + new Set(data.map(r => r.doc)).size + ' faktur');
      const analysis = analyzeCrossSell(data, mainSku);
      analysis.partial = partial;
      logAnalysis(analysis);

      let historyTabLi = null;
      if (AVAILABILITY.ENABLE) {
        historyTabLi = document.querySelector('li.k-state-active'); // zapamiętane PRZED przejściem do katalogu
        ui.phase('Sprawdzam dostępność w katalogu...');
        button.textContent = 'Sprawdzam dostępność w katalogu...';

        // Awaria katalogu DEGRADUJE wynik, nie kasuje przebiegu. Wcześniej
        // rzucała wyjątek i kilka minut scrapowania plus gotowy ranking
        // przepadały — użytkownik nie dostawał nic. Ranking z analizy jest
        // wartościowy sam w sobie; brakuje mu tylko weryfikacji stanu i grupy.
        const switched = await switchToCatalogTab();
        if (!switched) {
          console.warn('[Cross-sell] Nie udało się przełączyć na katalog — ' +
            'zwracam wynik BEZ weryfikacji stanu magazynowego i grupy.');
          analysis.unverified = true;
        } else {
          const avail = await applyAvailabilityFilter(analysis.dedupedRanked, CROSS_SELL.TOP_N, (msg) => {
            button.textContent = msg;
            ui.detail(msg);
          });
          logAvailability(avail);
          analysis.candidates = avail.kept;
          analysis.weakSignal = analysis.weakSignal || avail.kept.length === 0;
          if (avail.aborted) { partial = true; analysis.partial = true; }
        }

        // Ostatnia czynność w katalogu: przywróć wyszukanie anchora, żeby widok
        // nie został na SKU ostatniego sprawdzanego kandydata.
        if (FINISH.SEARCH_ANCHOR) {
          ui.phase('Przywracam w katalogu produkt wyjściowy...');
          button.textContent = 'Przywracam widok katalogu...';
          await searchAnchorInCatalog(mainSku);
        }
      }

      if (EXPORT_RAW_HISTORY) {
        downloadCSV(data, mainSku);
        await sleep(300); // przeglądarki gubią drugi download bez odstępu
      }

      downloadCrossSellCSV(analysis);

      // Główny wynik pracy: SKU rozdzielone przecinkami w schowku.
      const delivered = await deliverSkus(analysis.candidates);

      const notes = [];
      if (partial) notes.push('próba NIEPEŁNA (przerwana)');
      if (analysis.unverified) notes.push('BEZ weryfikacji stanu i grupy');
      const partialNote = notes.length ? ' — ' + notes.join(', ') : '';

      if (analysis.weakSignal) {
        ui.finish(`Sygnał zbyt słaby (N=${analysis.N})${partialNote}`, false);
        ui.detail('Żaden kandydat nie przeszedł progu — brak rekomendacji.');
        button.textContent = `Sygnał zbyt słaby (N=${analysis.N})`;
      } else {
        const clean = !partial && !analysis.unverified;
        ui.finish(`Gotowe — ${analysis.candidates.length} kandydatów (N=${analysis.N})${partialNote}`, clean);
        ui.result(delivered.text);
        if (analysis.unverified) {
          ui.detail('Nie sprawdzono stanu magazynowego ani grupy — mogą tu być ' +
            'produkty niedostępne lub niewysyłkowe. Zobacz konsolę.');
        } else if (partial) {
          ui.detail(`Wynik z ${analysis.N} faktur, nie z pełnej próby — traktuj ostrożnie.`);
        } else {
          ui.detail(delivered.copied ? 'SKU są już w schowku.' : 'Zapis do schowka zawiódł — użyj przycisku Kopiuj.');
        }
        button.textContent = delivered.copied
          ? `Gotowe, SKU w schowku: ${delivered.text}`
          : `Gotowe: ${analysis.candidates.length} kandydatów — SKU w konsoli`;
      }
      await sleep(2500);

      await closeHistoryTab(AVAILABILITY.ENABLE ? historyTabLi : null);

      button.textContent = originalText;
    } catch (err) {
      if (err && err.isAbort) {
        // Przerwanie użytkownika — świadomie NIE eksportujemy nic. Wynik
        // z niepełnej próby wyglądałby jak normalna rekomendacja, a nie jest.
        console.warn('[Savpol Historia Faktur] Przerwano przez użytkownika.');
        ui.finish('Przerwano', false);
        ui.detail('Nie zapisano CSV ani schowka — próba była niepełna.');
        button.textContent = 'Przerwano';
      } else {
        console.error('[Savpol Historia Faktur] Błąd:', err);
        ui.finish('Błąd — zobacz konsolę', false);
        ui.detail(String(err && err.message || err));
        button.textContent = 'Błąd — zobacz konsolę';
      }
      setTimeout(() => { button.textContent = originalText; }, 3000);
    } finally {
      ABORT.running = false;
      ABORT.requested = false;
    }
  }

  // ---------- Nakładka z postępem ----------
  const PROGRESS_ID = 'savpol-progress-overlay';

  // Nakładka niesie WYNIK, więc musi przeżyć do świadomego zamknięcia.
  // ERP przerysowuje widok (m.in. przy zamykaniu zakładki historii) i potrafi
  // wyrzucić nasz element z DOM. Trzymamy referencję i doczepiamy go z powrotem,
  // dopóki użytkownik sam nie kliknie krzyżyka.
  let progressBox = null;
  let progressKeepAlive = null;

  function stopProgressKeepAlive() {
    if (progressKeepAlive) {
      clearInterval(progressKeepAlive);
      progressKeepAlive = null;
    }
  }

  // Zamknięcie na żądanie użytkownika albo przed nowym przebiegiem —
  // w obu wypadkach przestajemy pilnować obecności.
  function removeProgressOverlay() {
    stopProgressKeepAlive();
    progressBox = null;
    const old = document.getElementById(PROGRESS_ID);
    if (old) old.remove();
  }

  // Styl inline, bo arkusze ERP potrafią nadpisać klasy. Wysoki z-index,
  // pointer-events tylko na przycisku zamknięcia, żeby nakładka nie blokowała
  // klikania w aplikację pod nią.
  function createProgressOverlay() {
    removeProgressOverlay();

    const box = document.createElement('div');
    box.id = PROGRESS_ID;
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
      'width:320px', 'padding:14px 16px', 'box-sizing:border-box',
      'background:#1f2933', 'color:#f5f7fa', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
    ].join(';');

    box.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="flex:1;font-size:13px">Historia faktur</strong>',
      '  <button data-role="stop" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '    padding:2px 8px;border:0;border-radius:4px;background:#5a3a3a;color:#ffd9d4">Przerwij</button>',
      '  <span data-role="close" title="Zamknij panel" style="cursor:pointer;opacity:.6;padding:0 6px;font-size:16px;line-height:1">&times;</span>',
      '</div>',
      '<div data-role="phase" style="margin-bottom:6px;opacity:.85"></div>',
      '<div style="height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden">',
      '  <div data-role="bar" style="height:100%;width:0%;background:#4c9aff;transition:width .2s"></div>',
      '</div>',
      '<div style="display:flex;margin-top:6px;font-size:12px;opacity:.75">',
      '  <span data-role="count" style="flex:1"></span>',
      '  <span data-role="time"></span>',
      '</div>',
      '<div data-role="detail" style="margin-top:8px;font-size:12px;opacity:.7;word-break:break-word"></div>',
      '<div data-role="resultbox" style="display:none;margin-top:10px;padding-top:10px;',
      '    border-top:1px solid rgba(255,255,255,.15)">',
      '  <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.6;',
      '      margin-bottom:4px">SKU do cross-sellingu</div>',
      '  <div style="display:flex;gap:6px;align-items:stretch">',
      '    <input data-role="skus" readonly style="flex:1;min-width:0;font:12px ui-monospace,Consolas,monospace;',
      '        padding:5px 7px;border:1px solid rgba(255,255,255,.2);border-radius:4px;',
      '        background:rgba(0,0,0,.25);color:#f5f7fa">',
      '    <button data-role="copy" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '        padding:5px 10px;border:0;border-radius:4px;background:#4c9aff;color:#04142e;',
      '        font-weight:600;white-space:nowrap">Kopiuj</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(box);
    progressBox = box;
    // Ten sam węzeł jest doczepiany ponownie, więc nasłuchy i wpisana treść
    // (SKU w polu wyniku) zostają nienaruszone.
    stopProgressKeepAlive();
    progressKeepAlive = setInterval(() => {
      if (progressBox && !progressBox.isConnected) {
        document.body.appendChild(progressBox);
      }
    }, 1000);
    const el = r => box.querySelector('[data-role="' + r + '"]');
    el('close').addEventListener('click', removeProgressOverlay);
    el('copy').addEventListener('click', async () => {
      const text = el('skus').value;
      if (!text) return;
      el('skus').select();
      const ok = await copySkusToClipboard(text);
      el('copy').textContent = ok ? 'Skopiowano' : 'Zaznacz i Ctrl+C';
      setTimeout(() => { el('copy').textContent = 'Kopiuj'; }, 2000);
    });
    el('stop').addEventListener('click', () => {
      requestAbort();
      el('stop').disabled = true;
      el('stop').textContent = 'Przerywam...';
      el('phase').textContent = 'Przerywam — kończę bieżącą operację...';
    });

    const started = Date.now();
    const fmt = ms => {
      const sec = Math.round(ms / 1000);
      return sec < 60 ? sec + ' s' : Math.floor(sec / 60) + ' min ' + String(sec % 60).padStart(2, '0') + ' s';
    };

    return {
      phase(text) { el('phase').textContent = text; },
      detail(text) { el('detail').textContent = text || ''; },
      // done/total sterują paskiem; bez total pasek zostaje bez zmian
      count(done, total) {
        if (total) {
          el('bar').style.width = Math.min(100, Math.round(100 * done / total)) + '%';
          el('count').textContent = done + ' / ' + total + ' faktur';
        } else {
          el('count').textContent = done ? done + ' faktur' : '';
        }
        el('time').textContent = fmt(Date.now() - started);
      },
      // Wynik do kopiuj-wklej. Pole jest readonly, ale zaznaczalne — jeśli
      // zapis do schowka zawiedzie, zostaje Ctrl+C bez sięgania do konsoli.
      result(text) {
        if (!text) return;
        el('skus').value = text;
        el('resultbox').style.display = 'block';
      },
      finish(text, ok) {
        el('stop').remove();
        el('phase').textContent = text;
        el('bar').style.width = '100%';
        el('bar').style.background = ok ? '#36b37e' : '#ff5630';
        el('time').textContent = fmt(Date.now() - started);
        if (PROGRESS.HIDE_AFTER_MS > 0) setTimeout(removeProgressOverlay, PROGRESS.HIDE_AFTER_MS);
      }
    };
  }

  // Atrapa na wypadek PROGRESS.ENABLE = false — pipeline nie musi sprawdzać flagi.
  function noopProgress() {
    return { phase() {}, detail() {}, count() {}, result() {}, finish() {} };
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
    btn.innerHTML = '<div class="caption" title="' + ORIGINAL_BUTTON_TEXT +
      ' (w trakcie pracy: kliknij ponownie, żeby przerwać)">' + ORIGINAL_BUTTON_TEXT + '</div>';
    btn.addEventListener('click', () => runFullPipeline(btn));
    toolbar.appendChild(btn);
  }

  setInterval(insertButtonIfNeeded, 1000);

})();
