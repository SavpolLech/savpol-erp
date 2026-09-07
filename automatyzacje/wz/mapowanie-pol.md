# Mapowanie pól: dbo.csDocsHeaders / dbo.csDocsItemsPositions ↔ ERP (UI)

Źródło: Michał (migracja danych), 2026-09-07. Docelowe tabele:
`dbo.csDocsHeaders` / `dbo.csDocsItemsPositions` (testowo: `..._test`).

**WAŻNE — zmiana zakresu:** ten zestaw pól ma objąć różne typy dokumentów,
nie tylko WZ. Wiele pól (VAT, waluty, terminy płatności) może być puste/
nieistotne dla WZ i mieć sens dopiero dla faktur/zamówień. Mapujemy na razie
pod kątem WZ (to, co mamy przetestowane), reszta typów dokumentów — kolejny
krok po tym, jak WZ przejdzie od początku do końca.

Legenda statusu:
- ✅ mamy już w `scrape.js` (potwierdzone sondami na WZ)
- ❓ nie sprawdzone — może być dostępne przez dodanie kolumny w gridzie ERP (tak jak `csItemsId`/`csItemsUnitsId`)
- ⚠️ prawdopodobnie NIEDOSTĘPNE przez klikanie — typowe pole tylko-bazodanowe (grupowanie, zaokrąglenia, wymiary analityczne), którego żaden grid raczej nie renderuje

## dbo.csDocsHeaders

| Pole (DB) | Status | Źródło w ERP / uwaga |
|---|---|---|
| csDocsHeadersId | ✅ | `csDocsHeadersId` (lista) |
| csDocsHeadersG | ⚠️ | typowe pole grupujące (multi-waluta/storno?) — do sprawdzenia |
| csCompaniesId | ❓ | widoczne w URL-ach ERP (np. `.../213217693`) — może to właśnie to |
| csDocsTypesId | ❓ | typ dokumentu (WZ/FA/...) jako ID, mamy tylko tekst "WZ" |
| DocNo | ✅ | `DocNo` (lista) — mieliśmy w v1.0, usunięte z eksportu na prośbę, można wrócić |
| DocNumber | ✅ | `DocNumber` (lista) |
| DocNumberExt | ✅ | `DocNumberExt` (lista, zwykle puste) |
| ExchangeRate | ❓ | pewnie istotne tylko dla dokumentów w obcej walucie |
| CGAmount / CNAmount / CTAmount | ❓ | kwoty brutto/netto/VAT w walucie dok. |
| FGAmount / FNAmount / FTAmount | ❓ | kwoty brutto/netto/VAT w PLN — `FStock` to inne pole (wartość magazynowa) |
| DocDate | ✅ | `DocDate` (lista) |
| DocDateExt | ❓ | |
| csCustomersId | ❓ | mamy tylko `CustomerIdent` (kod tekstowy), nie wewnętrzny ID |
| PaymentDate / PaymentDay | ❓ | dot. faktur, nie WZ |
| csPaymentsTypesId | ❓ | dot. faktur |
| csPeriodsId | ❓ | |
| DocSaleDate / DocRecipientDate | ❓ | |
| csCurrenciesId | ❓ | |
| DocVATDate | ❓ | dot. faktur |
| csDocsHeadersStatusId | ❓ | mamy tylko `csDocsHeadersStatusDesc` (tekst "ZAKSIĘGOWANE") |
| csVATPeriodsId | ❓ | dot. faktur |
| Cor | ❓ | flaga korekty? |
| csEmployeesId | ❓ | mamy tylko `EmployeeDesc` (tekst) |
| ShipmentType | ❓ | |
| Stock | ❓ | inne niż `FStock`? do wyjaśnienia |
| csWarehousesId | ✅ | `csWarehousesId` (lista) |
| FStock | ✅ | `FStock` (lista, wartość dokumentu) |
| DocNumberExtAdd2 | ✅ | `DocNumberExtAdd2` (WZN) |
| IsOffInvoice | ❓ | |
| csB2BPortalsId / csB2BPortalsDeliveryMethodsId | ⚠️ | prawdopodobnie dot. zamówień z portalu B2B, nie WZ |
| S01Amount / S02Amount | ⚠️ | wymiary analityczne? |
| csPayersId | ❓ | |
| TermsFromPayer | ⚠️ | |
| DocWeight / DocGrossWeight | ❓ | logistyczne — mogą być gdzieś na karcie WZ, nie sprawdzaliśmy |
| anaKind / anaUse / anaDocDate | ⚠️ | wygląda na pola analityczne (BI), zwykle tylko-bazodanowe |

