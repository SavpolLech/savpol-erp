// ==UserScript==
// @name         Savpol ERP -> Historia faktur produktu (CSV)
// @namespace    savpol-erp-tools
// @version      2.31.0
// @description  Buduje opis produktu: pobiera historię faktur (Wszystkie, od 1 stycznia 2024) dla wybranego produktu, analizuje co-occurrence, filtruje po logistyce i dostępności, przekazuje SKU do cross-sellingu do generatora opisów
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-historia-faktur.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-historia-faktur.user.js
// @match        https://erp.savpol.pl/*
// @match        https://esavpol.pl/*
// @grant        unsafeWindow
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      esavpol-pdp.vercel.app
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Savpol Historia Faktur] Skrypt załadowany. URL:', location.href);

  const TARGET_URL_FRAGMENT = 'erp.savpol.pl/pl/katalog/csitems/';
  const BUTTON_ID = 'savpol-invoice-history-btn';
  const ORIGINAL_BUTTON_TEXT = '🧩 Zbuduj opis';
  const ESAVPOL_BUTTON_ID = 'savpol-open-esavpol-btn';
  const ESAVPOL_BUTTON_TEXT = '🛒 Otwórz w esavpol';

  // ---------- Konfiguracja ----------
  const MAX_INVOICES = 100;                       // limit pobieranych faktur
  const HISTORY_START_DATE = new Date(2024, 0, 1); // od stycznia 2024
  const MAX_PAGES = 50;                            // zabezpieczenie przed nieskończoną pętlą paginacji
  const MAX_CONSECUTIVE_FAILURES = 3;              // tyle nieudanych otwarć faktur z rzędu kończy zbieranie

  // Pliki CSV na dysk. Były potrzebne do kalibracji reguł na realnych danych;
  // teraz wynikiem pracy jest opis w generatorze, a pobrane pliki
  // tylko zaśmiecają Pobrane. Zostają jako flagi, bo przy dostrajaniu reguł
  // surowa historia znów bywa potrzebna.
  const EXPORT_RAW_HISTORY = false;                // CSV z pełną historią faktur (debug reguł)
  const EXPORT_CROSS_SELL_CSV = false;             // CSV z listą kandydatów

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

    // Progi wielkości próby. Zmierzone, nie wyczute: dla ośmiu skalibrowanych
    // anchorów losowo przycinaliśmy próbę do K faktur (40 losowań na kombinację)
    // i sprawdzali, ile z top-4 z pełnej próby wraca w wyniku.
    //
    //   K=10 → 5% trafień   K=30 → 44%   K=60 → 74%
    //   K=20 → 22% trafień  K=50 → 68%   K=80 → 85%
    //
    // Przy 20 fakturach trzy z czterech rekomendacji byłyby inne, gdyby dane
    // były kompletne — to losowanie, nie sygnał.
    //
    // UWAGA: te progi sterują WYŁĄCZNIE komunikatem dla użytkownika. Decyzję,
    // czy wynik jest wiarygodny, podejmuje generator — dostaje surowe
    // `invoices=N` i sam trzyma próg. Dzięki temu zmiana progu nie wymaga
    // aktualizacji skryptu u każdego pracownika z osobna. Nie kasujemy tu
    // kandydatów: gdyby skrypt ich wycinał, generator nigdy by ich nie zobaczył
    // i nie mógłby progu obniżyć.
    MIN_INVOICES: 30,
    LOW_CONFIDENCE_BELOW: 50,

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
    // Domyślnie zostaje, bo końcowy panel jest nośnikiem WYNIKU (przycisk
    // otwarcia generatora), nie tylko postępu — autoukrywanie zabierało go,
    // zanim dało się użyć. Wartość > 0 = liczba ms do samoukrycia.
    //
    // Sama ta wartość nie wystarcza: ERP przerysowuje widok i potrafi wyrzucić
    // element z DOM, więc nakładka jest dodatkowo doczepiana z powrotem —
    // patrz progressKeepAlive przy createProgressOverlay().
    HIDE_AFTER_MS: 0
  };

  // ---------- Konfiguracja: generator PDP ----------
  // Generator przyjmuje anchora i cross-sell w URL i sam dociąga dane produktu
  // z esavpol.pl, więc krok z otwieraniem sklepu i przeklejaniem danych odpada.
  const GENERATOR = {
    ENABLE: true,
    URL: 'https://esavpol-pdp.vercel.app/'
  };

  // ---------- Konfiguracja: historia faktur do repo ----------
  // Historia trafia do prywatnego repo esavpol-pdp, ale NIE bezpośrednio:
  // wysyła ją apka generatora swoim serwerowym tokenem. Skrypt nie trzyma
  // żadnego sekretu — odkłada dane w GM storage i wysyła je dopiero ze strony
  // generatora, czyli same-origin, z ciasteczkiem sesji i bez CORS-a.
  // Kontrakt: docs/integracja-historia-faktur.md.
  const HISTORY_UPLOAD = {
    ENABLE: true,
    ENDPOINT: '/api/invoice-history',
    QUEUE_KEY: 'invoice_history_queue',
    // Kolejka rośnie, gdy ktoś zrobi kilka produktów, zanim otworzy generator.
    // Limit chroni storage przed puchnięciem, gdy sesja wygasła na dobre.
    MAX_QUEUED: 20
  };

  // ---------- Konfiguracja: przejście do sklepu ----------
  // ERP nie zna adresu produktu w e-commerce, a slug w URL sklepu nie da się
  // zbudować z samego SKU. Droga jest więc dwuetapowa, ta sama co w
  // savpol-sku-harvester: otwieramy wyszukiwarkę sklepu z SKU, a skrypt
  // działający już na esavpol.pl klika w kartę z DOKŁADNIE tym SKU.
  const ESAVPOL = {
    ENABLE: true,
    SEARCH_URL: sku => 'https://esavpol.pl/produkty?searchtext=' + encodeURIComponent(sku),
    PENDING_KEY: 'esavpol_pending_sku',
    // Wyniki dociągają się asynchronicznie: 20 prób co 500 ms = 10 s.
    MAX_ATTEMPTS: 20,
    RETRY_MS: 500,
    // Link produktu poznajemy po kształcie adresu (slug + co najmniej 6 cyfr),
    // nie po klasie CSS — klasy w sklepie się zmieniają, kształt nie.
    PRODUCT_LINK_RE: /^\/[a-z0-9ąćęłńóśźż-]+-\d{6,}$/i
  };

  // ---------- Konfiguracja: masowy odczyt danych z katalogu ----------
  // Druga funkcja skryptu, niezależna od cross-sellingu: wklejasz kolumnę
  // z arkusza (SKU albo nazwy), zaznaczasz potrzebne dane, dostajesz każdą
  // z nich jako osobną kolumnę w tej samej kolejności.
  //
  // Wszystko, co czytamy, jest KOLUMNĄ SIATKI KATALOGU, więc nie trzeba
  // otwierać karty produktu — wystarczy wyszukać i odczytać wiersz.
  const EAN_TOOL = {
    ENABLE: true,
    BUTTON_ID: 'savpol-ean-btn',
    PANEL_ID: 'savpol-ean-panel',
    // Odstęp po każdym wyszukaniu. Katalog odpowiada szybko, ale przy 500
    // pozycjach pod rząd warto nie zasypywać go żądaniami.
    DELAY_MS: 200,
    // Próg podobieństwa nazwy (0-1), poniżej którego dopasowanie jest oznaczane
    // jako niepewne. Dobrany ostrożnie: przy 500 produktach jeden cicho
    // podstawiony wiersz to błędna cena w arkuszu, której nikt nie wyłapie.
    NAME_MATCH_MIN: 0.6,

    // Skracanie zapytania, gdy pełna nazwa nic nie zwróci. Musi być
    // RESTRYKCYJNE. Pierwsza wersja schodziła aż do jednego słowa i „Worek
    // cukierniczy jednorazowy Masterline Green 59x28 cm - One Way" kończył
    // jako zapytanie „worek" — to już nie jest szukanie tego produktu, tylko
    // losowanie z całej kategorii. Cichy fałszywy wynik jest gorszy od pustego
    // wiersza, bo wygląda jak dane.
    NAME_FALLBACK: {
      // Zapytanie nigdy nie schodzi poniżej tylu znaczących słów...
      MIN_TOKENS: 3,
      // ...ani poniżej tylu znaków. Trzy krótkie słowa nadal bywają za ogólne.
      MIN_CHARS: 12,
      // Wynik ze SKRÓCONEGO zapytania musi trafić mocniej niż z pełnego.
      // Skrócone zapytanie z natury pasuje do wielu produktów, więc zwykły
      // próg by tu nie wystarczył.
      MIN_SCORE: 0.8
    }
  };

  // ---------- Konfiguracja: statystyki cen sprzedaży ----------
  // Do analizy polityki cenowej: jak nisko można zejść z ceną w e-commerce,
  // nie podcinając klientów B2B, którzy kupują ten produkt od nas dziś.
  //
  // Dane idą z siatki HISTORII PRODUKTU, gdzie każdy wiersz to jedna pozycja
  // faktury: cena netto po rabacie, ilość, kontrahent, data. Nie trzeba
  // otwierać dokumentów — wszystko jest na liście.
  const PRICE_STATS = {
    ENABLE: true,
    // Zakres: od 1 STYCZNIA BIEŻĄCEGO ROKU. Polityka cenowa ma się opierać na
    // cenach aktualnych — przez dwa lata wstecz cena zmieniała się tak czy
    // inaczej, a im dłuższy okres, tym więcej stron do przewinięcia.
    //
    // Uwaga na styczeń i luty: to okno kurczy się do kilku tygodni, więc próba
    // bywa za mała. Nie wydłużamy go po cichu — status i tak powie „tylko N
    // transakcji", a przełącznik niżej pozwala wrócić do okna kroczącego.
    FROM_YEAR_START: true,
    MONTHS_BACK: 12,          // używane tylko przy FROM_YEAR_START = false

    // Górny limit pozycji na produkt. Bestsellery mają w roku setki transakcji
    // i przewijanie ich stron zajmowało większość czasu przebiegu, a percentyl
    // ze 100 pozycji jest praktycznie tak samo stabilny jak z 800.
    //
    // Liczą się NAJNOWSZE, bo lista historii jest sortowana od najnowszych.
    // Skutek uboczny: przy trafieniu w limit próba obejmuje krótszy okres niż
    // zamówiony — dlatego jest to zgłaszane w statusie, a kolumna „Okres"
    // pokazuje faktyczny zakres dat.
    MAX_TRANSACTIONS: 100,
    // Poniżej tylu transakcji percentyle są fikcją — zwracamy je, ale
    // z ostrzeżeniem w statusie.
    MIN_TRANSACTIONS: 5,
    // Percentyl traktowany jako PODŁOGA CENOWA (patrz docs/polityka-cenowa.md).
    FLOOR_PERCENTILE: 25,
    // Kontrahenci pomijani w statystyce — np. konto własnego e-commerce, które
    // zaniżałoby podłogę własnymi cenami. Dopasowanie: fragment nazwy, bez
    // wielkości liter. Puste = nie pomijamy nikogo.
    EXCLUDE_CUSTOMERS: [],
    // Iloraz P90/P10, od którego mówimy o rozwarstwieniu cen: znak, że są dwie
    // grupy klientów i sama mediana nie opisuje rynku.
    SPREAD_ALERT: 1.15
  };

  // Kolumny siatki katalogu, które umiemy odczytać. `numeric` znaczy, że
  // wartość jest liczbą z polskim przecinkiem i można ją przełączyć na kropkę.
  const DATA_FIELDS = [
    { key: 'sku',   label: 'SKU',             field: 'Item' },
    { key: 'name',  label: 'Nazwa z ERP',     field: 'ItemDesc' },
    { key: 'ean',   label: 'EAN',             field: 'EAN' },
    { key: 'price', label: 'Cena',            field: 'CSalesPrice',      numeric: true },
    { key: 'min',   label: 'Cena minimalna',  field: 'CSalesMinPrice',   numeric: true },
    { key: 'limit', label: 'Cena graniczna',  field: 'CSalesLimitPrice', numeric: true },
    { key: 'group', label: 'Grupa produktu',  field: 'ItemsGroupTranslatedDesc' },
    { key: 'stock', label: 'Stan (DYS.)',     field: 'QStockAv',         numeric: true }
  ];

  // Dane liczone z historii sprzedaży. Osobna lista, bo ich pobranie wymaga
  // otwarcia historii produktu — jest DUŻO wolniejsze niż odczyt katalogu.
  const SALES_FIELDS = [
    { key: 'txn',      label: 'Transakcji' },
    { key: 'volume',   label: 'Wolumen',            numeric: true },
    { key: 'floor',    label: 'PODŁOGA (P25 wol.)', numeric: true },
    { key: 'median',   label: 'Mediana (wol.)',     numeric: true },
    { key: 'p10',      label: 'P10 (wol.)',         numeric: true },
    { key: 'p90',      label: 'P90 (wol.)',         numeric: true },
    { key: 'minPrice', label: 'Cena min. w historii', numeric: true },
    { key: 'maxPrice', label: 'Cena maks. w historii', numeric: true },
    { key: 'medianTx', label: 'Mediana (transakcje)', numeric: true },
    { key: 'floorTx',  label: 'PODŁOGA (P25 transakcje)', numeric: true },
    { key: 'p90Tx',    label: 'P90 (transakcje)',   numeric: true },
    { key: 'spread',   label: 'Rozwarstwienie',     numeric: true },
    { key: 'period',   label: 'Okres (od–do)' }
  ];

  // ---------- Konfiguracja: diagnostyka ----------
  // ERP renderuje DOM zależnie od uprawnień i konfiguracji widoku KONKRETNEGO
  // użytkownika: inne kolumny w siatkach, inne zakładki, czasem brak przycisku
  // akcji. Selektor działający na jednym koncie potrafi trafiać w nic na innym.
  // Bufor zbiera zrzuty struktury DOM w kluczowych momentach, żeby dało się
  // zdiagnozować cudzy komputer bez siedzenia przy nim.
  //
  // Skrypt nie ma dostępu do dysku, więc log NIE trafia do repo sam — zapisuje
  // się przez pobranie pliku (przycisk „Pobierz log" w panelu). Plik można
  // przesłać i wrzucić do katalogu diagnostyka/ ręcznie.
  const DIAGNOSTICS = {
    ENABLE: true,
    MAX_ENTRIES: 3000,
    // Zrzut HTML jest odcinany — chodzi o strukturę, nie o treść dokumentów.
    HTML_SNIPPET_CHARS: 1500
  };

  // ---------- Konfiguracja: stan katalogu po zakończeniu ----------
  // Po sprawdzeniu kandydatów wyszukiwarka katalogu zostaje z SKU ostatniego
  // z nich, co jest mylące — widok pokazuje przypadkowy produkt z rekomendacji,
  // nie ten, który analizowaliśmy. Przywracamy w niej anchora.
  const FINISH = {
    SEARCH_ANCHOR: true
  };

  // Separator listy SKU przekazywanej do generatora.
  const SKU_SEPARATOR = ',';

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
  // `scope` zawęża szukanie do panelu konkretnej zakładki. Przy wielokrotnym
  // otwieraniu i zamykaniu historii (odczyt cen dla listy produktów) w DOM
  // bywa więcej niż jeden panel filtrów, a bez zawężenia trafialiśmy w cudzy.
  function findFilterPanel(scope) {
    const root = scope || document;
    const panels = Array.from(root.querySelectorAll('.cs-layout-search-panel'))
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

  // Czy filtry naprawdę się ustawiły. Do v2.28.1 skrypt zakładał, że skoro
  // kliknął, to zadziałało — a gdy nie zadziałało, zbierał dane z domyślnego
  // zakresu i nikt tego nie widział.
  function filtersLookApplied(found) {
    if (!found) return false;
    const dateOk = /\d{4}-\d{2}-\d{2}/.test(found.dateInput.value || '');
    const radio = found.allLabel.closest('.csDBRadioGroupItem') || found.allLabel.parentElement;
    const input = radio ? radio.querySelector('input[type="radio"]') : null;
    const radioOk = input ? input.checked : true;
    return dateOk && radioOk;
  }

  async function setFilters(scope, startDate) {
    const found = await waitFor(() => findFilterPanel(scope));
    if (!found) {
      diag('BLAD', 'Nie znaleziono panelu filtrów' + (scope ? ' w panelu historii.' : '.'));
      describeDom('brak panelu filtrów');
      throw new Error('Nie znaleziono panelu z filtrami daty i radio.');
    }

    const { dateInput, allLabel } = found;

    const dp = unsafeWindow.jQuery(dateInput).data('kendoDatePicker');
    if (!dp) throw new Error('Brak instancji kendoDatePicker.');

    dp.value(startDate || HISTORY_START_DATE);
    dp.trigger('change');
    unsafeWindow.jQuery(dateInput).trigger('blur');
    await sleep(300);

    allLabel.click();

    // Czekamy na WIERSZE FAKTUR, nie na "jakikolwiek widoczny wiersz".
    // Poprzedni warunek spełniała natychmiast siatka katalogu, która w tym
    // momencie jest jeszcze widoczna — więc w praktyce nie czekał na nic
    // i zbieranie ruszało, zanim lista historii się przeładowała. Objaw:
    // pierwszy przebieg kończył się zerem, drugi (na gotowej już liście)
    // działał poprawnie.
    // Nowy produkt bez sprzedaży to poprawny przypadek, nie awaria — wtedy
    // pager pokazuje 0 rekordów i nie ma na co czekać. Zera nie ufamy od razu,
    // bo ERP zeruje licznik także na czas ładowania; dopiero po ~3 s uznajemy
    // je za odpowiedź serwera, a nie za stan przejściowy.
    let attempts = 0;
    const ready = await waitFor(() => {
      attempts++;
      if (getFaRows().length > 0) return true;
      return attempts > 10 && pagerRecordCount(getVisiblePager()) === 0;
    }, 40, 300);

    if (!ready) {
      diag('BLAD', 'Lista faktur nie załadowała się po ustawieniu filtrów. Pager: ' +
        describePager(getVisiblePager()));
      describeDom('lista faktur pusta po filtrach');
    }

    await sleep(500); // dodatkowy zapas na pełne wyrenderowanie

    if (!filtersLookApplied(found)) {
      diag('BLAD', 'Filtry nie przyjęły się: data="' + (found.dateInput.value || '') + '".');
      throw new Error('Filtry nie przyjęły się (data „' +
        (found.dateInput.value || 'puste') + '"). Dane z domyślnego zakresu ' +
        'byłyby niepełne, więc przerywam odczyt tego produktu.');
    }
  }

  // ---------- Krok 2: iteracja po fakturach FA ----------
  function visibleGridRows() {
    return Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
      .filter(row => row.offsetParent !== null);
  }

  // Siatka pozycji faktury. Wymagamy TYLKO kolumny Item (SKU) — to jedyna,
  // bez której nie da się nic policzyć. Wcześniej wymagany był też
  // PositionItemDesc, ale układ kolumn w tym ERP jest konfigurowany PER
  // UŻYTKOWNIK, więc na innym koncie brak tej kolumny blokował cały przebieg.
  function getVisibleInvoiceGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .find(t => t.offsetParent !== null
        && t.querySelectorAll('tr.cs-grid-data-row').length > 0
        && t.querySelector('td[data-datafield="Item"]')
        // Sama obecność kolumny Item nie wystarcza: LISTA HISTORII też ją ma,
        // obok DocNumber i danych kontrahenta. Bez tego wykluczenia funkcja
        // dopasowywała listę historii, zanim otworzyła się zakładka faktury —
        // wiersze listy trafiały do analizy jako "pozycje faktury", a przebieg
        // kończył się na jednym dokumencie. Pozycje faktury nie mają numeru
        // dokumentu ani kontrahenta w wierszu, bo to dane nagłówka.
        && !t.querySelector('td[data-datafield="DocNumber"]')
        && !t.querySelector('td[data-datafield="CustomerDesc"]'));
  }

  // Zrzut widocznych siatek do diagnozy — jakie kolumny faktycznie są dostępne.
  // ---------- Diagnostyka ----------
  const diagBuffer = [];
  let diagStarted = null;
  // Anchor zapamiętany na czas przebiegu. Raport czytał go z panelu filtrów,
  // który przy zapisie logu bywa już zamknięty — stąd „Produkt: nieznany"
  // w logach przysyłanych przez użytkowników.
  let diagAnchorSku = null;

  function diagStamp() {
    if (diagStarted === null) diagStarted = Date.now();
    return ((Date.now() - diagStarted) / 1000).toFixed(1) + 's';
  }

  function diag(tag, message) {
    if (!DIAGNOSTICS.ENABLE) return;
    if (diagBuffer.length >= DIAGNOSTICS.MAX_ENTRIES) return;
    diagBuffer.push('[' + diagStamp() + '] ' + tag + ': ' + message);
  }

  // Struktura, nie treść. Wypisujemy to, na czym opierają się selektory:
  // zakładki, siatki wraz z listą data-datafield, pager, wyszukiwarki.
  function describeDom(label) {
    if (!DIAGNOSTICS.ENABLE) return;
    const lines = ['--- ZRZUT DOM: ' + label + ' ---', 'URL: ' + location.href];

    const tabs = Array.from(document.querySelectorAll('li.k-item[aria-controls]'));
    lines.push('Zakładki k-item[aria-controls]: ' + tabs.length +
      ' (widocznych: ' + tabs.filter(li => li.offsetParent !== null).length + ')');
    tabs.forEach((li, i) => {
      const panel = document.getElementById(li.getAttribute('aria-controls'));
      const sig = panel ? panelLooksLikeCatalog(panel) : null;
      lines.push('  tab#' + i +
        ' widoczna=' + (li.offsetParent !== null) +
        ' aktywna=' + li.classList.contains('k-state-active') +
        ' etykieta="' + tabLabel(li).slice(0, 60) + '"' +
        ' panel=' + (panel ? 'jest' : 'BRAK') +
        (sig ? ' szukajka=' + sig.hasSearch + ' siatkaZeStanem=' + sig.hasStockGrid : ''));
    });

    const grids = Array.from(document.querySelectorAll('.cs-grid-data-table'));
    lines.push('Siatki .cs-grid-data-table: ' + grids.length);
    grids.forEach((t, i) => {
      const rows = t.querySelectorAll('tr.cs-grid-data-row');
      const row = rows[0] || t.querySelector('tbody tr');
      const fields = row
        ? Array.from(row.querySelectorAll('td[data-datafield]')).map(td => td.dataset.datafield)
        : [];
      lines.push('  siatka#' + i + ' widoczna=' + (t.offsetParent !== null) +
        ' wierszy=' + rows.length +
        ' przyciskAkcji=' + (t.querySelector('.csButtonAction') !== null) +
        ' kolumny=[' + fields.join(', ') + ']');
    });

    const pagers = Array.from(document.querySelectorAll('.csDataPager'));
    lines.push('Pagery: ' + pagers.length +
      (pagers.length ? ' | widoczny: ' + describePager(getVisiblePager()) : ''));
    lines.push('Wyszukiwarki .csDBEditSearch: ' +
      document.querySelectorAll('.csDBEditSearch input.Input').length);

    diag('DOM', lines.join('\n'));
  }

  // Awaryjnie: surowy HTML kontenera, gdy sam opis struktury nie wystarcza
  // do zrozumienia, czym różni się układ na innym koncie.
  function diagHtml(label, node) {
    if (!DIAGNOSTICS.ENABLE || !node) return;
    diag('HTML', label + ': ' +
      node.outerHTML.replace(/\s+/g, ' ').slice(0, DIAGNOSTICS.HTML_SNIPPET_CHARS));
  }

  function buildDiagReport(mainSku) {
    return [
      'Savpol Historia Faktur — log diagnostyczny',
      'Wersja skryptu: ' + (typeof GM_info !== 'undefined' && GM_info.script
        ? GM_info.script.version : 'nieznana'),
      'Produkt (anchor): ' + (mainSku || diagAnchorSku || 'nieznany'),
      'URL: ' + location.href,
      'User agent: ' + navigator.userAgent,
      'Wpisów: ' + diagBuffer.length +
        (diagBuffer.length >= DIAGNOSTICS.MAX_ENTRIES ? ' (bufor pełny, dalsze pominięte)' : ''),
      '',
      diagBuffer.join('\n')
    ].join('\n');
  }

  function downloadDiagReport(mainSku) {
    const blob = new Blob(['﻿' + buildDiagReport(mainSku)],
      { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'savpol_diagnostyka_' + (mainSku || 'produkt') + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Dostępne z konsoli, gdyby panel zniknął albo trzeba było zajrzeć w trakcie.
  unsafeWindow.savpolDiag = () => buildDiagReport(null);
  unsafeWindow.savpolDiagDownload = sku => downloadDiagReport(sku);

  function describeVisibleGrids() {
    const grids = Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .filter(t => t.offsetParent !== null);
    if (!grids.length) return '(brak widocznych siatek)';
    return grids.map((t, i) => {
      const row = t.querySelector('tr.cs-grid-data-row') || t.querySelector('tbody tr');
      const fields = row
        ? Array.from(row.querySelectorAll('td[data-datafield]')).map(td => td.dataset.datafield)
        : [];
      return '#' + (i + 1) + ' wierszy=' + t.querySelectorAll('tr.cs-grid-data-row').length
        + ' kolumny=[' + fields.join(', ') + ']';
    }).join(' || ');
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
  // Liczba rekordów wg pagera. `null`, gdy pager nie istnieje albo licznik jest
  // pusty (ERP zeruje go na czas ładowania) — wtedy nie wiemy jeszcze nic.
  function pagerRecordCount(pager) {
    if (!pager) return null;
    const e = pager.querySelector('.ResultsCountValue');
    if (!e) return null;
    const raw = (e.value || e.textContent || '').replace(/\s/g, '');
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

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
    let consecutiveFailures = 0;
    let warnedMissingNames = false;
    const processedDocs = new Set();
    let invoicesProcessed = 0;
    let pageNum = 1;

    while (invoicesProcessed < maxCount && pageNum <= MAX_PAGES) {
      throwIfAborted();

      // Siatka bywa w trakcie przeładowania — pusta strona to najczęściej
      // "jeszcze się ładuje", nie "nie ma faktur". Bez tej pauzy przebieg
      // kończył się zerem, mimo że sekundę później dane były na miejscu.
      if (pageNum === 1 && getFaRows().length === 0) {
        await waitFor(() => getFaRows().length > 0, 20, 300);
      }

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
        if (!row) {
          console.warn('Nie znaleziono wiersza dla', targetDoc);
          diag('BLAD', 'Nie znaleziono wiersza dla ' + targetDoc +
            ' (wierszy w widocznej siatce: ' + getFaRows().length + ')');
          continue;
        }

        processedDocs.add(targetDoc);

        const docNumberCell = row.querySelector('td[data-datafield="DocNumber"]');
        const btn = docNumberCell.querySelector('.csButtonAction');
        if (!btn) {
          console.warn('Brak przycisku dla', targetDoc);
          // Brak .csButtonAction bywa kwestią uprawnień — użytkownik widzi
          // dokument, ale nie ma prawa go otworzyć.
          diag('BLAD', 'Brak przycisku akcji dla ' + targetDoc);
          diagHtml('wiersz bez przycisku', row);
          continue;
        }

        btn.click();

        const grid = await waitFor(() => getVisibleInvoiceGrid());
        if (!grid) {
          consecutiveFailures++;
          console.error('[Savpol Historia Faktur] Nie udało się otworzyć faktury ' + targetDoc +
            '. Widoczne siatki: ' + describeVisibleGrids());
          diag('BLAD', 'Nie udało się otworzyć faktury ' + targetDoc +
            ' (porażka ' + consecutiveFailures + ')');
          // Pełny zrzut tylko przy pierwszej porażce — kolejne są jej skutkiem.
          if (consecutiveFailures === 1) describeDom('nieudane otwarcie faktury');

          // ODZYSKIWANIE. Bez tego jedna nieudana faktura kładła cały przebieg:
          // otwarta zakładka przykrywała listę historii, więc każdy kolejny
          // dokument kończył się "Nie znaleziono wiersza" i wynik był pusty.
          const stray = document.querySelector('li.k-state-active .csCloseButton_span');
          if (stray) stray.click();
          await waitFor(() => visibleGridRows().length > 0);
          await sleep(300);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error('[Savpol Historia Faktur] ' + consecutiveFailures +
              ' nieudanych otwarć z rzędu — przerywam zbieranie. Zebrano ' +
              invoicesProcessed + ' faktur.');
            return results;
          }
          continue;
        }
        if (invoicesProcessed === 0) describeDom('pierwsza faktura otwarta');
        consecutiveFailures = 0;
        await sleep(300);

        const docNumber = getActiveTabDocNumber() || targetDoc;
        const invoiceRows = extractInvoiceRows(docNumber);

        // Bez kolumny z nazwą produktu WSZYSTKIE reguły nazwowe przestają
        // działać po cichu — chłodnia i mroźnia trafiłyby do rekomendacji.
        if (!warnedMissingNames && invoiceRows.length && invoiceRows.every(r => !r.product)) {
          warnedMissingNames = true;
          console.error('[Savpol Historia Faktur] Pozycje faktur nie mają nazw produktów ' +
            '(brak kolumny PositionItemDesc w tej siatce). Wykluczenia nazwowe NIE zadziałają — ' +
            'dodaj kolumnę z opisem pozycji w konfiguracji widoku. Kolumny: ' + describeVisibleGrids());
        }
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
        diag('BLAD', 'Paginacja stanęła. Zebrano ' + invoicesProcessed +
          ' faktur. Pager: ' + describePager(getVisiblePager()));
        describeDom('zablokowana paginacja');
        break;
      }
      pageNum++;
    }

    return results;
  }

  // Opakowanie łapiące przerwanie — zwraca { rows, aborted }.
  async function collectAllInvoicesInterruptible(maxCount, onProgress) {
    const collected = [];
    // Ile wierszy faktur w ogóle zobaczyliśmy na listach. Rozstrzyga różnicę
    // między „produkt nie ma sprzedaży" (0 wierszy — poprawny wynik) a „nie
    // umiem odczytać pozycji" (wiersze były, nic z nich nie wyszło — awaria).
    const faSeen = getFaRows().length;
    try {
      const rows = await collectAllInvoices(maxCount, onProgress, collected);
      return { rows, aborted: false, faSeen: Math.max(faSeen, getFaRows().length) };
    } catch (err) {
      if (err && err.isAbort) {
        console.warn(`[Savpol Historia Faktur] Przerwano — zachowuję ${collected.length} zebranych pozycji.`);
        return { rows: collected, aborted: true, faSeen };
      }
      throw err;
    }
  }

  // ---------- Krok 3: CSV ----------
  function buildHistoryCsv(data) {
    const header = 'Numer dokumentu;Produkt;SKU;Ilość\n';
    const body = data.map(r =>
      `"${r.doc}";"${r.product}";"${r.sku}";"${r.qty}"`
    ).join('\n');
    return header + body;
  }

  function downloadCSV(data, mainSku) {
    const csv = buildHistoryCsv(data);
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
    // BEZ zapasowego przeszukiwania całego dokumentu. Gdy nie wiemy, który
    // panel jest katalogiem, lepiej nie wpisać nic niż wpisać SKU w pierwsze
    // widoczne pole wyszukiwania — tak trafiało ono w „Handlowiec" na pulpicie
    // celów sprzedażowych, wyprowadzając skrypt z katalogu.
    const panel = getCatalogPanel();
    if (!panel) return null;
    const widget = Array.from(panel.querySelectorAll('.csDBEditSearch'))
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
        describeDom('brak zakładki katalogu');
        throw new Error('Nie udało się wrócić na zakładkę "Katalog" — przerywam, ' +
          'żeby nie wpisywać SKU w widoku historii faktur.');
      }
    }

    const input = await waitFor(findVisibleCatalogSearchInput);
    if (!input) {
      // Zapamiętana zakładka mogła zostać zamknięta albo przerysowana.
      // Kasujemy ją, żeby następna próba rozpoznała katalog od nowa zamiast
      // trzymać się nieistniejącego panelu.
      knownCatalogPanelId = null;
      diag('BLAD', 'Brak pola wyszukiwania w panelu katalogu.');
      throw new Error('Nie znaleziono pola wyszukiwania katalogu.');
    }
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
  // Siatka historii sprzedaży ma kolumnę `Item` DOKŁADNIE TAK JAK katalog, więc
  // „panel z wyszukiwarką i kolumną Item" opisuje oba. Rozstrzyga `DocNumber`:
  // historia jest listą dokumentów i go ma, katalog jest listą kartotek i nie ma.
  //
  // Bez tego rozróżnienia, gdy zakładka katalogu została zamknięta, skrypt
  // uznawał historię za katalog i wpisywał w jej wyszukiwarkę kolejne produkty.
  function panelLooksLikeHistory(panel) {
    return panel.querySelector('td[data-datafield="DocNumber"]') !== null;
  }

  function panelLooksLikeCatalog(panel) {
    const hasSearch = panel.querySelector('.csDBEditSearch input.Input') !== null;
    const hasStockGrid = Array.from(panel.querySelectorAll('.cs-grid-data-table'))
      .some(t => t.querySelector('td[data-datafield="QStockAv"]'));
    const isHistory = panelLooksLikeHistory(panel);
    return {
      hasSearch,
      hasStockGrid,
      isHistory,
      score: (hasSearch ? 2 : 0) + (hasStockGrid ? 2 : 0) - (isHistory ? 4 : 0)
    };
  }

  // Raz rozpoznany panel katalogu zapamiętujemy po aria-controls.
  //
  // Powód: sygnatura katalogu opiera się na kolumnie stanu w siatce, a przy
  // wyszukiwaniu z ZEREM WYNIKÓW nie ma żadnej komórki, więc sygnatura znika.
  // Skrypt spadał wtedy do reguły zapasowej i brał PIERWSZEGO kandydata
  // z wyszukiwarką — czyli zakładkę najbardziej z lewej (panel sterowania).
  // Efekt: kolejne nazwy wpisywane w pole „Handlowiec" na pulpicie, wyjście
  // z katalogu i zablokowany przebieg.
  let knownCatalogPanelId = null;

  function rememberCatalogTab(tab) {
    const id = tab && tab.getAttribute('aria-controls');
    if (id) knownCatalogPanelId = id;
    return tab;
  }

  function findCatalogTabLi() {
    const candidates = listTabCandidates();

    // 0. Zakładka rozpoznana wcześniej w tym przebiegu. Pusty wynik
    //    wyszukiwania nie odbiera jej tożsamości.
    if (knownCatalogPanelId) {
      const known = candidates.find(t => t.li.getAttribute('aria-controls') === knownCatalogPanelId);
      // Weryfikujemy nawet zapamiętaną zakładkę: ERP potrafi przerysować panel
      // pod tym samym id, a wtedy pamięć wskazywałaby na coś innego.
      if (known && !isHistoryTab(known.li)) return known.li;
      if (known) knownCatalogPanelId = null;
    }

    // 1. Panel z pełną sygnaturą katalogu.
    const full = candidates.find(t => {
      const m = panelLooksLikeCatalog(t.panel);
      return m.hasSearch && m.hasStockGrid && !isHistoryTab(t.li);
    });
    if (full) return rememberCatalogTab(full.li);

    // 2. Panel z wyszukiwarką i siatką produktów. Wymagamy kolumny `Item`,
    //    a nie „jakiejkolwiek siatki" — siatkę ma też pulpit z celami
    //    sprzedażowymi i przy pustym wyniku wygrywał, bo jest pierwszy.
    //    Historię odrzucamy jawnie: też ma `Item`.
    const partial = candidates.find(t =>
      t.panel.querySelector('.csDBEditSearch input.Input') !== null
      && t.panel.querySelector('td[data-datafield="Item"]') !== null
      && !isHistoryTab(t.li));
    if (partial) return rememberCatalogTab(partial.li);

    // 3. Ostatnia deska ratunku: etykieta. Zostawiona, bo gdy panel jest jeszcze
    //    niezaładowany, nazwa to jedyna wskazówka. Karty produktu ("Katalog: X")
    //    odrzucamy jawnie.
    const byLabel = candidates.find(t => /^katalog$/i.test(tabLabel(t.li)));
    return byLabel ? rememberCatalogTab(byLabel.li) : null;
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

  // ---------- Lista SKU dla generatora ----------
  // Do v2.22.0 lista trafiała też do schowka — została po czasach, gdy była
  // głównym wynikiem pracy i przepisywało się ją ręcznie. Generator dostaje ją
  // dziś w URL, więc zapis do schowka tylko nadpisywał ludziom zawartość.
  function skusToText(candidates) {
    return candidates.map(c => (c.sku || '').trim()).filter(Boolean).join(SKU_SEPARATOR);
  }

  // Wynik wypisujemy w konsoli niezależnie od tego, co zrobi generator —
  // to jedyny ślad, gdyby otwarcie karty zawiodło.
  function reportSkus(candidates) {
    const text = skusToText(candidates);
    if (!text) {
      console.warn('[Cross-sell] Brak SKU do przekazania.');
      return text;
    }
    console.log('%c[Cross-sell] SKU do cross-sellingu:', 'font-weight:bold');
    console.log(text);
    return text;
  }

  // Otwiera generator PDP z anchorem i listą cross-sell w URL.
  // Poza SKU generator dostaje FAKTY o danych, nie ocenę:
  //   invoices=N — na ilu fakturach oparta jest rekomendacja (0 = brak historii)
  //   group=…    — grupa produktu z katalogu ERP, materiał pomocniczy
  //
  // Świadomie nie wysyłamy flagi „niepewne". Próg, poniżej którego wynik uchodzi
  // za słaby, trzyma generator — inaczej jego zmiana wymagałaby aktualizacji
  // skryptu u każdego pracownika z osobna.
  function openGenerator(anchorSku, skusText, hints) {
    const cross = (skusText || '')
      .split(/[\s,;]+/)
      .map(x => x.trim())
      .filter(Boolean)
      .join(',');

    const url = GENERATOR.URL
      + '?sku=' + encodeURIComponent(anchorSku)
      + (cross ? '&cross=' + encodeURIComponent(cross) : '')
      + (hints && typeof hints.invoices === 'number'
        ? '&invoices=' + hints.invoices : '')
      + (hints && hints.group ? '&group=' + encodeURIComponent(hints.group) : '');

    // GM_openInTab omija blokadę popupów; window.open jako zapas, gdyby
    // uprawnienie nie zostało przyznane po aktualizacji skryptu.
    if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true });
    else window.open(url, '_blank');
    console.log('[Cross-sell] Otwieram generator PDP:', url);
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
      button.textContent = '⏹️ Przerywam...';
      return;
    }

    const originalText = ORIGINAL_BUTTON_TEXT;
    ABORT.running = true;
    ABORT.requested = false;
    const ui = PROGRESS.ENABLE ? createProgressOverlay() : noopProgress();
    diagBuffer.length = 0;
    diagStarted = Date.now();
    describeDom('start przebiegu');
    try {
      ui.phase('📂 Otwieram historię produktu...');
      button.textContent = '📂 Otwieram historię...';
      const opened = openHistory();
      if (!opened) {
        describeDom('brak przycisku "Historia produktu"');
        throw new Error('Nie znaleziono przycisku "Historia produktu". Czy produkt jest zaznaczony?');
      }
      await sleep(500);

      const mainSku = await waitFor(getMainProductSku);
      diagAnchorSku = mainSku;
      ui.detail('Produkt: ' + (mainSku || '?') + '. To potrwa około 3 minut.');

      // Przy trzech osobach bez koordynacji łatwo zrobić ten sam produkt dwa
      // razy, a przebieg trwa kilka minut. Pytamy, zamiast decydować za
      // operatora: przebieg przerwany albo bez weryfikacji warto powtórzyć.
      const known = await checkHistoryExists(mainSku);
      if (known && known.exists) {
        const warto = known.partial || known.unverified;
        const opis = 'Ten produkt ktoś już sprawdzał ' +
          formatCollectedAt(known.collectedAt) + ' (faktur: ' +
          (known.invoices || '?') + ').' +
          (warto
            ? '\n\nTamto sprawdzanie nie doszło do końca, więc warto je powtórzyć.'
            : '\n\nWyniki są gotowe, nie musisz robić tego jeszcze raz.') +
          '\n\nSprawdzić jeszcze raz? Zajmie to około 3 minut.';
        if (!confirm(opis)) {
          ui.finish('Ten produkt jest już zrobiony', false);
          ui.detail('Sprawdzony ' + formatCollectedAt(known.collectedAt) +
            '. Gotowe numery znajdziesz w generatorze opisów.');
          button.textContent = '✅ Już zrobione';
          setTimeout(() => { button.textContent = originalText; }, 3000);
          await closeHistoryTab(null);
          return;
        }
      }

      ui.phase('Ustawiam zakres: wszystkie faktury od 1 stycznia 2024...');
      button.textContent = '⚙️ Ustawiam filtry...';
      await setFilters();

      ui.phase('Czytam faktury tego produktu...');
      button.textContent = '📄 Pobieram faktury...';
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

      // Zero pozycji ma dwie zupełnie różne przyczyny i nie wolno ich mylić:
      //
      //   brak wierszy faktur  → produkt nigdy się nie sprzedał. To POPRAWNY
      //                          wynik, od v2.18.0 pełnoprawna ścieżka: opis
      //                          powstaje na regułach kategorii w generatorze.
      //   wiersze były, ale nic
      //   z nich nie wyszło    → awaria odczytu (np. brak kolumny Item
      //                          w konfiguracji widoku tego użytkownika).
      //
      // Do v2.20.0 oba przypadki kończyły się błędem i pierwszy produkt bez
      // sprzedaży wysypywał skrypt.
      if (data.length === 0 && collect.faSeen > 0) {
        throw new Error('Nie odczytano żadnej pozycji faktury, mimo że na liście ' +
          'było ' + collect.faSeen + ' dokumentów. Najczęstsza przyczyna: siatka ' +
          'pozycji nie ma kolumny "Item" (SKU) w konfiguracji widoku tego ' +
          'użytkownika. Zobacz w konsoli listę kolumn przy komunikacie ' +
          'o nieudanym otwarciu faktury.');
      }
      // Dalsze etapy mają już przebiegać do końca — inaczej sam fakt przerwania
      // ubiłby analizę, dla której faktury właśnie zebraliśmy.
      ABORT.requested = false;

      ui.phase(partial
        ? 'Zatrzymane — liczę na tym, co zdążyłem przeczytać...'
        : 'Szukam produktów kupowanych razem z tym...');
      ui.detail('Przeczytane: ' + new Set(data.map(r => r.doc)).size + ' faktur, ' +
        data.length + ' pozycji');
      let anchorGroup = null;
      const analysis = analyzeCrossSell(data, mainSku);
      analysis.partial = partial;

      // Etykiety dla komunikatu, nie decyzja — patrz komentarz przy MIN_INVOICES.
      analysis.tooFewInvoices = analysis.N < CROSS_SELL.MIN_INVOICES;
      analysis.lowConfidence = !analysis.tooFewInvoices &&
        analysis.N < CROSS_SELL.LOW_CONFIDENCE_BELOW;

      logAnalysis(analysis);

      let historyTabLi = null;

      // Brak kandydatów: nie ma czego sprawdzać w katalogu, ale odczytujemy
      // GRUPĘ produktu. Generator ustala kategorię sam z danych sklepu, więc
      // to tylko materiał pomocniczy — grupa z ERP bywa dokładniejsza niż
      // hierarchia w sklepie i nic nie kosztuje, skoro i tak tam wchodzimy.
      // Rozgałęziamy po tym, CZY SĄ kandydaci, nie po progu: przy 12 fakturach
      // i jednym kandydacie nadal chcemy sprawdzić jego dostępność.
      if (!analysis.candidates.length) {
        historyTabLi = document.querySelector('li.k-state-active');
        ui.phase('Sprawdzam kategorię produktu...');
        button.textContent = '🔎 Sprawdzam kategorię...';
        try {
          if (await switchToCatalogTab()) {
            const item = await lookupCatalogItem(mainSku);
            anchorGroup = item ? item.group : null;
            console.log('[Cross-sell] Za mało faktur (' + analysis.N + '). ' +
              'Grupa anchora: ' + (anchorGroup || 'nieodczytana'));
          }
        } catch (err) {
          console.warn('[Cross-sell] Nie odczytałem grupy anchora:', err && err.message || err);
        }
      } else if (AVAILABILITY.ENABLE) {
        historyTabLi = document.querySelector('li.k-state-active'); // zapamiętane PRZED przejściem do katalogu
        ui.phase('Sprawdzam, czy te produkty są dostępne...');
        button.textContent = '🔎 Sprawdzam dostępność...';

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
          ui.phase('Wracam do produktu, od którego zaczęliśmy...');
          button.textContent = '↩️ Przywracam widok katalogu...';
          await searchAnchorInCatalog(mainSku);
        }
      }

      if (EXPORT_RAW_HISTORY) {
        downloadCSV(data, mainSku);
        await sleep(300); // przeglądarki gubią drugi download bez odstępu
      }

      if (EXPORT_CROSS_SELL_CSV) downloadCrossSellCSV(analysis);

      // Do kolejki trafia też przebieg bez kandydatów: sam fakt, że sygnał był
      // zbyt słaby, jest wynikiem — bez zapisu ktoś powtórzy tę samą robotę.
      queueHistoryUpload(mainSku, data, analysis, partial);
      const upload = await flushHistoryQueue();

      const skusText = reportSkus(analysis.candidates);

      // Rozstrzyga BRAK KANDYDATÓW, nie próg — przy 12 fakturach i jednym
      // kandydacie mamy co pokazać, a o wiarygodności rozstrzyga generator.
      if (!analysis.candidates.length && analysis.tooFewInvoices) {
        ui.finish(analysis.N === 0
          ? 'Ten produkt nie ma jeszcze sprzedaży'
          : 'Za mało sprzedaży, żeby coś policzyć', false);
        ui.detail((analysis.N === 0
          ? 'Nie znalazłem ani jednej faktury z tym produktem — to normalne ' +
            'przy nowościach. '
          : `Ten produkt ma tylko ${analysis.N} faktur — za mało, żeby ` +
            'wiarygodnie stwierdzić, co się z nim kupuje. ') +
          'Kliknij „Otwórz generator opisów": zaproponuje produkty ' +
          'na podstawie kategorii.');
        // Lista SKU jest pusta, ale przycisk generatora ma się pokazać —
        // to teraz jedyna droga dalej dla tego produktu.
        ui.result(' ', mainSku, { group: anchorGroup, invoices: analysis.N });
        button.textContent = '🆕 Nowy produkt — użyj generatora';
      } else if (analysis.weakSignal) {
        ui.finish('Brak propozycji dla tego produktu', false);
        ui.detail(`Sprawdziłem ${analysis.N} faktur i żaden produkt nie powtarza się ` +
          'w nich dość często, żeby go polecać. To normalne — ten produkt ' +
          'po prostu nie ma stałych towarzyszy. Zrób opis bez tej sekcji.');
        button.textContent = '🤷 Brak propozycji';
      } else {
        const clean = !partial && !analysis.unverified;
        ui.finish(`Gotowe — ${analysis.candidates.length} propozycji`, clean);
        ui.result(skusText, mainSku, {
          invoices: analysis.N,
          group: anchorGroup
        });
        if (analysis.unverified) {
          ui.detail('Nie udało mi się sprawdzić dostępności, więc mogą tu być ' +
            'produkty niedostępne lub niewysyłkowe. Zobacz konsolę.');
        } else if (analysis.lowConfidence) {
          ui.detail(`Wynik z ${analysis.N} faktur — to niedużo, więc potraktuj go ` +
            'jako podpowiedź, nie pewnik. Zerknij, czy te produkty pasują ' +
            'do siebie, zanim użyjesz ich w opisie.');
        } else if (partial) {
          ui.detail(`Zatrzymane w trakcie — wynik z ${analysis.N} faktur zamiast z wszystkich. ` +
            'Możesz go użyć, ale pełne sprawdzenie dałoby pewniejszą listę.');
        } else {
          ui.detail(`Znalezione na podstawie ${analysis.N} faktur. ` +
            'Kliknij „Otwórz generator opisów" — dostanie te numery od razu.');
        }
        button.textContent = `✅ Gotowe: ${skusText}`;
      }
      await sleep(2500);

      await closeHistoryTab(AVAILABILITY.ENABLE ? historyTabLi : null);

      // Log MUSI odnotować także przebieg udany. Bez tego wpis kończy się na
      // „pierwsza faktura otwarta" i po logu nie da się orzec, czy praca się
      // udała, czy urwała w połowie — dokładnie taki log dostaliśmy od
      // użytkowniczki i nie dało się z niego nic wywnioskować.
      diag('KONIEC', 'Przebieg zakończony. Faktur: ' + analysis.N +
        ', kandydatów: ' + analysis.candidates.length +
        (analysis.unverified ? ', BEZ weryfikacji w katalogu' : '') +
        (partial ? ', próba przerwana' : '') +
        '. Archiwum: wysłano ' + upload.sent + ', w kolejce ' + upload.left + '.');

      if (upload.left) {
        ui.detail('Uwaga: wyniki nie zapisały się w archiwum (' + upload.left +
          ' w kolejce). Zaloguj się w generatorze opisów — wyślą się same ' +
          'przy następnym uruchomieniu.');
      }

      button.textContent = originalText;
    } catch (err) {
      if (err && err.isAbort) {
        // Przerwanie użytkownika — świadomie NIE eksportujemy nic. Wynik
        // z niepełnej próby wyglądałby jak normalna rekomendacja, a nie jest.
        console.warn('[Savpol Historia Faktur] Przerwano przez użytkownika.');
        diag('KONIEC', 'Przerwane przez użytkownika przed policzeniem wyniku.');
        ui.finish('⏹️ Zatrzymane', false);
        ui.detail('Zatrzymane, zanim cokolwiek policzyłem — nic nie zostało zapisane. ' +
          'Możesz uruchomić od nowa.');
        button.textContent = '⏹️ Przerwano';
      } else {
        console.error('[Savpol Historia Faktur] Błąd:', err);
        diag('BLAD', 'Przebieg zakończony błędem: ' + String(err && err.message || err));
        describeDom('błąd przebiegu');
        ui.finish('⚠️ Coś poszło nie tak', false);
        ui.detail('Nie udało się dokończyć. Kliknij „Zapisz szczegóły błędu" ' +
          'i wyślij plik osobie, która opiekuje się skryptem. Szczegóły: ' +
          String(err && err.message || err));
        button.textContent = '⚠️ Coś poszło nie tak';
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
      '  <strong style="flex:1;font-size:13px">Szukam produktów do opisu</strong>',
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
      '<button data-role="diag" type="button" style="width:100%;margin-top:8px;cursor:pointer;',
      '    font:inherit;font-size:11px;padding:4px 8px;border:1px solid rgba(255,255,255,.2);',
      '    border-radius:4px;background:transparent;color:#f5f7fa;opacity:.65">Zapisz szczegóły błędu</button>',
      // Pole z listą SKU i przycisk „Kopiuj" usunięte w v2.19.0, zapis do
      // schowka w v2.22.0 — generator dostaje numery w URL, a w konsoli zostaje
      // ślad na wypadek, gdyby otwarcie karty zawiodło.
      '<div data-role="resultbox" style="display:none;margin-top:10px;padding-top:10px;',
      '    border-top:1px solid rgba(255,255,255,.15)">',
      '  <button data-role="gen" type="button" style="display:none;width:100%;',
      '      cursor:pointer;font:inherit;font-size:12px;padding:7px 10px;border:0;border-radius:4px;',
      '      background:#36b37e;color:#04231a;font-weight:600">Otwórz generator opisów</button>',
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
    // Anchora podaje pipeline (patrz result()); deklaracja przed nasłuchami,
    // bo odwołują się do niej w domknięciu.
    let resultAnchorSku = null;
    let resultHints = null;
    let resultSkus = '';
    el('close').addEventListener('click', removeProgressOverlay);

    // Log struktury DOM do pliku. Skrypt nie ma dostępu do dysku poza pobraniem,
    // więc plik trafia do Pobranych i przesyła go człowiek.
    el('diag').addEventListener('click', () => {
      downloadDiagReport(resultAnchorSku || getMainProductSku());
      el('diag').textContent = 'Zapisane — wyślij ten plik';
      setTimeout(() => { el('diag').textContent = 'Zapisz szczegóły błędu'; }, 2500);
    });
    // getMainProductSku() czyta panel filtrów widoku historii, który w tym
    // momencie jest już zamknięty, więc jest tu wyłącznie zapasem.

    el('gen').addEventListener('click', () => {
      const anchor = resultAnchorSku || getMainProductSku();
      if (!anchor) {
        el('detail').textContent = 'Nie odczytałem numeru produktu — otwórz ' +
          'generator opisów ręcznie. Numery są wypisane w konsoli przeglądarki.';
        console.warn('[Cross-sell] Brak SKU anchora, nie otwieram generatora.');
        return;
      }
      openGenerator(anchor, resultSkus, resultHints);
      el('gen').textContent = 'Otwarte w nowej karcie';
      setTimeout(() => { el('gen').textContent = 'Otwórz generator opisów'; }, 2500);
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
      // Pokazuje przycisk otwarcia generatora i zapamiętuje, z czym go otworzyć.
      result(text, anchorSku, hints) {
        if (!text) return;
        resultHints = hints || null;
        resultSkus = text.trim();
        el('resultbox').style.display = 'block';
        resultAnchorSku = anchorSku || null;
        if (GENERATOR.ENABLE && (resultAnchorSku || getMainProductSku())) {
          el('gen').style.display = 'block';
        }
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

  // ---------- Historia faktur do repo ----------
  function generatorOrigin() {
    try { return new URL(GENERATOR.URL).origin; } catch (e) { return null; }
  }

  function readQueue() {
    const raw = gmGet(HISTORY_UPLOAD.QUEUE_KEY, null);
    if (!raw) return [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[Savpol] Kolejka historii nieczytelna — zaczynam od zera.');
      return [];
    }
  }

  function writeQueue(queue) {
    gmSet(HISTORY_UPLOAD.QUEUE_KEY, JSON.stringify(queue));
  }

  // Wynik przebiegu ląduje w kolejce, nie leci od razu — z ERP wysyłka byłaby
  // cross-origin, a ciasteczko sesji generatora i tak by nie pojechało.
  function queueHistoryUpload(sku, data, analysis, partial) {
    if (!HISTORY_UPLOAD.ENABLE || !sku || !data.length) return;
    const queue = readQueue().filter(item => item.sku !== sku);   // ponowny przebieg zastępuje stary
    queue.push({
      sku,
      csv: buildHistoryCsv(data),
      meta: {
        invoices: analysis.N,
        partial: !!partial,
        unverified: !!analysis.unverified,
        tooFewInvoices: !!analysis.tooFewInvoices,
        lowConfidence: !!analysis.lowConfidence,
        candidates: analysis.candidates.map(c => c.sku),
        scriptVersion: typeof GM_info !== 'undefined' && GM_info.script
          ? GM_info.script.version : null,
        collectedAt: new Date().toISOString()
      }
    });
    // Najstarsze wypadają pierwsze — świeższe dane są cenniejsze.
    writeQueue(queue.slice(-HISTORY_UPLOAD.MAX_QUEUED));
    console.log('[Savpol] Historia ' + sku + ' czeka na wysyłkę do repo (w kolejce: ' +
      Math.min(queue.length, HISTORY_UPLOAD.MAX_QUEUED) + ').');
  }

  // Sprawdzenie, czy ktoś już zrobił ten produkt. Wołane z ERP, więc
  // cross-origin — stąd GM_xmlhttpRequest, który omija CORS i dowozi
  // ciasteczko sesji generatora. Zwykły fetch zostałby tu zablokowany.
  function checkHistoryExists(sku) {
    return new Promise(resolve => {
      if (!HISTORY_UPLOAD.ENABLE || typeof GM_xmlhttpRequest !== 'function' || !sku) {
        resolve(null);
        return;
      }
      const origin = generatorOrigin();
      if (!origin) { resolve(null); return; }

      GM_xmlhttpRequest({
        method: 'GET',
        url: origin + HISTORY_UPLOAD.ENDPOINT + '?sku=' + encodeURIComponent(sku),
        timeout: 8000,
        onload: res => {
          try {
            const body = JSON.parse(res.responseText);
            resolve(body && body.ok ? body : null);
          } catch (e) { resolve(null); }
        },
        // Każda awaria sprawdzenia jest nieistotna: to udogodnienie, nie warunek
        // pracy. Cisza i przebieg leci dalej.
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });
  }

  function formatCollectedAt(iso) {
    if (!iso) return 'nieznana data';
    const d = new Date(iso);
    return isNaN(d) ? 'nieznana data' : d.toLocaleDateString('pl-PL');
  }

  // Wysyłka ze strony generatora. Uruchamiana raz, po załadowaniu.
  // Jedno żądanie POST. GM_xmlhttpRequest, a nie fetch, bo lecimy z erp.savpol.pl
  // do innej domeny: zwykły fetch byłby zablokowany przez CORS. Tampermonkey
  // dokłada ciasteczka domeny docelowej, więc sesja generatora jedzie z żądaniem
  // — dokładnie tak, jak działa sprawdzanie duplikatu.
  function postHistoryItem(item) {
    return new Promise(resolve => {
      const origin = generatorOrigin();
      if (!origin || typeof GM_xmlhttpRequest !== 'function') {
        resolve({ status: 0, body: {} });
        return;
      }
      GM_xmlhttpRequest({
        method: 'POST',
        url: origin + HISTORY_UPLOAD.ENDPOINT,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ sku: item.sku, csv: item.csv, meta: item.meta }),
        timeout: 30000,
        onload: res => {
          let body = {};
          try { body = JSON.parse(res.responseText); } catch (e) { /* nieistotne */ }
          resolve({ status: res.status, body });
        },
        onerror: () => resolve({ status: 0, body: {} }),
        ontimeout: () => resolve({ status: 0, body: {} })
      });
    });
  }

  // Wysyłka idzie prosto z ERP, zaraz po przebiegu. Wcześniej czekała na
  // otwarcie generatora (żeby żądanie było same-origin) i przez to potrafiła
  // nie dojść do skutku w ogóle — kolejka rosła, a użytkownik nie miał jak się
  // o tym dowiedzieć. Skoro sprawdzanie duplikatu działa tą samą drogą,
  // czekanie było niepotrzebnym ryzykiem.
  async function flushHistoryQueue() {
    if (!HISTORY_UPLOAD.ENABLE) return { sent: 0, left: 0 };
    let queue = readQueue();
    if (!queue.length) return { sent: 0, left: 0 };

    console.log('[Savpol] Wysyłam historie: ' + queue.map(i => i.sku).join(', '));

    const sent = [];
    for (const item of queue) {
      const { status, body } = await postHistoryItem(item);

      if (status === 200 && body.ok) {
        sent.push(item.sku);
        console.log('[Savpol] Zapisano ' + item.sku + ' → ' + body.path);
        continue;
      }

      // 401 to wygasła sesja, nie błąd danych. Zostawiamy WSZYSTKO w kolejce
      // i przerywamy — po zalogowaniu w generatorze pójdzie za jednym razem.
      if (status === 401) {
        console.warn('[Savpol] Sesja generatora wygasła — historie czekają w kolejce. ' +
          'Zaloguj się w generatorze opisów, wyślą się przy następnym przebiegu.');
        break;
      }

      // 400 i 413 to trwałe odrzucenie danych — ponawianie nic nie da,
      // a wpis blokowałby kolejkę w nieskończoność.
      if (status === 400 || status === 413) {
        sent.push(item.sku);
        console.error('[Savpol] Serwer odrzucił historię ' + item.sku + ' (' + status +
          ': ' + (body.error || 'bez opisu') + '). Usuwam z kolejki.');
        continue;
      }

      console.warn('[Savpol] Nie udało się wysłać ' + item.sku +
        ' (status ' + status + ') — zostaje w kolejce, spróbuję przy następnym przebiegu.');
      break;
    }

    if (sent.length) {
      queue = readQueue().filter(item => !sent.includes(item.sku));
      writeQueue(queue);
    }
    return { sent: sent.length, left: readQueue().length };
  }

  // ---------- Przejście do produktu w sklepie ----------
  // GM_setValue/GM_getValue przeżywają przeładowanie strony i przejście na inną
  // domenę, czego nie robi sessionStorage. Stąd nimi przekazujemy SKU.
  function gmSet(key, value) {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  }
  function gmGet(key, fallback) {
    return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
  }

  // SKU produktu, który chcemy otworzyć w sklepie.
  //
  // Kolejność źródeł wynika z tego, jak ten widok jest naprawdę używany:
  // do katalogu wpisuje się SKU w wyszukiwarkę i patrzy na wynik. To pole
  // jest więc najpewniejszym źródłem — pewniejszym niż zaznaczenie wiersza,
  // bo ERP oznacza zaznaczenie różnie zależnie od widoku i wcale nie musi
  // być żadne.
  function getSelectedCatalogSku() {
    // 1. Wyszukiwarka katalogu, o ile wpisano w nią SKU, a nie nazwę.
    const input = findVisibleCatalogSearchInput();
    const typed = input && (input.value || '').trim();
    if (typed && EXCLUSIONS.skuPattern.test(typed)) return typed;

    // 2. Zaznaczony wiersz siatki — kilka wariantów oznaczenia.
    const rows = Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
      .filter(r => r.offsetParent !== null);
    const selected = rows.find(r =>
      r.classList.contains('k-state-selected') ||
      r.classList.contains('selected') ||
      r.classList.contains('csSelectedRow') ||
      r.getAttribute('aria-selected') === 'true');
    const fromRow = r => {
      const cell = r && r.querySelector('td[data-datafield="Item"]');
      const sku = cell && (cell.getAttribute('title') || cell.textContent);
      return sku && sku.trim() ? sku.trim() : null;
    };
    if (selected) {
      const sku = fromRow(selected);
      if (sku) return sku;
    }

    // 3. Jeden wynik na liście nie pozostawia wątpliwości, o który produkt chodzi.
    const grid = getVisibleCatalogGrid();
    const gridRows = grid
      ? Array.from(grid.querySelectorAll('tr.cs-grid-data-row'))
      : [];
    if (gridRows.length === 1) {
      const sku = fromRow(gridRows[0]);
      if (sku) return sku;
    }

    // 4. Panel filtrów widoku historii — działa tylko wtedy, gdy historia
    //    jest otwarta, więc zostaje na końcu.
    return getMainProductSku();
  }

  function openInEsavpol(sku) {
    gmSet(ESAVPOL.PENDING_KEY, sku);
    const url = ESAVPOL.SEARCH_URL(sku);
    if (typeof GM_openInTab === 'function') GM_openInTab(url, { active: true });
    else window.open(url, '_blank');
  }

  // ---------- Strona sklepu: klik w kartę z dokładnie tym SKU ----------
  // Karta nie ma osobnego pola z SKU, więc dopasowujemy po treści całej karty,
  // z granicą cyfrową — inaczej 123456 trafiłoby w 1234567.
  function findEsavpolProductHref(sku) {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const exactRe = new RegExp('(^|[^0-9])' + sku.replace(/[^0-9A-Za-z-]/g, '') + '([^0-9]|$)');
    let firstCandidate = null;
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || !ESAVPOL.PRODUCT_LINK_RE.test(href)) continue;
      if (!firstCandidate) firstCandidate = href;
      const card = a.closest('li, article, div') || a;
      if (exactRe.test(card.textContent)) return { href: location.origin + href, exact: true };
    }
    return firstCandidate ? { href: location.origin + firstCandidate, exact: false } : null;
  }

  function runEsavpolHandler(attempt) {
    const sku = gmGet(ESAVPOL.PENDING_KEY, null);
    if (!sku) return;

    // Jesteśmy już na karcie produktu — zadanie wykonane, czyścimy znacznik,
    // żeby kolejne wejście na sklep nie przeskakiwało samo z siebie.
    if (!/[?&]searchtext=/.test(location.search)) {
      gmSet(ESAVPOL.PENDING_KEY, null);
      return;
    }

    const hit = findEsavpolProductHref(sku);
    if (hit) {
      gmSet(ESAVPOL.PENDING_KEY, null);
      if (!hit.exact) {
        console.warn('[Savpol] Brak karty z dokładnym SKU ' + sku +
          ' — otwieram pierwszy wynik wyszukiwania.');
      }
      location.href = hit.href;
      return;
    }

    if (attempt < ESAVPOL.MAX_ATTEMPTS) {
      setTimeout(() => runEsavpolHandler(attempt + 1), ESAVPOL.RETRY_MS);
      return;
    }
    gmSet(ESAVPOL.PENDING_KEY, null);
    console.warn('[Savpol] Nie znalazłem w wynikach produktu o SKU ' + sku +
      '. Zostajesz na liście wyników.');
  }

  function insertEsavpolButtonIfNeeded() {
    if (!ESAVPOL.ENABLE) return;
    if (!location.href.includes(TARGET_URL_FRAGMENT)) return;
    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + ESAVPOL_BUTTON_ID)) return;

    const btn = document.createElement('div');
    btn.id = ESAVPOL_BUTTON_ID;
    btn.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="caption" title="Otwiera zaznaczony produkt na esavpol.pl">' +
      ESAVPOL_BUTTON_TEXT + '</div>';
    btn.addEventListener('click', () => {
      const sku = getSelectedCatalogSku();
      if (!sku) {
        console.warn('[Savpol] Nie odczytałem SKU — czy produkt jest zaznaczony?');
        diag('BLAD', 'Otwórz w esavpol: brak SKU zaznaczonego produktu');
        describeDom('brak SKU do otwarcia w sklepie');
        btn.querySelector('.caption').textContent = 'Najpierw wyszukaj produkt';
        setTimeout(() => {
          btn.querySelector('.caption').textContent = ESAVPOL_BUTTON_TEXT;
        }, 2500);
        return;
      }
      openInEsavpol(sku);
    });
    toolbar.appendChild(btn);
  }

  // ---------- Masowy odczyt danych z katalogu ----------
  const eanRun = { running: false, stop: false };

  function parseInputList(raw) {
    // Nazwy produktów zawierają spacje i przecinki, więc dzielimy WYŁĄCZNIE po
    // nowych liniach — inaczej „Krem orzechowy, 5kg" rozpadłby się na dwa
    // zapytania. Kolejność wierszy jest jedyną rzeczą wiążącą wynik z arkuszem.
    return (raw || '')
      .split(/\r?\n/)
      .map(x => x.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }

  // Z arkusza SKU przychodzi często bez wiodących zer (Excel i Sheets traktują
  // je jak liczby), a katalog ERP wymaga pełnego, siedmioznakowego kodu.
  // 35776 → 0035776. Sufiks kartoteki dodatkowej (-M, -R) zostaje nietknięty.
  const SKU_LENGTH = 7;

  function normalizeSku(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^([0-9]{1,8})(-[A-Za-z])?$/);
    if (!m) return raw;
    const digits = m[1].length >= SKU_LENGTH ? m[1] : m[1].padStart(SKU_LENGTH, '0');
    return digits + (m[2] ? m[2].toUpperCase() : '');
  }

  // Do 8 cyfr uznajemy za SKU (po dopełnieniu zerami). Dłuższe ciągi cyfr to
  // najpewniej EAN, a nie numer produktu, więc nie porywamy ich do tego trybu.
  function looksLikeSku(value) {
    return /^[0-9]{1,8}(-[A-Za-z])?$/.test(String(value || '').trim());
  }

  // EAN: 8, 12, 13 albo 14 cyfr. Wyszukiwarka katalogu obsługuje je tak samo
  // dobrze jak SKU, a to identyfikator — pewniejszy od nazwy.
  function looksLikeEan(value) {
    return /^[0-9]{12,14}$/.test(String(value || '').trim());
  }

  // Kolumna `EAN` w siatce katalogu to „NR EAN op. sprzedażowego" — kod
  // jednostki sprzedażowej, KTÓRY NIE MUSI być równy EAN-owi z kartoteki
  // produktu. Realny przypadek: kartoteka 0024282 ma w karcie EAN
  // 9005676401237, a w siatce widnieje 40170404…
  //
  // Dlatego nie opieramy dopasowania wyłącznie na tej kolumnie. Gdy się zgadza
  // — świetnie. Gdy nie, ufamy WYSZUKIWARCE: to ona właśnie znalazła ten
  // produkt po podanym kodzie i jest lepszym dowodem niż kolumna, która
  // przechowuje coś innego.
  function pickRowByEan(ean) {
    const rows = catalogRows();
    if (!rows.length) return { row: null, status: 'nie znaleziono EAN w katalogu' };

    const pickBase = (candidates, status) => {
      const plain = candidates.filter(r => !hasCaption(r));
      if (plain.length === 1) return { row: plain[0], score: 1, status };
      if (plain.length > 1) {
        // Kilka kartotek podstawowych = kilka RÓŻNYCH produktów w wyniku.
        const skus = Array.from(new Set(plain.map(r => readField(r, 'Item'))));
        if (skus.length > 1) {
          return { row: plain[0], status: 'kilka produktów pod tym EAN (' +
            skus.join(', ') + ') — sprawdź' };
        }
        return { row: plain[0], score: 1, status };
      }
      // Same kartoteki dodatkowe („Promocja specjalna", „Towar nisko rotujący").
      return { row: candidates[0], status: 'tylko kartoteki dodatkowe — sprawdź' };
    };

    const exact = rows.filter(r => readField(r, 'EAN') === ean);
    if (exact.length) return pickBase(exact, 'ok');

    return pickBase(rows, 'dopasowane przez wyszukiwarkę ERP ' +
      '(kolumna EAN w siatce pokazuje kod op. sprzedażowego)');
  }

  // Główny tekst komórki, bez szarego podpisu („Gratis", „Towar nisko
  // rotujący"), który w tej siatce jest osobnym elementem w tej samej komórce.
  function readMainCellText(cell) {
    if (!cell) return '';
    const main = cell.querySelector('.csDBTextBlock:not(.cs-style-label)');
    if (main) return main.textContent.trim();
    return (cell.getAttribute('title') || cell.textContent || '').trim();
  }

  function readField(row, field) {
    return readMainCellText(row.querySelector('td[data-datafield="' + field + '"]'));
  }

  // Gramatura, pojemność, liczba sztuk, wymiary. To NAJWAŻNIEJSZA część nazwy
  // przy odróżnianiu kartotek: „Krem pistacjowy" istnieje w trzech opakowaniach
  // i tylko ta liczba mówi, o które chodzi.
  //
  // Wychwytujemy je jako CAŁOŚĆ, przed zwykłym dzieleniem na słowa, żeby
  // „2,5 kg", „2.5kg" i „2,5KG" dały ten sam token `2.5kg`. Bez tego kropka
  // i spacja rozbijałyby liczbę na kawałki, których nie da się porównać.
  const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|szt|sztuk[a-z]*|cm|mm|mg)(?![a-z])/gi;
  const DIM_RE = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/gi;

  function normalizeNumber(n) {
    return String(n).replace(',', '.').replace(/\.0+$/, '');
  }

  // Rozbija nazwę na słowa (do porównywania po rdzeniach) i gramatury
  // (porównywane dosłownie — 500g to nie 500ml i nie 5kg).
  function nameParts(name) {
    let text = fold(String(name || ''));
    const sizes = [];

    text = text.replace(DIM_RE, (_, a, b) => {
      sizes.push(normalizeNumber(a) + 'x' + normalizeNumber(b));
      return ' ';
    });
    text = text.replace(SIZE_RE, (_, num, unit) => {
      sizes.push(normalizeNumber(num) + unit.toLowerCase().replace(/^sztuk[a-z]*$/, 'szt'));
      return ' ';
    });

    const words = text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);

    return { words, sizes };
  }

  // Wszystkie tokeny nazwy: słowa plus gramatury.
  function nameTokens(name) {
    const { words, sizes } = nameParts(name);
    return words.concat(sizes);
  }

  // Rdzeń słowa do porównywania mimo odmiany. NIE generujemy form („worek" →
  // „worki"), bo polska odmiana to nie doklejenie końcówki — zamiast tego
  // porównujemy słowa po obcięciu końcówki, co działa w obie strony:
  //
  //   worek / worki             → wor
  //   cukierniczy / cukiernicze → cukiernic
  //   jednorazowy / jednorazowe → jednorazow
  //
  // Tokeny z CYFRAMI zostają nietknięte. Inaczej „500g" i „500ml" spłaszczyłyby
  // się do tego samego rdzenia i gramatura przestałaby odróżniać produkty —
  // a to jedyna rzecz, która często dzieli dwie kartoteki tego samego towaru.
  function stemToken(token) {
    if (/\d/.test(token)) return token;
    if (token.length >= 5) return token.slice(0, token.length - 2);
    if (token.length === 4) return token.slice(0, 3);
    return token;
  }

  // Wersja do BUDOWY ZAPYTANIA — łagodniejsza niż ta do porównywania.
  // Przy porównywaniu obcinamy też słowa czteroliterowe, bo tam skrót niczego
  // nie psuje: porównujemy dwa rdzenie tą samą miarą. W zapytaniu wysyłanym do
  // ERP „Krem" musi zostać „Krem" — „kre" nie znaczy już nic.
  function stemForQuery(token) {
    if (/\d/.test(token)) return token;
    return token.length >= 5 ? token.slice(0, token.length - 2) : token;
  }

  // Udział tokenów szukanej nazwy obecnych w nazwie z ERP. Liczymy względem
  // zapytania, nie symetrycznie: ERP dopisuje do nazw markę i dopiski
  // handlowe, więc nazwa z katalogu bywa dłuższa i kara za to byłaby niesłuszna.
  //
  // Gramatura jest wyjątkiem od tej pobłażliwości. Gdy szukana nazwa ją podaje,
  // a kartoteka jej NIE MA albo ma inną, wynik jest ścinany poniżej obu progów.
  // Bez tego „Krem pistacjowy 5kg" pasował do wersji 1kg i 250g niemal tak samo
  // dobrze (jeden token różnicy na osiem), a skrypt wybierał zgadując.
  const SIZE_MISMATCH_SCORE = 0.4;

  function nameSimilarity(query, candidate) {
    const qp = nameParts(query);
    const cp = nameParts(candidate);
    const all = qp.words.concat(qp.sizes);
    if (!all.length) return 0;

    const cSet = new Set(cp.words.map(stemToken).concat(cp.sizes));
    const hit = qp.words.map(stemToken).filter(t => cSet.has(t)).length +
      qp.sizes.filter(t => cSet.has(t)).length;
    const score = hit / all.length;

    if (qp.sizes.length && !qp.sizes.every(sz => cp.sizes.includes(sz))) {
      return Math.min(score, SIZE_MISMATCH_SCORE);
    }
    return score;
  }

  // ---------- Statystyki cen: odczyt z historii produktu ----------

  // Jedna pozycja faktury z siatki historii. Wszystko z listy — bez wchodzenia
  // w dokumenty, bo ta siatka ma już cenę jednostkową po rabacie.
  function readSalesRow(row) {
    const price = parsePlNumber(readField(row, 'FNetPriceADis'));
    const qty = parsePlNumber(readField(row, 'dQuantity'));
    return {
      price: price === null ? 0 : price,
      qty: qty === null ? 0 : qty,
      customer: readField(row, 'CustomerDesc'),
      date: readField(row, 'DocDate'),
      sku: readField(row, 'Item')
    };
  }

  function isExcludedCustomer(name) {
    const n = fold(name || '');
    return PRICE_STATS.EXCLUDE_CUSTOMERS.some(x => x && n.includes(fold(x)));
  }

  function priceWindowStart(now) {
    const base = now ? new Date(now) : new Date();
    if (PRICE_STATS.FROM_YEAR_START) return new Date(base.getFullYear(), 0, 1);
    const d = new Date(base);
    d.setMonth(d.getMonth() - PRICE_STATS.MONTHS_BACK);
    return d;
  }

  // Data z ERP przychodzi jako YYYY-MM-DD w atrybucie title.
  function parseErpDate(text) {
    const m = String(text || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  // Przechodzi po WSZYSTKICH stronach listy historii i zbiera pozycje.
  // Świadomie nie otwieramy dokumentów: to ta sama pętla co w cross-sellu,
  // ale bez najdroższego kroku, więc jeden produkt to sekundy, nie minuty.
  async function collectSalesRows(sku, onProgress) {
    const rows = [];
    const since = priceWindowStart();
    const seenDocs = new Set();
    let page = 1;

    while (page <= MAX_PAGES) {
      if (eanRun.stop) break;

      const faRows = getFaRows();
      if (!faRows.length && page === 1) {
        await waitFor(() => getFaRows().length > 0, 20, 300);
      }

      let newOnPage = 0;
      for (const row of getFaRows()) {
        const parsed = readSalesRow(row);
        const docCell = row.querySelector('td[data-datafield="DocNumber"]');
        const doc = docCell ? (docCell.getAttribute('title') || '') : '';
        const key = doc + '|' + parsed.sku + '|' + parsed.price + '|' + parsed.qty;
        if (seenDocs.has(key)) continue;
        seenDocs.add(key);
        newOnPage++;

        if (parsed.sku && parsed.sku !== sku) continue;      // czyjaś pozycja
        if (isExcludedCustomer(parsed.customer)) continue;
        const d = parseErpDate(parsed.date);
        if (d && d < since) continue;                        // poza okresem
        if (parsed.qty <= 0) continue;                       // korekty i zwroty
        rows.push(parsed);

        if (rows.length >= PRICE_STATS.MAX_TRANSACTIONS) {
          rows.capped = true;
          break;
        }
      }

      if (rows.capped) break;

      if (onProgress) onProgress(rows.length, page);

      const pager = getVisiblePager();
      if (!pagerHasNextPage(pager)) break;
      if (!newOnPage && page > 1) break;   // ta sama strona w kółko
      const moved = await goToNextPage(pager);
      if (!moved) break;
      page++;
    }

    return rows;
  }

  // Wszystkie zakładki (nie tylko widoczne) po aria-controls. Do wykrycia,
  // która zakładka jest nowa po kliknięciu „Historia produktu".
  function tabIdSet() {
    return new Set(Array.from(document.querySelectorAll('li.k-item[aria-controls]'))
      .map(li => li.getAttribute('aria-controls')));
  }

  function tabLiById(id) {
    return Array.from(document.querySelectorAll('li.k-item[aria-controls]'))
      .find(li => li.getAttribute('aria-controls') === id) || null;
  }

  function closeTabById(id) {
    const li = tabLiById(id);
    if (!li) return false;
    const btn = li.querySelector('.csCloseButton_span');
    if (!btn) return false;
    btn.click();
    return true;
  }

  // Zakładka historii rozpoznawana DWOJAKO: po etykiecie („Pozycje dokumentów:
  // 0003593") albo po zawartości panelu. Sama zawartość nie wystarcza, bo przy
  // pustym wyniku w panelu nie ma numerów dokumentów — czyli dokładnie te
  // zakładki, które zostają po awarii, byłyby niewidzialne dla sprzątacza.
  const HISTORY_TAB_LABEL = /pozycje\s+dokument/i;

  function isHistoryTab(li) {
    const id = li.getAttribute('aria-controls');
    if (!id) return false;
    if (HISTORY_TAB_LABEL.test(tabLabel(li))) return true;
    const panel = document.getElementById(id);
    return !!panel && panelLooksLikeHistory(panel);
  }

  // Sprzątanie po poprzednich produktach. Przy odczycie cen dla setek pozycji
  // każda nieodzyskana zakładka „Pozycje dokumentów" zostaje na ekranie —
  // i po kilkunastu ERP zaczyna gubić się w tym, co jest aktywne.
  async function closeStrayHistoryTabs(keepId) {
    const stray = Array.from(document.querySelectorAll('li.k-item[aria-controls]'))
      .filter(li => {
        const id = li.getAttribute('aria-controls');
        if (!id || id === keepId || id === knownCatalogPanelId) return false;
        return isHistoryTab(li);
      });
    if (!stray.length) return 0;

    for (const li of stray) {
      const btn = li.querySelector('.csCloseButton_span');
      if (btn) { btn.click(); await sleep(200); }
    }
    diag('INFO', 'Zamknięto zaległe zakładki historii: ' + stray.length);
    return stray.length;
  }

  // Pełny odczyt statystyk dla jednego produktu: zaznacz w katalogu, otwórz
  // historię, ustaw filtry, zbierz pozycje, zamknij zakładkę.
  //
  // Wykrywanie otwartej historii idzie po NOWYM ID ZAKŁADKI, nie po tym, która
  // jest aktywna ani co jest w jej panelu. Poprzednia wersja wymagała, żeby
  // aktywna zakładka miała już w panelu wiersz z numerem dokumentu — a przy
  // domyślnym filtrze wierszy może nie być wcale, więc warunek nigdy się nie
  // spełniał: skrypt raportował „historia nie otworzyła się" i wychodził
  // PRZED blokiem finally, czyli nie zamykał tego, co właśnie otworzył.
  // Stąd mnożące się zakładki „Pozycje dokumentów".
  async function fetchPriceStats(row, sku, onProgress) {
    await closeStrayHistoryTabs(null);

    const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
    if (descCell) descCell.click();
    await sleep(200);

    const before = tabIdSet();
    if (!openHistory()) {
      return { values: {}, notes: ['brak przycisku „Historia produktu"'] };
    }

    // Nowa zakładka = ta, której id nie było przed kliknięciem.
    const newId = await waitFor(() => {
      const now = Array.from(tabIdSet()).find(id => !before.has(id));
      return now || null;
    }, 40, 200);

    if (!newId) {
      diag('BLAD', 'Historia ' + sku + ': nie pojawiła się nowa zakładka.');
      describeDom('historia nie otworzyła się');
      return { values: {}, notes: ['historia produktu nie otworzyła się'] };
    }

    // Od tego miejsca zakładka JEST nasza i musi zostać zamknięta niezależnie
    // od tego, co się dalej stanie.
    try {
      const historyPanel = document.getElementById(newId);
      await waitFor(() => findFilterPanel(historyPanel) !== null, 40, 250);
      // Datę filtra ustawiamy na początek okna, żeby ERP zwrócił mniej stron.
      // Odsiew w JS zostaje jako druga linia obrony, gdy filtr nie zadziała.
      await setFilters(historyPanel, priceWindowStart());
      const salesRows = await collectSalesRows(sku, onProgress);
      const stats = computePriceStats(salesRows);
      if (!salesRows.length) {
        stats.notes = stats.notes.length ? stats.notes : ['brak sprzedaży w okresie'];
      }
      return stats;
    } catch (err) {
      // Komunikat MUSI dojść do arkusza. Wcześniejsza wersja zamieniała go na
      // ogólne „błąd odczytu historii" i przy awarii filtrów nie było wiadomo,
      // co się stało — trzeba było pytać użytkownika.
      const msg = String(err && err.message || err);
      console.warn('[Ceny] Błąd przy ' + sku + ':', msg);
      diag('BLAD', 'Ceny ' + sku + ': ' + msg);
      return { values: {}, notes: ['historia: ' + msg] };
    } finally {
      closeTabById(newId);
      await sleep(400);
      // Zaległości z wcześniejszych, nieudanych prób też sprzątamy.
      await closeStrayHistoryTabs(null);

      if (!isCatalogTabActive()) {
        const back = await switchToCatalogTab();
        if (!back) {
          diag('BLAD', 'Nie udało się wrócić do katalogu po historii ' + sku + '.');
          describeDom('brak powrotu do katalogu po historii');
        }
      }
      await waitFor(() => findVisibleCatalogSearchInput() !== null, 20, 200);
    }
  }

  // ---------- Statystyki cen: czysta matematyka ----------

  // Polski zapis liczby z ERP: „1 234,56" → 1234.56. Spacje bywają twarde.
  function parsePlNumber(text) {
    const raw = String(text || '').replace(/[\s\u00a0]/g, '').replace(',', '.');
    if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
    return parseFloat(raw);
  }

  // Percentyl WAŻONY WOLUMENEM. Waga to ilość, bo klient kupujący 500 kg po
  // 102 zł znaczy dla polityki cenowej więcej niż ktoś, kto wziął 2 kg po 114.
  //
  // Metoda „lower weighted percentile": pierwsza cena, przy której narastający
  // wolumen sięga progu. Bez interpolacji — interpolowana cena to kwota, po
  // której nikt nigdy nie kupił, a tu chcemy liczb z faktur.
  function weightedPercentile(rows, q) {
    if (!rows.length) return null;
    const sorted = rows.slice().sort((a, b) => a.price - b.price);
    const total = sorted.reduce((sum, r) => sum + r.qty, 0);
    if (total <= 0) return null;
    const target = total * q;
    let acc = 0;
    for (const r of sorted) {
      acc += r.qty;
      if (acc >= target) return r.price;
    }
    return sorted[sorted.length - 1].price;
  }

  // Percentyl PO TRANSAKCJACH, bez wagi. Odpowiada na inne pytanie niż wersja
  // ważona: „ile UMÓW jest powyżej tej kwoty", a nie „ile towaru".
  //
  // Różnica bywa duża i to nie usterka. Gdy jeden klient bierze 500 kg po
  // 102 zł, a dwóch po 114, to 90% WOLUMENU idzie po 102 — więc ważone P90
  // wynosi 102. Ale 17% TRANSAKCJI jest po 114, więc transakcyjne P90 to 114.
  // Do pytania „czy ktoś kupuje drożej" właściwa jest wersja transakcyjna.
  function unweightedPercentile(rows, q) {
    if (!rows.length) return null;
    const p = rows.map(r => r.price).sort((a, b) => a - b);
    const idx = Math.min(p.length - 1, Math.max(0, Math.ceil(q * p.length) - 1));
    return p[idx];
  }

  function unweightedMedian(rows) {
    if (!rows.length) return null;
    const p = rows.map(r => r.price).sort((a, b) => a - b);
    const mid = Math.floor(p.length / 2);
    return p.length % 2 ? p[mid] : (p[mid - 1] + p[mid]) / 2;
  }

  function round2(n) {
    return n === null || n === undefined ? null : Math.round(n * 100) / 100;
  }

  // Wyjście z przecinkiem, jak wszystkie liczby w tym narzędziu — przełącznik
  // „kropka w cenach" zamienia je jednolicie na kropkę.
  function plNum(n) {
    if (n === null || n === undefined) return '';
    return String(n).replace('.', ',');
  }

  // Zwraca liczby do arkusza plus ostrzeżenia, gdy próba jest za mała albo
  // ceny są rozwarstwione i jedna liczba nie opisuje rynku.
  function computePriceStats(rows) {
    const clean = rows.filter(r => r.price > 0 && r.qty > 0);
    if (!clean.length) return { values: {}, notes: ['brak transakcji w okresie'] };

    // Faktyczny zakres dat użytej próby. Przy trafieniu w limit będzie krótszy
    // niż zamówiony — i właśnie dlatego jest pokazywany.
    const dates = clean.map(r => r.date).filter(Boolean).sort();
    const period = dates.length
      ? (dates[0] === dates[dates.length - 1]
        ? dates[0]
        : dates[0] + ' – ' + dates[dates.length - 1])
      : '';

    const p10 = weightedPercentile(clean, 0.10);
    const p90 = weightedPercentile(clean, 0.90);
    const floorQ = PRICE_STATS.FLOOR_PERCENTILE / 100;

    const values = {
      txn: String(clean.length),
      volume: plNum(round2(clean.reduce((s, r) => s + r.qty, 0))),
      floor: plNum(round2(weightedPercentile(clean, floorQ))),
      median: plNum(round2(weightedPercentile(clean, 0.50))),
      p10: plNum(round2(p10)),
      p90: plNum(round2(p90)),
      minPrice: plNum(round2(Math.min.apply(null, clean.map(r => r.price)))),
      maxPrice: plNum(round2(Math.max.apply(null, clean.map(r => r.price)))),
      medianTx: plNum(round2(unweightedMedian(clean))),
      p90Tx: plNum(round2(unweightedPercentile(clean, 0.90))),
      floorTx: plNum(round2(unweightedPercentile(clean, PRICE_STATS.FLOOR_PERCENTILE / 100)))
    };

    const spread = p10 > 0 ? p90 / p10 : null;
    values.spread = plNum(round2(spread));

    values.period = period;

    const notes = [];
    if (rows.capped) {
      notes.push('ograniczono do ' + PRICE_STATS.MAX_TRANSACTIONS +
        ' najnowszych transakcji (okres: ' + period + ')');
    }
    if (clean.length < PRICE_STATS.MIN_TRANSACTIONS) {
      notes.push('tylko ' + clean.length + ' transakcji — percentyle niewiarygodne');
    }
    if (spread !== null && spread >= PRICE_STATS.SPREAD_ALERT) {
      notes.push('ceny rozwarstwione (P90/P10 = ' + round2(spread) + ') — dwie grupy klientów');
    }
    return { values, notes };
  }

  // Odcisk zawartości siatki katalogu. Służy do stwierdzenia, że wyszukiwanie
  // naprawdę podmieniło wyniki, a nie tylko zostawiło poprzednie na ekranie.
  function catalogSignature() {
    const grid = getVisibleCatalogGrid();
    if (!grid) return '(brak siatki)';
    const rows = Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row'));
    return rows.length + '|' + rows
      .map(r => {
        const c = r.querySelector('td[data-datafield="Item"]');
        return c ? (c.getAttribute('title') || '') : '';
      })
      .join(',');
  }

  // Wyszukiwanie z POTWIERDZENIEM, że siatka się przeładowała.
  //
  // searchCatalog() czeka tylko na to, że siatka ISTNIEJE — a ona istnieje od
  // poprzedniego wyszukiwania. Przy odczycie po SKU dawało to najwyżej „nie
  // znaleziono" (bo porównujemy dokładny numer), ale przy odczycie po NAZWIE
  // wybieramy najlepszy z widocznych wierszy, więc stara zawartość wracała
  // jako wynik: kolejne produkty dostawały cenę pierwszego.
  //
  // Sygnatura nie zmienia się też wtedy, gdy dwa zapytania dają identyczne
  // wyniki — to poprawny przypadek, dlatego brak zmiany nie jest błędem,
  // tylko powodem do ponowienia i ostrzeżenia.
  async function searchCatalogFresh(query) {
    const before = catalogSignature();
    await searchCatalog(query);

    let changed = await waitFor(() => catalogSignature() !== before, 24, 250);
    if (!changed) {
      // Druga próba: ERP gubi pojedyncze żądanie częściej, niż by się chciało.
      await searchCatalog(query);
      changed = await waitFor(() => catalogSignature() !== before, 24, 250);
    }
    return { refreshed: !!changed, unchanged: before === catalogSignature() };
  }

  function catalogRows() {
    const grid = getVisibleCatalogGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tbody tr.cs-grid-data-row'));
  }

  // Jedno SKU potrafi mieć w katalogu kilka kartotek: podstawową i dodatkowe
  // („Gratis", „Promocja specjalna", „Towar nisko rotujący"), rozpoznawalne po
  // szarym podpisie pod nazwą. Bierzemy kartotekę BEZ podpisu.
  function hasCaption(row) {
    return !!readCaption(row.querySelector('td[data-datafield="ItemDesc"]'));
  }

  function pickRowBySku(sku) {
    const rows = catalogRows().filter(r => readField(r, 'Item') === sku);
    if (!rows.length) return { row: null, status: 'nie znaleziono w katalogu' };
    const plain = rows.filter(r => !hasCaption(r));
    if (plain.length > 1) {
      return { row: plain[0], status: 'kilka kartotek (' + plain.length + ') — sprawdź' };
    }
    if (!plain.length) {
      return { row: rows[0], status: 'tylko kartoteki dodatkowe — sprawdź' };
    }
    return { row: plain[0], status: 'ok' };
  }

  function pickRowByName(name) {
    const rows = catalogRows();
    if (!rows.length) return { row: null, status: 'nie znaleziono w katalogu' };

    const scored = rows
      .map(r => ({ row: r, score: nameSimilarity(name, readField(r, 'ItemDesc')) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Przy równym podobieństwie kartoteka podstawowa ma pierwszeństwo.
        return (hasCaption(a.row) ? 1 : 0) - (hasCaption(b.row) ? 1 : 0);
      });

    const best = scored[0];
    if (best.score < EAN_TOOL.NAME_MATCH_MIN) {
      return { row: best.row, score: best.score, status: 'SŁABE dopasowanie nazwy — sprawdź' };
    }
    // Remis na szczycie znaczy, że nazwa nie rozstrzyga, który produkt to ten.
    const tie = scored.filter(x => x.score === best.score && !hasCaption(x.row)).length;
    if (tie > 1) {
      return { row: best.row, score: best.score, status: 'kilka pasujących nazw — sprawdź' };
    }
    if (best.score < 1) {
      return { row: best.row, score: best.score, status: 'dopasowanie przybliżone' };
    }
    return { row: best.row, score: 1, status: 'ok' };
  }

  // Nazwy bywają dłuższe niż to, co katalog akceptuje w wyszukiwarce, i jeden
  // literowy rozjazd potrafi dać zero wyników. Skracamy więc zapytanie — ale
  // tylko do granicy, poniżej której przestaje ono opisywać KONKRETNY produkt.
  //
  // Zwraca listę obiektów, bo wynik ze skróconego zapytania jest oceniany
  // surowiej niż z pełnego (patrz NAME_FALLBACK.MIN_SCORE).
  function nameQueries(name) {
    const full = String(name || '').trim();
    const queries = [{ query: full, shortened: false }];

    const { words, sizes } = nameParts(name);
    const tokens = words.filter(t => t.length > 2);
    const cfg = EAN_TOOL.NAME_FALLBACK;

    // GRAMATURA ZOSTAJE W KAŻDYM SKRÓCIE. Skracamy od końca nazwy, a tam
    // właśnie siedzi wielkość opakowania — bez tego zapytanie „krem pistacjowy"
    // zwracało trzy rozmiary i skrypt musiałby zgadywać, który wziąć.
    const withSizes = q => sizes.length ? q + ' ' + sizes.join(' ') : q;

    const add = count => {
      if (count >= tokens.length) return;              // to nie byłoby skróceniem
      if (count < cfg.MIN_TOKENS) return;              // za mało słów, żeby coś znaczyło
      const base = tokens.slice(0, count).join(' ');
      if (base.length < cfg.MIN_CHARS) return;         // trzy krótkie słowa to wciąż za mało
      const q = withSizes(base);
      if (queries.some(x => x.query === q)) return;
      queries.push({ query: q, shortened: true });
    };

    add(5);
    add(cfg.MIN_TOKENS);

    // Ostatnia próba: pierwsze słowa obcięte do rdzeni — jedyny sposób, żeby
    // „Worki cukiernicze jednorazowe" trafiły w „Worek cukierniczy jednorazowy".
    // Same reguły dopasowania nie wystarczą, bo wyszukiwarka katalogu musi
    // najpierw cokolwiek zwrócić.
    //
    // Obcinamy TYLKO słowa od 5 znaków. Krótkie zostają w całości, żeby nie
    // robić z „Krem" ciągu „kre", który nie znaczy już nic.
    //
    // Czy katalog dopasowuje początki słów — nie mamy potwierdzonego. To tani
    // strzał: gdy nie zadziała, nie będzie wyników i lecimy dalej. Wynik i tak
    // przechodzi przez ostrzejszy próg dla zapytań skróconych.
    const head = tokens.slice(0, 4);
    const stemmed = head.filter(t => !/\d/.test(t) && t.length >= 5).length;
    const stemBase = head.map(stemForQuery).join(' ');
    const stems = withSizes(stemBase);
    if (stemmed >= 2 &&
        tokens.length >= cfg.MIN_TOKENS &&
        stemBase.length >= cfg.MIN_CHARS &&
        !queries.some(x => x.query === stems)) {
      queries.push({ query: stems, shortened: true });
    }

    return queries;
  }

  async function fetchRowForEntry(entry, mode) {
    if (mode === 'ean') {
      const ean = String(entry).trim();
      await searchCatalogFresh(ean);
      return pickRowByEan(ean);
    }

    if (mode === 'sku') {
      const sku = normalizeSku(entry);
      await searchCatalogFresh(sku);
      return pickRowBySku(sku);
    }

    let last = { row: null, status: 'nie znaleziono w katalogu' };
    for (const { query, shortened } of nameQueries(entry)) {
      if (eanRun.stop) break;
      const { refreshed } = await searchCatalogFresh(query);
      if (!catalogRows().length) continue;

      const hit = pickRowByName(entry);
      if (!hit.row) continue;

      // Wynik ze skróconego zapytania przyjmujemy TYLKO przy mocnym trafieniu.
      // Skrócone zapytanie pasuje do wielu produktów, więc przeciętne
      // podobieństwo znaczy tu „coś z tej półki", a nie „ten produkt".
      if (shortened && (hit.score || 0) < EAN_TOOL.NAME_FALLBACK.MIN_SCORE) {
        last = { row: null, status: 'nie znaleziono — nazwa zbyt ogólna' };
        continue;
      }

      // Brak odświeżenia przy DOBRYM dopasowaniu jest niegroźny (te same
      // wyniki dla podobnego zapytania). Przy słabym — to najpewniej stara
      // zawartość siatki i wartość jest cudza. Mówimy o tym wprost.
      if (!refreshed && (hit.score || 0) < 1) {
        hit.status = 'siatka mogła się nie odświeżyć — sprawdź';
      }
      if (shortened && hit.status === 'ok') {
        hit.status = 'trafione skróconą nazwą — sprawdź';
      }
      return hit;
    }
    return last;
  }

  function formatValue(value, fieldDef, opts) {
    if (!value) return '';
    if (fieldDef.numeric && opts.dot) return value.replace(/\s/g, '').replace(',', '.');
    // Apostrof tylko dla kodów: chroni wiodące zero SKU i EAN przed Sheets.
    // Przy cenach byłby szkodliwy — zrobiłby z nich tekst.
    if (opts.apostrophe && (fieldDef.key === 'sku' || fieldDef.key === 'ean')) {
      return "'" + value;
    }
    return value;
  }

  function createEanPanel() {
    const old = document.getElementById(EAN_TOOL.PANEL_ID);
    if (old) old.remove();

    const box = document.createElement('div');
    box.id = EAN_TOOL.PANEL_ID;
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
      'width:420px', 'max-height:88vh', 'overflow:auto',
      'padding:14px 16px', 'box-sizing:border-box',
      'background:#1f2933', 'color:#f5f7fa', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
    ].join(';');

    const field = 'width:100%;box-sizing:border-box;font:12px ui-monospace,Consolas,monospace;' +
      'padding:6px 8px;border:1px solid rgba(255,255,255,.2);border-radius:4px;' +
      'background:rgba(0,0,0,.25);color:#f5f7fa;resize:vertical';
    const btn = 'cursor:pointer;font:inherit;font-size:12px;padding:6px 10px;border:0;' +
      'border-radius:4px;font-weight:600';

    const checks = DATA_FIELDS.map(f =>
      '<label style="cursor:pointer;white-space:nowrap">' +
      '<input data-field="' + f.key + '" type="checkbox"' +
      (['sku', 'name', 'ean'].includes(f.key) ? ' checked' : '') + '> ' + f.label + '</label>'
    ).join('');

    const salesChecks = SALES_FIELDS.map(f =>
      '<label style="cursor:pointer;white-space:nowrap">' +
      '<input data-field="' + f.key + '" type="checkbox"> ' + f.label + '</label>'
    ).join('');

    box.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="flex:1;font-size:13px">Dane produktów z ERP</strong>',
      '  <span data-role="close" title="Zamknij" style="cursor:pointer;opacity:.6;padding:0 6px;font-size:16px;line-height:1">&times;</span>',
      '</div>',
      '<div style="font-size:12px;opacity:.75;margin-bottom:6px">',
      '  Wklej kolumnę z arkusza — SKU albo nazwy, po jednym w wierszu:</div>',
      '<textarea data-role="input" rows="5" spellcheck="false" style="' + field + '"></textarea>',
      '<div style="margin-top:8px;font-size:12px;opacity:.75">Szukaj po:</div>',
      '<div style="display:flex;gap:12px;margin-top:4px;font-size:12px">',
      '  <label style="cursor:pointer"><input data-role="mode-auto" type="radio" name="savpol-ean-mode" checked> rozpoznaj sam</label>',
      '  <label style="cursor:pointer"><input data-role="mode-sku" type="radio" name="savpol-ean-mode"> SKU</label>',
      '  <label style="cursor:pointer"><input data-role="mode-ean" type="radio" name="savpol-ean-mode"> EAN</label>',
      '  <label style="cursor:pointer"><input data-role="mode-name" type="radio" name="savpol-ean-mode"> nazwie</label>',
      '</div>',
      '<div style="margin-top:8px;font-size:12px;opacity:.75">Chcę dostać:</div>',
      '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:12px">',
      checks,
      '</div>',
      '<div style="margin-top:10px;font-size:12px;opacity:.75">',
      '  Z historii sprzedaży (wolne — kilka sekund na produkt):</div>',
      '<div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:12px">',
      salesChecks,
      '</div>',
      '<div style="display:flex;gap:6px;margin-top:10px">',
      '  <button data-role="start" type="button" style="' + btn + ';flex:1;background:#4c9aff;color:#04142e">Pobierz dane</button>',
      '  <button data-role="stop" type="button" style="' + btn + ';display:none;background:#5a3a3a;color:#ffd9d4">Przerwij</button>',
      '</div>',
      '<div data-role="progress" style="margin-top:8px;font-size:12px;opacity:.8"></div>',
      '<div data-role="outbox" style="display:none;margin-top:10px;padding-top:10px;',
      '    border-top:1px solid rgba(255,255,255,.15)">',
      '  <div style="display:flex;gap:12px;font-size:12px;margin-bottom:8px;opacity:.8">',
      '    <label style="cursor:pointer"><input data-role="apo" type="checkbox" checked> apostrof w SKU i EAN</label>',
      '    <label style="cursor:pointer"><input data-role="dot" type="checkbox"> kropka w cenach</label>',
      '  </div>',
      '  <div data-role="columns"></div>',
      '  <button data-role="csv" type="button" style="' + btn + ';width:100%;margin-top:4px;',
      '      background:transparent;color:#f5f7fa;border:1px solid rgba(255,255,255,.2);',
      '      font-weight:400">Pobierz wszystko jako CSV</button>',
      '  <div data-role="problems" style="margin-top:8px;font-size:11px;opacity:.75;',
      '      max-height:140px;overflow:auto;white-space:pre-wrap"></div>',
      '</div>'
    ].join('');

    document.body.appendChild(box);
    return box;
  }

  function selectedFrom(list, panel) {
    return list.filter(f => {
      const cb = panel.querySelector('[data-field="' + f.key + '"]');
      return cb && cb.checked;
    });
  }

  function selectedFields(panel) {
    return selectedFrom(DATA_FIELDS, panel);
  }

  function selectedSalesFields(panel) {
    return PRICE_STATS.ENABLE ? selectedFrom(SALES_FIELDS, panel) : [];
  }

  // Każda kolumna w osobnym polu — tak się wkleja do arkusza, kolumna po
  // kolumnie. Jedna wielka tabela wymagałaby rozbijania jej w Sheets.
  function renderColumns(panel, results, fields, opts) {
    const host = panel.querySelector('[data-role="columns"]');
    host.innerHTML = '';

    fields.forEach(f => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:10px';
      wrap.innerHTML = [
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">',
        '  <span style="flex:1;font-size:11px;text-transform:uppercase;',
        '      letter-spacing:.04em;opacity:.65">' + f.label + '</span>',
        '  <button type="button" style="cursor:pointer;font:inherit;font-size:11px;',
        '      padding:3px 8px;border:0;border-radius:4px;background:#36b37e;',
        '      color:#04231a;font-weight:600">Kopiuj</button>',
        '</div>',
        '<textarea rows="4" readonly spellcheck="false" style="width:100%;box-sizing:border-box;',
        '    font:12px ui-monospace,Consolas,monospace;padding:6px 8px;',
        '    border:1px solid rgba(255,255,255,.2);border-radius:4px;',
        '    background:rgba(0,0,0,.25);color:#f5f7fa;resize:vertical"></textarea>'
      ].join('');

      const ta = wrap.querySelector('textarea');
      ta.value = results.map(r => formatValue(r.values[f.key], f, opts)).join('\n');

      const copyBtn = wrap.querySelector('button');
      copyBtn.addEventListener('click', () => {
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        copyBtn.textContent = ok ? 'Skopiowane' : 'Ctrl+C';
        setTimeout(() => { copyBtn.textContent = 'Kopiuj'; }, 2000);
      });

      host.appendChild(wrap);
    });
  }

  async function runEanTool(panel) {
    const el = r => panel.querySelector('[data-role="' + r + '"]');
    const entries = parseInputList(el('input').value);
    const catalogFields = selectedFields(panel);
    const salesFields = selectedSalesFields(panel);
    const fields = catalogFields.concat(salesFields);

    if (!entries.length) { el('progress').textContent = 'Wklej najpierw listę.'; return; }
    if (!fields.length) { el('progress').textContent = 'Zaznacz, jakie dane mam pobrać.'; return; }

    const mode = el('mode-sku').checked ? 'sku'
      : el('mode-ean').checked ? 'ean'
      : el('mode-name').checked ? 'name' : 'auto';

    eanRun.running = true;
    eanRun.stop = false;
    el('start').style.display = 'none';
    el('stop').style.display = 'block';

    const results = [];
    const started = Date.now();

    try {
      for (let i = 0; i < entries.length; i++) {
        if (eanRun.stop) break;
        const entry = entries[i];
        const entryMode = mode !== 'auto' ? mode
          : looksLikeEan(entry) ? 'ean'
          : looksLikeSku(entry) ? 'sku' : 'name';

        el('progress').textContent = 'Sprawdzam ' + (i + 1) + ' z ' + entries.length +
          ': ' + entry.slice(0, 40);

        const values = {};
        let status = 'nie znaleziono w katalogu';
        // W wyniku pokazujemy to, czego naprawdę szukaliśmy — inaczej przy
        // wejściu „35776" nie widać, że odpytaliśmy o „0035776".
        const shown = entryMode === 'sku' ? normalizeSku(entry) : entry;
        try {
          const hit = await fetchRowForEntry(entry, entryMode);
          status = hit.status;
          if (hit.row) {
            catalogFields.forEach(f => { values[f.key] = readField(hit.row, f.field); });

            if (salesFields.length) {
              const sku = readField(hit.row, 'Item');
              el('progress').textContent = 'Historia sprzedaży ' + (i + 1) + ' z ' +
                entries.length + ': ' + sku;
              const stats = await fetchPriceStats(hit.row, sku, (n, page) => {
                el('progress').textContent = 'Historia sprzedaży ' + sku +
                  ': ' + n + ' pozycji, strona ' + page;
              });
              salesFields.forEach(f => { values[f.key] = stats.values[f.key] || ''; });
              if (stats.notes.length) {
                status = status === 'ok' ? stats.notes.join('; ')
                  : status + '; ' + stats.notes.join('; ');
              }
            }
          }
        } catch (err) {
          // Awaria jednej pozycji nie może przerwać listy — po 400 udanych
          // odczytach utrata całości byłaby dotkliwsza niż jedna luka.
          console.warn('[Dane z ERP] Błąd przy „' + entry + '":', err && err.message || err);
          status = 'błąd odczytu';
        }

        results.push({ entry: shown, values, status });
        await sleep(EAN_TOOL.DELAY_MS);
      }
    } finally {
      eanRun.running = false;
      el('stop').style.display = 'none';
      el('start').style.display = 'block';
    }

    const ok = results.filter(r => r.status === 'ok').length;
    const problems = results.filter(r => r.status !== 'ok');
    const secs = Math.round((Date.now() - started) / 1000);

    el('progress').textContent = 'Gotowe: ' + ok + ' z ' + entries.length +
      ' bez zastrzeżeń' + (eanRun.stop ? ' (przerwane)' : '') + ', ' + secs + ' s.';
    el('outbox').style.display = 'block';
    el('problems').textContent = problems.length
      ? 'Do sprawdzenia ręcznie (' + problems.length + '):\n' +
        problems.map(r => '• ' + r.entry + ' — ' + r.status).join('\n')
      : 'Wszystkie pozycje odczytane bez zastrzeżeń.';

    const render = () => renderColumns(panel, results, fields, {
      apostrophe: el('apo').checked,
      dot: el('dot').checked
    });
    render();
    el('apo').onchange = render;
    el('dot').onchange = render;

    el('csv').onclick = () => {
      const head = ['szukane'].concat(fields.map(f => f.label), ['status']).join(';');
      const body = results.map(r => ['"' + r.entry + '"']
        .concat(fields.map(f => '"' + (r.values[f.key] || '') + '"'), ['"' + r.status + '"'])
        .join(';')).join('\n');
      const blob = new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dane_z_erp.csv';
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  function insertEanButtonIfNeeded() {
    if (!EAN_TOOL.ENABLE) return;
    if (!location.href.includes(TARGET_URL_FRAGMENT)) return;
    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + EAN_TOOL.BUTTON_ID)) return;

    const b = document.createElement('div');
    b.id = EAN_TOOL.BUTTON_ID;
    b.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    b.style.cursor = 'pointer';
    b.innerHTML = '<div class="caption" title="Wklej listę SKU albo nazw z arkusza, ' +
      'odczytaj wybrane dane">🏷️ Dane z ERP</div>';
    b.addEventListener('click', () => {
      if (eanRun.running) return;
      const panel = createEanPanel();
      const el = r => panel.querySelector('[data-role="' + r + '"]');
      el('close').addEventListener('click', () => {
        eanRun.stop = true;
        panel.remove();
      });
      el('stop').addEventListener('click', () => {
        eanRun.stop = true;
        el('progress').textContent = 'Przerywam po bieżącej pozycji...';
      });
      el('start').addEventListener('click', () => runEanTool(panel));
      el('input').focus();
    });
    toolbar.appendChild(b);
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
    btn.innerHTML = '<div class="caption" title="Znajduje produkty kupowane razem ' +
      'z zaznaczonym produktem. Trwa około 3 minut — w trakcie kliknij ponownie, ' +
      'żeby zatrzymać.">' + ORIGINAL_BUTTON_TEXT + '</div>';
    btn.addEventListener('click', () => runFullPipeline(btn));
    toolbar.appendChild(btn);
  }

  // Ten sam skrypt obsługuje dwie domeny: w ERP dokłada przyciski, w sklepie
  // wyłącznie doklikuje produkt po SKU. Reszta logiki nie ma tam czego szukać.
  if (location.hostname === 'esavpol.pl') {
    runEsavpolHandler(0);
  } else if (generatorOrigin() && location.origin === generatorOrigin()) {
    // Zapas: wysyłka idzie już z ERP, ale gdy tam się nie udała (brak sieci,
    // wygasła sesja), tutaj użytkownik jest właśnie zalogowany.
    flushHistoryQueue();
  } else {
    setInterval(() => {
      insertButtonIfNeeded();
      insertEsavpolButtonIfNeeded();
      insertEanButtonIfNeeded();
    }, 1000);
  }

})();
