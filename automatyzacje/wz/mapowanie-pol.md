# Mapowanie pól: dbo.csDocsHeaders / dbo.csDocsItemsPositions ↔ ERP (UI)

Źródło: Michał (migracja danych), 2026-09-07. Docelowe tabele:
`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions` (testowo: `..._test`).

Potwierdzone na podstawie **pełnego zrzutu panelu wyboru kolumn ERP**
(`diagnostyka/sonda-lista-kolumn.js`, 2026-09-07: `automatyzacje/wz/zrzut-kolkumn-erp.txt`,
Panel #0 = nagłówek listy WZ, 163 pola; Panel #10 = pozycje karty WZ, 157 pól).
To nie jest już zgadywanie — panel pokazuje WSZYSTKIE pola dostępne w danym
gridzie, włączone i wyłączone.

**Zmiana zakresu:** ten zestaw pól ma objąć różne typy dokumentów, nie tylko
WZ. Mapujemy pod kątem WZ (to, co przetestowane); dla innych typów dokumentów
(FA, ZO...) panel kolumn trzeba będzie sprawdzić osobno — część pól (VAT,
terminy płatności) może być tam dostępna inaczej niż dla WZ.

## dbo.csDocsItemsPositions — 55/55 pól, 100% pokrycia

Wszystkie pola z listy Michała są w Panelu #10. Status WŁĄCZONE/wyłączone wg
zrzutu z 2026-09-07 — **trzeba włączyć w ERP przed uruchomieniem scrapera**:

| Pole (DB) | Stan w ERP |
|---|---|
| csCompaniesId | ⬜ włącz |
| csDocsHeadersId | ⬜ włącz |
| csDocsItemsPositionsId | ⬜ włącz |
| csDocsItemsPositionsG | ✅ już włączone |
| Id | ✅ już włączone |
| csItemsId | ✅ już włączone |
| csItemsUnitsId | ✅ już włączone |
| csVATRatesId | ✅ już włączone |
| QuantityUnits | ✅ już włączone |
| Quantity | ✅ już włączone |
| Discount | ✅ już włączone |
| CUnitPrice | ✅ już włączone |
| CUnitNetPrice | ✅ już włączone |
| FUnitNetPrice | ✅ już włączone |
| CUnitGrossPrice | ✅ już włączone |
| FUnitGrossPrice | ✅ już włączone |
| CNetPrice | ✅ już włączone |
| FNetPrice | ✅ już włączone |
| CGrossPrice | ✅ już włączone |
| FGrossPrice | ✅ już włączone |
| CGAmount | ⬜ włącz |
| CNAmount | ⬜ włącz |
| CTAmount | ⬜ włącz |
| FGAmount | ⬜ włącz |
| FNAmount | ⬜ włącz |
| FTAmount | ⬜ włącz |
| csCurrenciesId | ✅ już włączone |
| PositionDesc | ✅ już włączone |
| Rate | ✅ już włączone |
| FStock | ✅ już włączone |
| QStock | ⬜ włącz |
| dCGAmount / dCNAmount / dCTAmount / dFGAmount / dFNAmount / dFTAmount / dQuantity | ✅ już włączone |
| PStock | ✅ już włączone |
| csWarehousesId | ✅ już włączone |
| csWarehousesIdDel | ✅ już włączone |
| S01Amount / S01Quantity / S02Amount / S02Quantity | ✅ już włączone |
| CUnitListPrice / CUnitListPriceLimit / CUnitListPriceMin | ✅ już włączone |
| DocPackageWeight / DocWeight / QuantityPallets / DocGrossWeight | ✅ już włączone |
| priceInfo | ✅ już włączone |
| CUnitPriceSuggested / CUnitPriceSuggestedSalesAgr | ✅ już włączone |
| paramsJSON | ✅ już włączone |

**Do zrobienia w ERP:** włącz 10 pól oznaczonych ⬜ w panelu kolumn karty
pozycji WZ: `csCompaniesId`, `csDocsHeadersId`, `csDocsItemsPositionsId`,
`CGAmount`, `CNAmount`, `CTAmount`, `FGAmount`, `FNAmount`, `FTAmount`, `QStock`.

## dbo.csDocsHeaders — 23/46 wprost, +6 da się wziąć z poziomu pozycji, 17 niedostępnych

### ✅ Już dostępne i włączone w Panelu #0 (nic nie trzeba klikać)

`csDocsHeadersId`, `csDocsHeadersG`, `csCompaniesId`, `csDocsTypesId`, `DocNo`,
`DocNumber`, `DocNumberExt`, `CGAmount`, `CNAmount`, `CTAmount`, `FGAmount`,
`FNAmount`, `FTAmount`, `DocDate`, `DocDateExt`, `csCustomersId`, `PaymentDate`,
`DocSaleDate`, `DocVATDate`, `Stock`, `csWarehousesId`, `FStock`, `DocNumberExtAdd2`

### 🔁 Nie ma kolumny w nagłówku, ALE jest w pozycjach (klucz w Panelu #10) — da się doczepić z pierwszej pozycji dokumentu

| Pole | Włączone w pozycjach? |
|---|---|
| ExchangeRate | ⬜ trzeba włączyć |
| csCurrenciesId | ✅ już włączone |
| S01Amount | ✅ już włączone |
| S02Amount | ✅ już włączone |
| DocWeight | ✅ już włączone |
| DocGrossWeight | ✅ już włączone |

### ❌ Nie istnieją w żadnym z dwóch gridów — niedostępne przez klikanie

`PaymentDay`, `csPaymentsTypesId`, `csPeriodsId`, `DocRecipientDate`,
`csDocsHeadersStatusId` (jest tylko tekstowy opis `csDocsHeadersStatusDesc`),
`csVATPeriodsId`, `Cor`, `csEmployeesId` (jest tylko tekstowy `EmployeeDesc`),
`ShipmentType`, `IsOffInvoice`, `csB2BPortalsId`,
`csB2BPortalsDeliveryMethodsId`, `csPayersId`, `TermsFromPayer`, `anaKind`,
`anaUse`, `anaDocDate`.

**Do ustalenia z Michałem:** czy te 17 pól może zostać puste (NULL) po
stronie danych z UI-scrapingu, czy są krytyczne i wymagają innego źródła
(inny widok w ERP, którego jeszcze nie sprawdziliśmy, albo eksport/API tylko
dla tych konkretnych pól).

## Następny krok

1. Włącz w ERP: 10 pól w gridzie pozycji (lista wyżej) + `ExchangeRate` też
   w gridzie pozycji.
2. Zrób raz jeszcze `savpolWzSondaSurowyWiersz()` (albo po prostu odpal
   `scrape.js`) żeby potwierdzić, że wszystkie te pola faktycznie renderują
   się jako `data-datafield` w wierszach.
3. Zgłoś Michałowi listę 17 niedostępnych pól nagłówka — decyzja, czy to
   blokuje, czy nie.
4. Jak to się domknie — przepisuję `extractHeader`/`extractPositions` w
   `scrape.js` na pełny zestaw potwierdzonych pól, 1:1 pod nazwy kolumn w
   bazie.
