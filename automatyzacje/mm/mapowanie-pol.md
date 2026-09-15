# Mapowanie pól: MM (przesunięcia magazynowe) ↔ ERP (UI)

Rodzaj dokumentu: **Przesunięcia magazynowe** — konkretnie podtyp „Przesunięcie
magazynowe", `csDocsTypesId = 269000798`.
Widok/lista w ERP: `https://erp.savpol.pl/pl/przesuniecia-magazynowe/csdocsheaders4goodstransfers`

Tabele docelowe: **`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions`** (testowo:
`..._test`) — TE SAME co WZ (Michał). MM różni się `csDocsTypesId` oraz parą
magazynów `csWarehousesId` (początkowy) / `csWarehousesIdDel` (docelowy).

**Status: mapowanie KOMPLETNE (0 „do ustalenia").** Zweryfikowane na żywym ERP
2026-09-15 (zalogowana sesja, wszystkie ~337 kolumn listy / 161 pozycji
włączone). Wszystkie nazwy pól zgadzają się 1:1 z WZ — **żadne pole nie ma innej
nazwy i żadnego nie brakuje**. Trzy różnice dotyczą LOGIKI DOM, nie nazw pól:

## 3 różnice MM vs WZ (wykryte na żywym ERP)

1. **Filtr typu dokumentu — po `csDocsTypesId`, nie po pogrubieniu.**
   Lista `csdocsheaders4goodstransfers` miesza dwa podtypy:
   - `269000798` = „Przesunięcie magazynowe" ← **NASZE**
   - `410690539` = „Usunięcie blokady produktu" ← odrzucamy
   Typ NIE jest pogrubiony w kolumnie `DocNumber` (przy WZ był — `.cs-style-text-bold`).
   `scrape.js` filtruje więc wiersze po znormalizowanym `csDocsTypesId ===
   MM_DOC_TYPE_ID` (`269000798`, zmienna `MM_DOC_TYPE_ID`). `USE_DOC_TYPE_FILTER`
   zostaje `false` — nie potrzeba zapisanego filtra ERP.

2. **Wiersz pozycji — rozpoznawany po niepustym `ItemDesc`, nie po SKU w bold.**
   W karcie MM `ItemDesc` NIE ma `.cs-style-text-bold` — nazwa towaru to zwykły
   tekst w atrybucie `title`. Filtr WZ (SKU w pogrubieniu) odrzuciłby wszystkie
   realne pozycje. `scrape.js` uznaje wiersz za realną pozycję, gdy `ItemDesc`
   i `csItemsId` są niepuste.

3. **7 pól nagłówka jest wprost w gridzie listy MM** (przy WZ trzeba je było
   brać z pierwszej pozycji): `ExchangeRate`, `csCurrenciesId`, `S01Amount`,
   `S02Amount`, `DocWeight`, `DocGrossWeight`, `csWarehousesIdDel`. Wszystkie
   renderują poprawne wartości per dokument (potwierdzone: `csWarehousesId` i
   `csWarehousesIdDel` różne dla każdego przesunięcia). Dlatego w `lib/fields.js`
   są w `HEADER_FIELDS` (30 pól), a `HEADER_FIELDS_FROM_FIRST_POSITION` jest
   PUSTE — nagłówek nie zależy już od tego, czy dokument ma pozycje.

## Nagłówek (dbo.csDocsHeaders) — 40 pól scrapowanych z gridu listy

`HEADER_FIELDS` (40): 23 pola jak WZ + 7 z punktu 3 wyżej + 10 pól, które przy
WZ były „niedostępne", a w BOGATSZYM gridzie listy MM (337 kolumn) SĄ dostępne.

**Aktualizacja 2026-09-15 — 10 z 17 „niedostępnych" pól WZ jest dostępnych w MM.**
Sprawdzone w panelu wyboru kolumn na żywej liście MM (337 pól dostępnych vs 163
przy WZ). Z 17 pól WZ „niedostępnych przez UI":
- **6 już rozwiązanych przez wartości stałe** (xlsx Michała): `Cor`, `anaKind`,
  `anaUse`, `IsOffInvoice` = stałe; `ShipmentType` = NULL (decyzja);
  `TermsFromPayer` = odzyskiwalne z XML `priceInfo`.
- **10 DOSTĘPNYCH w gridzie listy MM** (były tylko wyłączone) → dodane do
  `HEADER_FIELDS`, scrapujemy realne wartości: `PaymentDay`, `csPaymentsTypesId`,
  `csPeriodsId`, `csDocsHeadersStatusId`, `csVATPeriodsId`, `csEmployeesId`,
  `csB2BPortalsId`, `csB2BPortalsDeliveryMethodsId`, `csPayersId`, `anaDocDate`.
  Część może być pusta dla przesunięć wewnętrznych (płatności/B2B) — zejdą jako
  NULL, to poprawne; próbka pokaże, które są wypełnione.
- **1 NIEDOSTĘPNE w MM**: `DocRecipientDate` (brak kolumny i wariantu w gridzie
  listy) → zostaje NULL. To jedyne technicznie nieosiągalne pole nagłówka MM.

⚠️ **Krok w ERP wymagany przed scrapowaniem tych 10:** włącz je w panelu kolumn
listy (`diagnostyka/zostaw-tylko-potrzebne-kolumny.js` → `savpolZostawKolumny(KEEP_LISTA)`,
już zaktualizowane do 40), a następnie **ZAPISZ nowy układ listy i ustaw go jako
DOMYŚLNY** — inaczej ERP nie zapamięta włączonych kolumn i po odświeżeniu
scraper ich nie zobaczy.

## Pozycje (dbo.csDocsItemsPositions) — 56 pól, wszystkie obecne

`POSITION_FIELDS` identyczne jak WZ. Potwierdzone na karcie MM: wszystkie 56 pól
obecne w gridzie pozycji (161 kolumn po włączeniu wszystkiego), `ItemDesc` też
(potrzebny do wykrycia gridu i filtra wierszy — patrz różnica 2).

## Wartości stałe per typ (nie scrapowane) — `lib/fixed-values.js`

Źródło: zrzut Michała `MM_pola_wymagane.xlsx` (2026-09-15). Różnice względem WZ:
`anaKind` 2→0, `anaUse` 1→0, `csDocumentsGenType` 1→0, `IsDocNumberExtVisible`
0→1, `IsHeaderDimensionsRequired` 0→1, `ShipmentType` 0→NULL (pominięte). `Cor`=0.
Flagi pozycji i reszta flag nagłówka — jak WZ. `createdDate` pozycji = `DocDate`
nagłówka (reguła w `scrape.js`).

## Redukcja kolumn w ERP

Po zdjęciu mapy odchudź gridy do minimum, którego skrypt używa
(`diagnostyka/zostaw-tylko-potrzebne-kolumny.js`): lista → `KEEP_LISTA` (40),
karta pozycji → `KEEP_POZYCJE` (57, z `ItemDesc`). 300+ kolumn/wiersz
niepotrzebnie spowalnia renderowanie. Pamiętaj zapisać układ listy jako
DOMYŚLNY (patrz wyżej).

## Następny krok

1. `node generate-test-tables.js` → `schema-test-tables.json` (typy z tabel
   `_test` w worek).
2. Próbka `MAX_DOCS=5`, jeden dzień → weryfikacja przez koordynatora ZANIM
   podniesiemy limit do ~900 (jak przy WZ).
3. W ERP: włączyć 10 nowych pól nagłówka na liście MM i zapisać układ jako
   DOMYŚLNY (patrz sekcja Nagłówek). Bez tego te 10 kolumn nie renderuje się w
   wierszach i scraper zapisze je jako NULL.
4. (Biznesowe, drobne) `DocRecipientDate` jest jedynym polem nagłówka
   nieosiągalnym przez UI dla MM — potwierdzić z Michałem, czy to problem
   (dla przesunięcia wewnętrznego raczej nieistotne).
