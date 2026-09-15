// Wspólna lista pól (nazwy 1:1 z dbo.csDocsHeaders / dbo.csDocsItemsPositions)
// dla dokumentów PRZESUNIĘCIA MAGAZYNOWE (MM) — używana zarówno przez
// generate-test-tables.js (czytanie typów z worek), jak i scrape.js (co
// scrapować z ERP). Jedno miejsce prawdy, żeby te dwa pliki się nie rozjechały.
//
// Źródło: Michał, 2026-09-15. MM zbieramy TYM SAMYM zestawem danych co WZ —
// te same tabele docelowe (csDocsHeaders / csDocsItemsPositions), inny tylko
// csDocsTypesId (rozróżnia typ, brany z gridu — nie stała) ORAZ para magazynów:
// csWarehousesId (magazyn początkowy) i csWarehousesIdDel (magazyn docelowy).
// Pełne uzasadnienie które pole skąd bierzemy — patrz automatyzacje/mm/mapowanie-pol.md.

// Pola nagłówka dostępne WPROST w gridzie listy MM (data-datafield o tej samej
// nazwie). POTWIERDZONE na żywym ERP (2026-09-15, zalogowana sesja, wszystkie
// kolumny włączone): wszystkie 30 pól niżej renderują się w wierszu listy z
// poprawnymi wartościami per dokument — w tym para magazynów csWarehousesId
// (początkowy) i csWarehousesIdDel (docelowy), różna dla każdego przesunięcia.
//
// RÓŻNICA WZGLĘDEM WZ: 7 pól, które przy WZ trzeba było brać z pierwszej
// pozycji (ExchangeRate, csCurrenciesId, S01Amount, S02Amount, DocWeight,
// DocGrossWeight, csWarehousesIdDel), w gridzie listy MM są WPROST — więc
// bierzemy je z nagłówka i nie zależymy od tego, czy dokument ma pozycje.
const HEADER_FIELDS = [
  'csDocsHeadersId', 'csDocsHeadersG', 'csCompaniesId', 'csDocsTypesId', 'DocNo',
  'DocNumber', 'DocNumberExt', 'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount',
  'FNAmount', 'FTAmount', 'DocDate', 'DocDateExt', 'csCustomersId', 'PaymentDate',
  'DocSaleDate', 'DocVATDate', 'Stock', 'csWarehousesId', 'FStock', 'DocNumberExtAdd2',
  // 7 pól, które w gridzie listy MM są wprost (przy WZ były brane z pozycji):
  'ExchangeRate', 'csCurrenciesId', 'S01Amount', 'S02Amount', 'DocWeight',
  'DocGrossWeight', 'csWarehousesIdDel',
  // 10 pól, które przy WZ były "niedostępne przez UI", ale w BOGATSZYM gridzie
  // listy MM (337 kolumn) SĄ dostępne — potwierdzone w panelu kolumn 2026-09-15.
  // Trzeba je włączyć w ERP i zapisać jako domyślny układ listy (patrz
  // mapowanie-pol.md). Część może być pusta dla przesunięć wewnętrznych
  // (płatności/B2B) — wtedy zejdą jako NULL, to poprawne.
  'PaymentDay', 'csPaymentsTypesId', 'csPeriodsId', 'csDocsHeadersStatusId',
  'csVATPeriodsId', 'csEmployeesId', 'csB2BPortalsId', 'csB2BPortalsDeliveryMethodsId',
  'csPayersId', 'anaDocDate'
];

// Dla MM PUSTE — wszystkie pola nagłówka są w gridzie listy (patrz wyżej).
// Zostawione jako stały punkt zaczepienia w architekturze wspólnej z WZ:
// scrape.js iteruje po tej liście i dla MM po prostu nic nie dokłada z pozycji.
const HEADER_FIELDS_FROM_FIRST_POSITION = [];

// Pola pozycji — IDENTYCZNE jak dla WZ (Michał: ten sam zestaw danych).
// Część wymaga włączenia w panelu kolumn ERP przed scrapowaniem — patrz
// mapowanie-pol.md.
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
// lib/fixed-values.js (wartości od Michała per typ dokumentu, MM: 2026-09-15).
const { HEADER_FIXED_FIELDS, POSITION_FIXED_FIELDS } = require('./fixed-values');

// Te same tabele co WZ — MM ląduje w csDocsHeaders / csDocsItemsPositions,
// różni się tylko csDocsTypesId (Michał). Testowo: ..._test.
const TEST_TABLE_HEADERS = 'csDocsHeaders_test';
const TEST_TABLE_POSITIONS = 'csDocsItemsPositions_test';
const PROD_TABLE_HEADERS = 'csDocsHeaders';
const PROD_TABLE_POSITIONS = 'csDocsItemsPositions';

module.exports = {
  HEADER_FIELDS,
  HEADER_FIELDS_FROM_FIRST_POSITION,
  HEADER_FIXED_FIELDS,
  POSITION_FIELDS,
  POSITION_FIXED_FIELDS,
  TEST_TABLE_HEADERS,
  TEST_TABLE_POSITIONS,
  PROD_TABLE_HEADERS,
  PROD_TABLE_POSITIONS
};
