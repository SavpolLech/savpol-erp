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

// Pola nagłówka dostępne WPROST w gridzie listy (data-datafield o tej samej
// nazwie). Identyczne jak dla WZ — csWarehousesId (magazyn początkowy) jest
// tutaj kluczowe dla MM i jest w gridzie nagłówka listy WZ, więc zakładamy to
// samo dla listy przesunięć (DO POTWIERDZENIA sondą sonda-lista-kolumn.js na
// widoku MM — patrz mapowanie-pol.md).
const HEADER_FIELDS = [
  'csDocsHeadersId', 'csDocsHeadersG', 'csCompaniesId', 'csDocsTypesId', 'DocNo',
  'DocNumber', 'DocNumberExt', 'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount',
  'FNAmount', 'FTAmount', 'DocDate', 'DocDateExt', 'csCustomersId', 'PaymentDate',
  'DocSaleDate', 'DocVATDate', 'Stock', 'csWarehousesId', 'FStock', 'DocNumberExtAdd2'
];

// Nie ma własnej kolumny w gridzie nagłówka, ale JEST w gridzie pozycji —
// dorzucamy do rekordu nagłówka, biorąc wartość z PIERWSZEJ pozycji dokumentu
// (to samo dla całego dokumentu, więc jedna pozycja wystarcza).
//
// RÓŻNICA WZGLĘDEM WZ: dochodzi csWarehousesIdDel (magazyn DOCELOWY) — dla MM
// pole krytyczne (Michał). W gridzie pozycji karty WZ csWarehousesIdDel już
// jest (patrz POSITION_FIELDS), więc bezpiecznie bierzemy je z pierwszej
// pozycji. Jeśli sonda pokaże, że MM ma csWarehousesIdDel WPROST w gridzie
// nagłówka listy, można je przenieść do HEADER_FIELDS (wtedy nie zależy od
// tego, czy dokument ma pozycje) — patrz mapowanie-pol.md.
const HEADER_FIELDS_FROM_FIRST_POSITION = [
  'ExchangeRate', 'csCurrenciesId', 'S01Amount', 'S02Amount', 'DocWeight', 'DocGrossWeight',
  'csWarehousesIdDel'
];

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
