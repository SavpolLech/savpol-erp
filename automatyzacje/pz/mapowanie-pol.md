# Mapowanie pól: PZ (Przyjęcie zewnętrzne) ↔ ERP (UI)

Źródło: Michał, wiadomość + `PZ_pola_wymagane.xlsx` (2026-09-17) + sonda na
żywym ERP tego samego dnia (`diagnostyka/sonda-pz-dom.js`, wyniki w
`diagnostyka/PZ/*.txt`, dokument testowy `2026/PZ/WLS1/004716`).

Rodzaj dokumentu: **Przyjęcie zewnętrzne (PZ)**.
Widok/lista w ERP: `https://erp.savpol.pl/pl/przychody-zewnetrzne/csdocsheaders4goodsreceivednotes`
— potwierdzone na żywo, ładuje listę PZ poprawnie.

Tabele docelowe: **`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions`** — te same
co WZ i MM (Michał: ten sam zestaw danych, różni się `csDocsTypesId`,
potwierdzone na żywym dokumencie: `csDocsTypesId = 213 217 940`). Testowo:
`..._test`. **Nadal DO USTALENIA z Michałem**: czy wspólne
`csDocsHeaders_test` / `csDocsItemsPositions_test` (już używane przez WZ i MM)
obsłużą też próbkę PZ, czy PZ dostanie własne testowe tabele — kod
(`lib/fields.js`) zakłada wspólne, zgodnie ze wzorcem MM, ale to założenie
trzeba potwierdzić przed `generate-test-tables.js`.

**Status: KOMPLETNE (0 „do ustalenia").** Zweryfikowane na żywym ERP
2026-09-17 (zalogowana sesja, wszystkie kolumny włączone — potwierdzone w
`diagnostyka/PZ/savpolPzSondaKolumny.txt`, panel pozycji: 172/172 pól
WŁĄCZONE). Grid PZ okazał się **bogaty jak MM**, nie ubogi jak WZ — prawie
wszystkie pola z listy Michała renderują się wprost w gridzie listy, bez
potrzeby brania czegokolwiek z pierwszej pozycji.

## Co się różni od WZ (wykryte na żywym ERP, analogicznie do sekcji MM)

1. **Filtr typu dokumentu — po kolumnie `DocType`, nie po pogrubieniu ani
   `csDocsTypesId`.** Lista `csdocsheaders4goodsreceivednotes` miesza podtypy
   (PZ, PZW, PZI, PZK, PZT, PZUE, PZZ...). Kolumna `DocType` w gridzie listy
   zawiera gotowy tekstowy skrót (potwierdzone: `DocType="PZ"`,
   `DocTypeTranslatedDesc="Przyjęcie zewnętrzne"` na dokumencie
   `2026/PZ/WLS1/004716`) — czystszy sygnał niż pogrubiony tekst (WZ) albo
   `csDocsTypesId` (MM, wymaga stałej per instalację). `scrape.js` filtruje
   wiersze po `DocType === 'PZ'`.
2. **Zapisany filtr ERP o nazwie „PZ" — dodany przez użytkownika 2026-09-23.**
   Pierwotna sonda (2026-09-17) nie znalazła żadnego takiego filtra (tylko
   "Przychody zewnętrzne" mieszające wszystkie podtypy + dwa "xx..." widoki
   administracyjne) — `USE_DOC_TYPE_FILTER` zaczynało jako `false`. Po
   dodaniu filtra "PZ" w ERP przetestowane na żywo: zawęża listę
   **2581 → 2175 rekordów**, wszystkie widoczne wiersze mają `DocType="PZ"`.
   `USE_DOC_TYPE_FILTER` jest teraz **domyślnie włączony** (jak WZ) —
   filtrowanie po `DocType` w `scanCurrentPageForDocs` zostaje jako druga
   linia obrony niezależnie od tego (gdyby zapisany filtr kiedyś zniknął albo
   zmienił nazwę), dokładnie tak jak `DOC_TYPES` przy WZ.
3. **Wiersz pozycji — rozpoznawany po pogrubionym SKU w `ItemDesc`, jak WZ
   (NIE jak MM).** Potwierdzone `diagnostyka/PZ/savpolPzSondaSurowyWiersz.txt`:
   `ItemDesc bold=[0000261]` (numer SKU pogrubiony). Filtr WZ (SKU w
   pogrubieniu) działa więc bez zmian.
4. **7 pól, które przy WZ trzeba było brać z pierwszej pozycji, są wprost w
   gridzie listy PZ** (jak przy MM): `ExchangeRate`, `csCurrenciesId`,
   `S01Amount`, `S02Amount`, `DocWeight`, `DocGrossWeight`, `csWarehousesIdDel`.
   Potwierdzone wartościami na żywym dokumencie: `ExchangeRate=1`,
   `csCurrenciesId=401807`, `DocWeight=2560`, `DocGrossWeight=2560,4`
   (`csWarehousesIdDel` obecne, ale puste — PZ nie ma "drugiego" magazynu).
   `HEADER_FIELDS_FROM_FIRST_POSITION` jest więc PUSTE — nagłówek nie zależy
   od tego, czy dokument ma pozycje.

## Nagłówek (dbo.csDocsHeaders) — 41 pól scrapowanych z gridu listy

`HEADER_FIELDS` (41): 23 pola jak WZ + 7 z punktu 4 wyżej + 11 pól, które przy
WZ były „niedostępne przez UI", a w BOGATSZYM gridzie listy PZ SĄ dostępne.

**16 z 17 „niedostępnych" pól WZ jest dostępnych w PZ** (jeszcze więcej niż w
MM, gdzie było 10/17). Z 17 pól WZ „niedostępnych przez UI":
- **5 rozwiązanych przez wartości stałe** (xlsx Michała, `Dh`, potwierdzone
  identyczne wartości na żywym dokumencie): `Cor=0`, `anaKind=0`, `anaUse=0`,
  `ShipmentType=0`, `IsOffInvoice=0` — świadomie ZOSTAJĄ jako stałe w
  `lib/fixed-values.js` mimo że są też widoczne w gridzie (Michał podaje je
  jako atrybuty TYPU dokumentu, nie per-dokument; `applyFixedValues` w
  `scrape.js` i tak by je nadpisał, więc nie dublujemy odczytu).
