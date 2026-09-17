// Wspólna lista pól (nazwy 1:1 z dbo.csDocsHeaders / dbo.csDocsItemsPositions)
// dla dokumentów PRZYJĘCIE ZEWNĘTRZNE (PZ) — używana zarówno przez
// generate-test-tables.js (czytanie typów z worek), jak i scrape.js (co
// scrapować z ERP). Jedno miejsce prawdy, żeby te dwa pliki się nie rozjechały.
//
// Źródło: Michał, 2026-09-17 (PZ_pola_wymagane.xlsx) + sonda na żywym ERP
// tego samego dnia (diagnostyka/PZ/*.txt). Pełne uzasadnienie które pole
// skąd bierzemy — patrz automatyzacje/pz/mapowanie-pol.md.

// Pola nagłówka dostępne WPROST w gridzie listy PZ (data-datafield o tej
// samej nazwie). POTWIERDZONE na żywym ERP (2026-09-17, dokument
// 2026/PZ/WLS1/004716): grid PZ jest BOGATY jak MM, nie ubogi jak WZ —
// prawie wszystkie pola z listy Michała renderują się wprost w wierszu listy,
// łącznie z tymi 7, które przy WZ trzeba było brać z pierwszej pozycji, i
// 11 z 17 pól, które przy WZ były "niedostępne przez UI" (pozostałe 5 z tych
// 17 są też widoczne w gridzie, ale zostają jako stałe — patrz niżej).
const HEADER_FIELDS = [
  // 23 pola jak WZ:
  'csDocsHeadersId', 'csDocsHeadersG', 'csCompaniesId', 'csDocsTypesId', 'DocNo',
  'DocNumber', 'DocNumberExt', 'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount',
  'FNAmount', 'FTAmount', 'DocDate', 'DocDateExt', 'csCustomersId', 'PaymentDate',
  'DocSaleDate', 'DocVATDate', 'Stock', 'csWarehousesId', 'FStock', 'DocNumberExtAdd2',
  // 7 pól, które przy WZ trzeba było brać z pierwszej pozycji — w gridzie
  // listy PZ są WPROST (potwierdzone: ExchangeRate=1, csCurrenciesId=401807,
  // DocWeight=2560, DocGrossWeight=2560,4 na przykładowym dokumencie;
  // csWarehousesIdDel obecne, ale puste — PZ nie ma "drugiego" magazynu):
  'ExchangeRate', 'csCurrenciesId', 'S01Amount', 'S02Amount', 'DocWeight',
  'DocGrossWeight', 'csWarehousesIdDel',
  // 11 z 17 pól, które przy WZ były "niedostępne przez UI" — w gridzie listy
  // PZ SĄ dostępne z realnymi wartościami (potwierdzone na żywym dokumencie:
  // PaymentDay=21, csPaymentsTypesId, csPeriodsId, csDocsHeadersStatusId,
  // csVATPeriodsId, csEmployeesId (puste dla tego dok., kolumna jednak jest),
  // csB2BPortalsId, csB2BPortalsDeliveryMethodsId, csPayersId, anaDocDate;
  // TermsFromPayer=0 też jest wprost w gridzie i nie jest stałą u Michała):
  'PaymentDay', 'csPaymentsTypesId', 'csPeriodsId', 'csDocsHeadersStatusId',
  'csVATPeriodsId', 'csEmployeesId', 'csB2BPortalsId', 'csB2BPortalsDeliveryMethodsId',
  'csPayersId', 'anaDocDate', 'TermsFromPayer'
  // anaKind, anaUse, Cor, ShipmentType, IsOffInvoice są TEŻ wprost w gridzie
  // (wartości sondy: 0/0/0/0/0), ale Michał podaje je jako stałe per typ
  // dokumentu (lib/fixed-values.js) — scrape.js i tak nadpisuje je fixed
  // values PO scrapowaniu, więc nie dokładamy ich tutaj (byłoby martwe
  // odczytanie, zaraz nadpisywane). Dokładnie jak przy WZ/MM.
];

// Dla PZ PUSTE — jak przy MM, wszystkie pola nagłówka są w gridzie listy
// (patrz wyżej). Zostawione jako stały punkt zaczepienia w architekturze
// wspólnej z WZ: scrape.js iteruje po tej liście i dla PZ po prostu nic nie
// dokłada z pozycji.
const HEADER_FIELDS_FROM_FIRST_POSITION = [];

