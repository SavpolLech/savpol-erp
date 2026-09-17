# Mapowanie pól: PZ (Przyjęcie zewnętrzne) ↔ ERP (UI)

Źródło: Michał, wiadomość + `PZ_pola_wymagane.xlsx` (2026-09-17). Pełny zrzut
arkusza: `automatyzacje/pz/info/od-michala-1.txt`.

Rodzaj dokumentu: **Przyjęcie zewnętrzne (PZ)**.
Widok/lista w ERP: `https://erp.savpol.pl/pl/przychody-zewnetrzne/csdocsheaders4goodsreceivednotes`
(z hrefa w treści zadania — **do potwierdzenia przy pierwszym wejściu**, patrz
info/od-michala-1.txt).

Tabele docelowe: **`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions`** — Michał
wprost: "ten sam zestaw co dla WZ, zmieni się przede wszystkim csDocsTypesId"
(dokładnie ten sam wzorzec co przy MM). **Tabele testowe: DO USTALENIA z
Michałem** — czy wspólne `csDocsHeaders_test` / `csDocsItemsPositions_test`
(używane już przez WZ i MM, rozróżnienie przez `csDocsTypesId`) obsłużą też PZ,
czy PZ dostanie własne testowe tabele. Nie blokuje to reszty mapowania (pola są
te same niezależnie od nazwy tabeli), ale blokuje `generate-test-tables.js` —
rozstrzygnąć przed krokiem 4.

**Status: ROBOCZE.** Pola przejęte 1:1 z `automatyzacje/wz/lib/fields.js`
(Michał potwierdza identyczny zestaw) — to jest DECYZJA, nie "do ustalenia",
ale wymaga potwierdzenia na żywym gridzie PZ w kroku diagnostyki (krok 2), bo
każdy typ dokumentu renderuje inny zestaw kolumn zależnie od uprawnień/widoku
(WZ: 163 pola w panelu nagłówka; MM: 337 — grid PZ może być inny niż oba).
Zero pól ma tu status "nie wiem skąd wziąć" — każde ma przypisaną kategorię
niżej, ewentualne korekty po sondzie idą jako aktualizacja tego pliku (tak jak
przy MM, sekcja "3 różnice MM vs WZ").

## Nagłówek (dbo.csDocsHeaders) — plan 1:1 z WZ, do potwierdzenia sondą

### Prawdopodobnie wprost w gridzie listy PZ (23 pola, jak WZ)

`csDocsHeadersId`, `csDocsHeadersG`, `csCompaniesId`, `csDocsTypesId`, `DocNo`,
`DocNumber`, `DocNumberExt`, `CGAmount`, `CNAmount`, `CTAmount`, `FGAmount`,
`FNAmount`, `FTAmount`, `DocDate`, `DocDateExt`, `csCustomersId`, `PaymentDate`,
`DocSaleDate`, `DocVATDate`, `Stock`, `csWarehousesId`, `FStock`, `DocNumberExtAdd2`

### Prawdopodobnie z pierwszej pozycji dokumentu (6 pól, jak WZ)

`ExchangeRate`, `csCurrenciesId`, `S01Amount`, `S02Amount`, `DocWeight`,
`DocGrossWeight` — **UWAGA**: przy MM te same 6 pól okazały się WPROST w
gridzie listy (grid MM bogatszy niż WZ) — sonda rozstrzygnie, czy PZ zachowuje
się jak WZ czy jak MM. Jeśli wprost w liście, `HEADER_FIELDS_FROM_FIRST_POSITION`
zostaje puste i te pola przechodzą do `HEADER_FIELDS` (dokładnie jak w MM).

### Niedostępne przy WZ — status do potwierdzenia sondą, NIE zakładamy z góry

17 pól, które przy WZ nie istniały w żadnym gridzie: `PaymentDay`,
`csPaymentsTypesId`, `csPeriodsId`, `DocRecipientDate`, `csDocsHeadersStatusId`,
`csVATPeriodsId`, `Cor`, `csEmployeesId`, `ShipmentType`, `IsOffInvoice`,
`csB2BPortalsId`, `csB2BPortalsDeliveryMethodsId`, `csPayersId`,
`TermsFromPayer`, `anaKind`, `anaUse`, `anaDocDate`.

Rozstrzygnięcie per pole (żeby "0 do ustalenia" już teraz — sonda tylko
POTWIERDZA lub koryguje, nie jest warunkiem wstępnym):

- `Cor`, `anaKind`, `anaUse`, `IsOffInvoice`, `ShipmentType` → **wartość stała**
  (patrz sekcja niżej) — Michał podał je w arkuszu `Dh`, nie trzeba ich
  scrapować niezależnie od tego, co pokaże grid.
- `TermsFromPayer` → **odzyskiwalne z XML** w kolumnie `priceInfo` pozycji
  (jak przy WZ) — nie parsujemy w scraperze, dostępne downstream przez SQL.
- Pozostałe 10 (`PaymentDay`, `csPaymentsTypesId`, `csPeriodsId`,
  `DocRecipientDate`, `csDocsHeadersStatusId`, `csVATPeriodsId`,
  `csEmployeesId`, `csB2BPortalsId`, `csB2BPortalsDeliveryMethodsId`,
  `csPayersId`, `anaDocDate`) → **domyślnie NULL** (niedostępne), ALE sonda w
  kroku 2 sprawdzi, czy grid PZ jest bogatszy (jak MM, gdzie 10 z tych samych
  17 pól okazało się dostępnych po włączeniu kolumn) — jeśli tak, przechodzą
  do `HEADER_FIELDS` ze scrapowaną wartością, tak jak przy MM.

## Pozycje (dbo.csDocsItemsPositions) — plan 1:1 z WZ (55 pól)