- **11 DOSTĘPNYCH i SCRAPOWANYCH** (realne wartości per dokument, potwierdzone
  na żywo): `PaymentDay=21`, `csPaymentsTypesId`, `csPeriodsId`,
  `csDocsHeadersStatusId`, `csVATPeriodsId`, `csEmployeesId` (puste dla tego
  dokumentu, kolumna jednak istnieje), `csB2BPortalsId`,
  `csB2BPortalsDeliveryMethodsId`, `csPayersId`, `anaDocDate`,
  `TermsFromPayer=0` (przy WZ „odzyskiwalne z XML priceInfo" — dla PZ jest
  wprost w gridzie, więc scrapujemy bezpośrednio, bez parsowania XML).
- **1 NIEDOSTĘPNE w PZ** (jak w MM): `DocRecipientDate` — sprawdzone w liście i
  w karcie dokumentu, brak w obu. Zostaje NULL. Jedyne technicznie
  nieosiągalne pole nagłówka PZ.

## Pozycje (dbo.csDocsItemsPositions) — 55 pól, wszystkie obecne

`POSITION_FIELDS` identyczne jak WZ i MM. Potwierdzone na karcie PZ (dokument
`2026/PZ/WLS1/004716`, panel kolumn 172/172 pól WŁĄCZONE): wszystkie 55 pól
obecne z realnymi wartościami per pozycja, `ItemDesc` z pogrubionym SKU
(potrzebne do wykrycia gridu i filtra realnych wierszy — patrz punkt 3 wyżej).

## Wartości stałe per typ (nie scrapowane) — `lib/fixed-values.js`

Źródło: arkusz `Dh`/`Dip` w `PZ_pola_wymagane.xlsx` — PRAWDZIWE wartości z
bazy, **potwierdzone identyczne na żywym dokumencie** (sonda 2026-09-17).

**Różnice względem WZ (5 pól):**

| Pole | WZ | PZ |
|---|---|---|
| `anaKind` | 2 | **0** |
| `anaUse` | 1 | **0** |
| `csDocumentsGenType` | 1 | **0** |
| `IsDocNumberExtVisible` | 0 | **1** |
| `PricesPrecision` | 2 | **6** |

Reszta flag nagłówka (43 pola) — identyczne jak WZ, w tym `Cor`=0,
`ShipmentType`=0. Flagi pozycji (`Dip`) — **identyczne jak WZ**:
`IsFromDiscountCodes`=0, `IsPosVat`=1, `OperationKind`=0, `SEZKind`=0,
`ShowAddInfo`=0. `createdDate` pozycji = `DocDate` nagłówka tego samego
dokumentu (reguła, liczona w `scrape.js`).

## Redukcja kolumn w ERP

Nie wymagana teraz — użytkownik już włączył wszystkie kolumny na czas sondy
(diagnostyka), co jest wystarczające i nie spowalnia scrapowania próbki 5
dokumentów. Do rozważenia po zatwierdzeniu próbki: odchudzić grid do
`HEADER_FIELDS`/`POSITION_FIELDS` (`diagnostyka/zostaw-tylko-potrzebne-kolumny.js`
z nowymi listami `KEEP_LISTA_PZ`/`KEEP_POZYCJE_PZ`), jak przy MM.