// JEDYNE pole nagłówka z listy Michała, którego NIE znaleziono w żadnym
// gridzie PZ (sprawdzone: brak w liście, brak w karcie) — zostaje NULL.
// Dokładnie jak przy MM (tam też DocRecipientDate było jedynym wyjątkiem).
const HEADER_UNAVAILABLE_FIELDS = ['DocRecipientDate'];

// Pola pozycji — IDENTYCZNE jak WZ i MM (Michał: ten sam zestaw danych).
// Potwierdzone na żywym dokumencie PZ: wszystkie 55 pól obecne w gridzie
// karty, wartości realne per pozycja.
const POSITION_FIELDS = [
  'csCompaniesId', 'csDocsHeadersId', 'csDocsItemsPositionsId', 'csDocsItemsPositionsG',
  'Id', 'csItemsId', 'csItemsUnitsId', 'csVATRatesId', 'QuantityUnits', 'Quantity',
  'Discount', 'CUnitPrice', 'CUnitNetPrice', 'FUnitNetPrice', 'CUnitGrossPrice',
  'FUnitGrossPrice', 'CNetPrice', 'FNetPrice', 'CGrossPrice', 'FGrossPrice',
  'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount', 'FNAmount', 'FTAmount',
  'csCurrenciesId', 'PositionDesc', 'Rate', 'FStock', 'QStock',
  'dCGAmount', 'dCNAmount', 'dCTAmount', 'dFGAmount', 'dFNAmount', 'dFTAmount',
  'dQuantity', 'PStock', 'csWarehousesId', 'csWarehousesIdDel',
  'S01Amount', 'S01Quantity', 'S02Amount', 'S02Quantity',
  'CUnitListPrice', 'CUnitListPriceLimit', 'CUnitListPriceMin',
  'DocPackageWeight', 'DocWeight', 'QuantityPallets', 'DocGrossWeight',
  'priceInfo', 'CUnitPriceSuggested', 'CUnitPriceSuggestedSalesAgr', 'paramsJSON'
];

// Kolumny NOT NULL bez wartości ze scrapowania — wypełniane stałymi z
// lib/fixed-values.js (wartości od Michała, PZ: 2026-09-17). Uwaga: kilka z
// tych samych nazw (Cor, ShipmentType, IsOffInvoice, anaKind, anaUse,
// TermsFromPayer) są TAKŻE w HEADER_FIELDS wyżej jako scrapowane — dla PZ
// świadomie zostają jako STAŁE (nie nadpisujemy ich wartością z grida), bo są
// to atrybuty TYPU dokumentu, nie konkretnego dokumentu (Michał podał je jako
// stałe w arkuszu, a scraper i tak nadpisuje rekord fixed-values PO
// scrapowaniu — patrz applyFixedValues w scrape.js).
const { HEADER_FIXED_FIELDS, POSITION_FIXED_FIELDS } = require('./fixed-values');

// Te same tabele co WZ i MM — PZ ląduje w csDocsHeaders / csDocsItemsPositions,
// różni się tylko csDocsTypesId (Michał). Testowo: ..._test.
// UWAGA: do potwierdzenia z Michałem (patrz mapowanie-pol.md) — zakładamy
// wspólne tabele testowe jak WZ/MM, rozróżnienie przez csDocsTypesId.
const TEST_TABLE_HEADERS = 'csDocsHeaders_test';
const TEST_TABLE_POSITIONS = 'csDocsItemsPositions_test';
const PROD_TABLE_HEADERS = 'csDocsHeaders';
const PROD_TABLE_POSITIONS = 'csDocsItemsPositions';

module.exports = {
  HEADER_FIELDS,
  HEADER_FIELDS_FROM_FIRST_POSITION,
  HEADER_UNAVAILABLE_FIELDS,
  HEADER_FIXED_FIELDS,
  POSITION_FIELDS,
  POSITION_FIXED_FIELDS,
  TEST_TABLE_HEADERS,
  TEST_TABLE_POSITIONS,
  PROD_TABLE_HEADERS,
  PROD_TABLE_POSITIONS
};
