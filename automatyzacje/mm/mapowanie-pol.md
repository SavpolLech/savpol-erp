# Mapowanie pól: MM (przesunięcia magazynowe) ↔ ERP (UI)

Rodzaj dokumentu: **Przesunięcia magazynowe (MM)**.
Widok/lista w ERP: `https://erp.savpol.pl/pl/przesuniecia-magazynowe/csdocsheaders4goodstransfers`
(URL od Michała miał na końcu id konkretnego widoku `/213217693` — do listy
wystarcza sama ścieżka typu).

Tabele docelowe: **`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions`** (testowo:
`..._test`) — TE SAME co WZ. Michał: MM ląduje w tych samych tabelach, różni się
tylko `csDocsHeaders.csDocsTypesId` (wartość rozróżniająca typ) oraz para
magazynów: `csWarehousesId` (magazyn początkowy) i `csWarehousesIdDel` (magazyn
docelowy).

Zasada bazowa (Michał, 2026-09-15): **pobieramy ten sam zestaw danych co dla
WZ**. Dlatego mapowanie startuje 1:1 z `automatyzacje/wz/mapowanie-pol.md`, a
poniżej opisane są tylko RÓŻNICE dla MM. Pełne uzasadnienie „które pole skąd" —
patrz plik WZ.

## Status: 2 punkty do potwierdzenia sondą (reszta ustalona)

Sonda: `diagnostyka/wlacz-wszystkie-kolumny.js` (włącz wszystkie kolumny) →
`diagnostyka/sonda-lista-kolumn.js` (zrzuć mapę pól), osobno dla **listy MM** i
**karty pozycji MM**. Do domknięcia:

1. **`csWarehousesIdDel` (magazyn docelowy) — skąd w nagłówku?**
   Domyślnie bierzemy go z PIERWSZEJ pozycji dokumentu (jest w gridzie pozycji,
   tak jak przy WZ) — patrz `lib/fields.js` → `HEADER_FIELDS_FROM_FIRST_POSITION`.
   Sonda listy MM potwierdzi, czy `csWarehousesIdDel` jest też WPROST w gridzie
   nagłówka listy. Jeśli tak → przenieść do `HEADER_FIELDS` (wtedy działa nawet
   dla dokumentu bez pozycji). Jeśli nie → zostaje jak jest.
   `csWarehousesId` (magazyn początkowy) jest w gridzie nagłówka listy WZ →
   zakładamy to samo dla MM (do potwierdzenia tą samą sondą).

2. **Typ dokumentu na liście — czy trzeba filtrować podtypy?**
   `csDocsTypesId` jest scrapowany z gridu nagłówka (jest w `HEADER_FIELDS`) i
   niesie właściwą wartość MM sam z siebie — NIE jest stałą. URL listy już
   zawęża do przesunięć, więc `USE_DOC_TYPE_FILTER` domyślnie `false`. Sonda /
   podgląd listy potwierdzi, jaki prefiks pokazuje kolumna `DocNumber`
   (pogrubiony fragment) — trzeba go wpisać w `MM_DOC_TYPE_FILTER_LABEL`
   (domyślnie `'MM'`), bo to on filtruje wiersze po naszej stronie
   (`DOC_TYPES` w `scrape.js`). Jeśli lista miesza podtypy (MM/MMW/MMP…),
   doprecyzować listę akceptowanych prefiksów.

## Nagłówek (dbo.csDocsHeaders) — różnice względem WZ

- **Pola scrapowane wprost z gridu listy** (`HEADER_FIELDS`): identyczne jak WZ
  (23 pola), w tym `csWarehousesId` (magazyn początkowy) i `csDocsTypesId`.
- **Pola z pierwszej pozycji** (`HEADER_FIELDS_FROM_FIRST_POSITION`): jak WZ +
  **`csWarehousesIdDel`** (magazyn docelowy) — NOWE dla MM.
- **Pola niedostępne przez klikanie**: ta sama lista 17 pól co przy WZ (patrz
  plik WZ, sekcja „❌ Niedostępne") — decyzja Michała dla WZ była: mogą zostać
  NULL / część odzyskiwalna z `priceInfo` po stronie SQL. Dla MM zakładamy to
  samo, chyba że Michał wskaże inaczej.

## Pozycje (dbo.csDocsItemsPositions) — 55 pól, identycznie jak WZ

Bez zmian względem WZ (`POSITION_FIELDS` skopiowane 1:1). Te same 10 pól +
`ExchangeRate` trzeba WŁĄCZYĆ w panelu kolumn karty pozycji MM przed
scrapowaniem — najprościej sondą `wlacz-wszystkie-kolumny.js` (włącza wszystko
naraz). `csWarehousesId` i `csWarehousesIdDel` są w gridzie pozycji.

## Wartości stałe per typ (nie scrapowane) — `lib/fixed-values.js`

Źródło: zrzut Michała `MM_pola_wymagane.xlsx` (2026-09-15), arkusz 1 = flagi
nagłówka, arkusz 2 = flagi pozycji. Różnice względem WZ:

| Pole (nagłówek) | WZ | MM |
|---|---|---|
| `anaKind` | 2 | **0** |
| `anaUse` | 1 | **0** |
| `csDocumentsGenType` | 1 | **0** |
| `IsDocNumberExtVisible` | 0 | **1** |
| `IsHeaderDimensionsRequired` | 0 | **1** |
| `ShipmentType` | 0 | **NULL** (pomijamy — kolumna nullable, zostaje pusta) |
| `Cor` | 0 | 0 (bez zmian) |

Pozostałe flagi nagłówka i **wszystkie** flagi pozycji (`IsFromDiscountCodes=0`,
`IsPosVat=1`, `OperationKind=0`, `SEZKind=0`, `ShowAddInfo=0`) — identyczne jak
WZ. `createdDate` pozycji = `DocDate` nagłówka (reguła, liczona w `scrape.js`).

## Następny krok

1. Włącz wszystkie kolumny na liście MM i na karcie pozycji MM
   (`wlacz-wszystkie-kolumny.js`), zdejmij mapę pól (`sonda-lista-kolumn.js`) —
   wklej oba zrzuty do rozmowy.
2. Domknij 2 punkty wyżej (`csWarehousesIdDel` w nagłówku, prefiks typu na
   liście). To zamyka „do ustalenia" w tym pliku.
3. `node generate-test-tables.js` → `schema-test-tables.json` (typy z prawdziwych
   tabel `_test` w worek).
4. Próbka `MAX_DOCS=5`, jeden dzień → weryfikacja przez koordynatora, ZANIM
   podniesiemy limit do ~900 (jak przy WZ).