## Próbka wykonana na żywo (2026-09-18) — dwa błędy znalezione i naprawione

Pierwsze uruchomienie na próbce (`MAX_DOCS=5`, `FILTER_DATE=2026-07-01`)
kończyło się za każdym razem `docs: 0` mimo że lista miała 178 dokumentów.
Dwa niezależne błędy, oba naprawione w `scrape.js`:

1. **Nawigacja do listy wyłącznie przez menu.** `page.goto()` bezpośrednio na
   adres listy PZ (nawet po "rozgrzaniu" SPA inną stroną) zawsze ląduje z
   powrotem na dashboardzie — grid się nie renderuje. Działa tylko klik przez
   menu: Logistyka -> "Przychody zewnętrzne" (`navigateToPzList()`). Nieznane,
   czy to specyfika tej konkretnej podstrony, czy dotyczy też innych — WZ/MM
   nawigują przez `page.goto()` bez problemu.
2. **Paginacja wielostronicowa w JEDNYM `page.evaluate()` była niestabilna w
   tej sesji ERP** (dużo błędów WebSocket/socket.io w tle) — funkcja
   `scrapePzInPage` potrafiła przejść "wirtualnie" przez wszystkie 9 stron
   (pageNum rosnący w logu) z zerem zebranych dokumentów, mimo że niezależny
   skan tych samych stron (osobne, krótkie `page.evaluate()` per strona)
   niezmiennie znajdował dziesiątki dokumentów PZ od strony 2. Naprawa:
   `scrapePzInPage` rozbite na `scanCurrentPageForDocs` (działa WYŁĄCZNIE na
   aktualnie załadowanej stronie) + `advanceToNextPage` (osobne, krótkie
   wywołanie — tylko klik "dalej"), wołane na przemian z `main()`. Przy okazji
   naprawiony pomniejszy bug: `rowsChanged` w starym `goToNextPage` porównywał
   tylko wiersze pasujące do filtra typu (`targetRows()`), nie wszystkie
   wiersze strony (`listRows()`) — fałszywie widział "brak zmiany" na
   przejściu między dwiema stronami bez żadnego "PZ".
3. **Zły selektor przycisku otwierającego dokument.** Prawdziwy błąd, nie
   related do niestabilności środowiska: `.csButtonAction` wewnątrz komórki
   `DocNumber` NIE ISTNIEJE w tym widoku — ta komórka to zwykły tekst.
   Prawdziwy przycisk "Pokaż" jest wewnątrz komórki **`DocDate`** (potwierdzone
   zrzutem HTML), i to pierwszy z dwóch `.csButtonAction` w tej komórce (drugi
   to link "Nr dok.", inna akcja — link do powiązanego dokumentu zakupowego).
   To inny układ DOM niż WZ (gdzie przycisk jest wprost w komórce `DocNumber`)
   — zapisany dla przyszłych typów dokumentów, żeby nie zakładać z góry.

Dodatkowo: `pagerHasNextPage()` bywał niestabilny (pojedynczy odczyt "false"
mimo że strona miała kolejną) — dodano drugi odczyt po 400ms zanim uznamy
listę za wyczerpaną.

**Wynik po naprawie**: 5 dokumentów PZ, 18 pozycji, zebrane poprawnie z
`2026-07-01` (`2026/PZ/WLS1/003573`…`003577`). CSV wysłany do weryfikacji.

## Następny krok

1. **Potwierdzić z Michałem nazwę tabeli testowej** (wspólna z WZ/MM czy
   osobna) — blokuje ostateczny zapis do bazy (na razie próbka szła do CSV).
2. Po potwierdzeniu: `node generate-test-tables.js` → `schema-test-tables.json`
   (typy z prawdziwych tabel testowych w `worek`) i zapis próbki bezpośrednio
   do bazy zamiast CSV.
3. Wysłać CSV z próbką do Michała do porównania 1:1 z danymi produkcyjnymi
   (`2026/PZ/WLS1/003573`…`003577`, dzień `2026-07-01`).
4. (Biznesowe, drobne) `DocRecipientDate` jest jedynym polem nagłówka PZ
   nieosiągalnym przez UI — potwierdzić z Michałem, czy to problem.
5. Do rozważenia: czy problem #1 (nawigacja tylko przez menu) dotyczy też
   innych podstron poza listą PZ — jeśli tak, warto to odnotować jako ogólną
   wskazówkę dla przyszłych typów dokumentów w `SZABLON-prompt-nowy-scraper.md`.