`POSITION_FIELDS` identyczne jak WZ i MM — Michał: ten sam zestaw danych.
Potwierdzone w arkuszu "Przykladowe pozycje" — wszystkie nazwy kolumn 1:1.
Które z nich trzeba włączyć w panelu kolumn PZ (jak przy WZ: 10 pól trzeba było
włączyć) — do sprawdzenia sondą, nie zgadujemy.

## Wartości stałe per typ (nie scrapowane) — `lib/fixed-values.js` (do zapisania w kroku 3)

Źródło: arkusz `Dh`/`Dip` w `PZ_pola_wymagane.xlsx` — to są PRAWDZIWE wartości z
bazy (zrzut, nie zgadywanie), nie wymagają potwierdzenia sondą w przeglądarce.

**Różnice względem WZ (5 pól):**

| Pole | WZ | PZ |
|---|---|---|
| `anaKind` | 2 | **0** |
| `anaUse` | 1 | **0** |
| `csDocumentsGenType` | 1 | **0** |
| `IsDocNumberExtVisible` | 0 | **1** |
| `PricesPrecision` | 2 | **6** |

Reszta flag nagłówka (43 pola) — identyczne jak WZ, w tym `Cor`=0,
`ShipmentType`=0 (dopisane analogicznie do WZ, wartości z arkusza `Dh` — kolumna
`IsOffInvoice` występuje w arkuszu dwukrotnie, ta sama wartość 0 za każdym razem,
traktujemy jako jeden klucz).

Flagi pozycji (`Dip`) — **identyczne jak WZ**: `IsFromDiscountCodes`=0,
`IsPosVat`=1, `OperationKind`=0, `SEZKind`=0, `ShowAddInfo`=0.

`createdDate` pozycji = `DocDate` nagłówka tego samego dokumentu (reguła, nie
stała — jak WZ/MM, liczone w `scrape.js`).

## Filtr typu dokumentu — do ustalenia sondą (nie zgadujemy)

Per przykładowy `DocNumber` w arkuszu (`2026/PZ/WLS1/003731`) etykieta typu to
najpewniej `PZ`, ale z tabeli `anaKind`/`anaUse` per typ dokumentu (mail Michała
z WZ, 2026-09-09) widać, że lista dokumentów "przychody zewnętrzne" może mieszać
podtypy: `PZ`, `PZW`, `PZI`, `PZIK`, `PZK`, `PZT`, `PZUE`, `PZUEK`, `PZZ`,
`PZZk`, `PZZR`. Bierzemy **tylko `PZ`** (jak WZ brał tylko `WZ`, nie `WZZ`),
chyba że Michał powie inaczej.

Dwa możliwe mechanizmy filtrowania (rozstrzyga sonda, jak przy MM):

1. **Jak WZ** — pogrubiony tekst w komórce `DocNumber` (`.cs-style-text-bold`)
   równy `"PZ"`, ewentualnie zapisany filtr ERP o nazwie "PZ" (jak
   `setDocTypeFilter(page, 'WZ')`).
2. **Jak MM** — typ NIE jest pogrubiony, trzeba filtrować po znormalizowanym
   `csDocsTypesId` (stała per instalacja ERP, MM miał `269000798`) zamiast po
   tekście.

Domyślnie w kodzie zakładamy wariant 1 (jak WZ, bo lista Michała używa
klasycznego układu listy "csdocsheaders4..." podobnego do WZ, nie do
przesunięć), ale **scrape.js nie może zostać napisany, dopóki sonda tego nie
potwierdzi** — błędne założenie znaczy zbieranie złych dokumentów (np. razem z
korektami PZK albo zwrotami PZZ).

## Wiersz pozycji — do ustalenia sondą

WZ rozpoznawał realny wiersz pozycji po pogrubionym SKU w `ItemDesc`; MM — po
niepustym `ItemDesc` (bez pogrubienia). Dla PZ nie zakładamy z góry, sonda
(`savpolPzSondaKarta()` / `savpolPzSondaSurowyWiersz()`) pokaże, czy `ItemDesc`
ma `.cs-style-text-bold` na karcie PZ.

## Następny krok

1. **Włącz wszystkie kolumny** w panelu kolumn ERP (lista PZ i karta pozycji
   PZ) — bez tego sonda nie zobaczy pól, które istnieją, ale są wyłączone
   (patrz `diagnostyka/wlacz-wszystkie-kolumny.js`).
2. Wklej `diagnostyka/sonda-pz-dom.js` w konsoli:
   - na liście PZ → `savpolPzSondaLista()`
   - po otwarciu jednego dokumentu PZ → `savpolPzSondaKarta()` i
     `savpolPzSondaSurowyWiersz()`
   - jeśli otwarty jest panel wyboru kolumn (osobno dla listy i dla karty
     pozycji) → `savpolPzSondaKolumny()`
   - `savpolPzSondaKopiuj()` → wynik do schowka, wklej tutaj.
3. Na podstawie sondy: zaktualizować ten plik (sekcje "do potwierdzenia" wyżej)
   i dopiero wtedy napisać `lib/fields.js` + `lib/fixed-values.js` +
   `scrape.js` (klon `automatyzacje/wz/`, różnice wyłącznie: URL listy, treść
   `lib/fields.js`, treść `lib/fixed-values.js`, ewentualnie logika filtra typu
   dokumentu/wiersza pozycji jeśli sonda pokaże wariant MM zamiast WZ).
4. `node generate-test-tables.js` na PRAWDZIWYM schemacie (po ustaleniu nazwy
   tabeli testowej z Michałem) → `schema-test-tables.json`.
5. Próbka `MAX_DOCS=5`, jeden dzień → weryfikacja przez koordynatora ZANIM
   podniesiemy limit (jak przy WZ i MM).
