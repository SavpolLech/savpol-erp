// Wspólna lista pól (nazwy 1:1 z dbo.csDocsHeaders / dbo.csDocsItemsPositions)
// — używana zarówno przez generate-test-tables.js (czytanie typów z cs06),
// jak i scrape.js (co scrapować z ERP). Jedno miejsce prawdy, żeby te dwa
// pliki się nie rozjechały.
//
// Źródło: Michał (migracja danych), 2026-09-07. Pełne uzasadnienie które pole
// skąd bierzemy — patrz automatyzacje/wz/mapowanie-pol.md.

// Pola nagłówka dostępne WPROST w gridzie listy WZ (data-datafield o tej
// samej nazwie). 23 z 46 pól z listy Michała — reszta nie istnieje w żadnym
// gridzie ERP (patrz mapowanie-pol.md, sekcja "❌ Niedostępne").
const HEADER_FIELDS = [
  'csDocsHeadersId', 'csDocsHeadersG', 'csCompaniesId', 'csDocsTypesId', 'DocNo',
  'DocNumber', 'DocNumberExt', 'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount',
  'FNAmount', 'FTAmount', 'DocDate', 'DocDateExt', 'csCustomersId', 'PaymentDate',
  'DocSaleDate', 'DocVATDate', 'Stock', 'csWarehousesId', 'FStock', 'DocNumberExtAdd2'
];

// Nie ma własnej kolumny w gridzie nagłówka, ale JEST w gridzie pozycji —
// dorzucamy do rekordu nagłówka, biorąc wartość z PIERWSZEJ pozycji dokumentu
// (to samo dla całego dokumentu, więc jedna pozycja wystarcza).
const HEADER_FIELDS_FROM_FIRST_POSITION = [
  'ExchangeRate', 'csCurrenciesId', 'S01Amount', 'S02Amount', 'DocWeight', 'DocGrossWeight'
];

// Pola pozycji dostępne w gridzie karty WZ — 55/55 z listy Michała (100%).
// Część wymaga włączenia w panelu kolumn ERP przed scrapowaniem — patrz
// mapowanie-pol.md / diagnostyka/wlacz-kolumny.js.
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

const TEST_TABLE_HEADERS = 'csDocsHeaders_test';
const TEST_TABLE_POSITIONS = 'csDocsItemsPositions_test';
const PROD_TABLE_HEADERS = 'csDocsHeaders';
const PROD_TABLE_POSITIONS = 'csDocsItemsPositions';

module.exports = {
  HEADER_FIELDS,
  HEADER_FIELDS_FROM_FIRST_POSITION,
  POSITION_FIELDS,
  TEST_TABLE_HEADERS,
  TEST_TABLE_POSITIONS,
  PROD_TABLE_HEADERS,
  PROD_TABLE_POSITIONS
};