## dbo.csDocsItemsPositions

| Pole (DB) | Status | Źródło w ERP / uwaga |
|---|---|---|
| csCompaniesId | ❓ | jak wyżej |
| csDocsHeadersId | ✅ | dziedziczone z nagłówka |
| csDocsItemsPositionsId | ❓ | mamy `Id` (numer pozycji 1,2,3...) — to raczej NIE to samo co wewnętrzny ID pozycji |
| csDocsItemsPositionsG | ⚠️ | |
| Id | ✅ | `Id` (lp. pozycji) |
| csItemsId | ✅ | `csItemsId` (po dodaniu kolumny) |
| csItemsUnitsId | ✅ | `csItemsUnitsId` (po dodaniu kolumny) |
| csVATRatesId | ❓ | |
| QuantityUnits | ✅ | `QuantityUnits` |
| Quantity | ❓ | inna jednostka miary niż `QuantityUnits`? do wyjaśnienia z Michałem |
| Discount | ❓ | |
| CUnitPrice / CUnitNetPrice / FUnitNetPrice / CUnitGrossPrice / FUnitGrossPrice | ❓ | mamy `StockUnitPrice` — czy to jest któreś z tych, czy coś innego (cena magazynowa vs cena sprzedaży) |
| CNetPrice / FNetPrice / CGrossPrice / FGrossPrice | ❓ | wartości pozycji w różnych walutach/stawkach |
| CGAmount / CNAmount / CTAmount / FGAmount / FNAmount / FTAmount | ❓ | jak w nagłówku, ale per pozycja |
| csCurrenciesId | ❓ | |
| PositionDesc | ✅ | to raczej `ItemDesc` (nazwa produktu) — do potwierdzenia nazwy |
| Rate | ❓ | |
| FStock | ✅ | `FStock` (wartość pozycji) |
| QStock | ❓ | widzieliśmy w innej siatce na karcie (zakładka partii/lot) |
| dCGAmount / dCNAmount / dCTAmount / dFGAmount / dFNAmount / dFTAmount / dQuantity | ⚠️ | prefiks "d" = delty/różnice, prawdopodobnie tylko-bazodanowe |
| PStock | ❓ | |
| csWarehousesId / csWarehousesIdDel | ❓/⚠️ | mamy `Warehouse` (kod skrócony) na poziomie pozycji, ale nie wewnętrzny ID; "Del" = magazyn docelowy? |
| S01Amount / S01Quantity / S02Amount / S02Quantity | ⚠️ | wymiary analityczne |
| CUnitListPrice / CUnitListPriceLimit / CUnitListPriceMin | ❓ | cennik |
| DocPackageWeight / DocWeight / QuantityPallets / DocGrossWeight | ❓ | logistyka pozycji |
| priceInfo / paramsJSON | ⚠️ | brzmi jak pola JSON/meta, prawdopodobnie tylko-bazodanowe |
| CUnitPriceSuggested / CUnitPriceSuggestedSalesAgr | ❓ | |

## Następny krok

Dużo pól jest ❓ — nie wiadomo, czy da się je dodać jako kolumnę w gridzie
ERP (tak jak `csItemsId`), zanim nie sprawdzimy. Zamiast sprawdzać pole po
polu, szybciej będzie: **jak dokładnie dodałeś `csItemsId`/`csItemsUnitsId`
do siatki pozycji ostatnim razem?** (które menu/przycisk). Jeśli to ten sam
mechanizm w obu siatkach (lista dokumentów i pozycje), spróbujmy dodać
od razu WSZYSTKIE pola z tej listy jako kolumny w obu gridach, i jednym
przebiegiem sondy zobaczymy, co się dało, a co realnie nie istnieje w UI
(kandydaci ⚠️).
