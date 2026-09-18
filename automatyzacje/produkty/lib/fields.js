// Lista pól karty produktu — jedno miejsce prawdy dla scrape.js.
//
// DOPASOWANE: 105 nazw pól z 141 kolumn od Michała (kolumny.txt), które
// dosłownie pasują do nazw zwracanych przez API karty produktu. Uzasadnienie
// i pełna analiza dopasowań: automatyzacje/produkty/info/mapowanie-wstepna.md.
// Ta sama lista co diagnostyka/eksport-csv-produktu.js (2026-09-14.1) —
// przeniesiona tu, żeby scraper i sonda diagnostyczna się nie rozjechały.
//
// Kartę produktu API zwraca ~314 pól; do bazy `worek` (dbo.csItems, 141
// kolumn) trafi tylko część — resztę pól zostawiamy w pełnym zrzucie do
// wglądu (patrz mapowanie-wstepna.md, sekcja o 36 kolumnach bez odpowiednika).

const DOPASOWANE = [
  'csItemsId', 'csItemsG', 'csCompaniesId', 'Item', 'ItemDesc', 'ItemDesc1',
  'ItemDesc2', 'ItemDesc3', 'ItemDesc4', 'csEBIProducersId', 'csEBIBrandsId',
  'csEBICategoriesId', 'csEBIConcessionsId', 'csEBIVarietiesId', 'PartNo',
  'csItemsStatusesValuesId', 'csItemsTypesId', 'csVATRatesId', 'CPACode',
  'csETIMClassesId', 'csPCGSG', 'IsInventoryRecords', 'csSeriesId',
  'csProductManagerId', 'ItemDesc_DE', 'ItemDesc_EN', 'ItemDesc_ES',
  'ItemDesc_FR', 'ItemDesc_NL', 'ItemDesc_PL', 'ItemDesc1_DE', 'ItemDesc1_EN',
  'ItemDesc1_ES', 'ItemDesc1_FR', 'ItemDesc1_NL', 'ItemDesc1_PL', 'EAN',
  'KeyWords_PL', 'StockLevelMin', 'ItemDesc_PT', 'ItemDesc_RU', 'ItemDesc_UK',
  'ItemDesc1_PT', 'ItemDesc1_RU', 'ItemDesc1_UK', 'KeyWords_EN', 'FirstInSeries',
  'AutoItemNo', 'ItemDesc_IT', 'ItemDesc1_IT', 'CeneoItemDesc', 'csCountriesG',
  'csCompaniesId4FTI', 'SEZKind', 'IsExp', 'IsForRetail', 'IsForSC01',
  'IsForWholesale', 'SEOTitle_PL', 'SEOrobots', 'SEODescription_EN',
  'SEODescription_PL', 'SEOTitle_EN', 'SEOCanonical_EN', 'SEOCanonical_PL',
  'BMM', 'SMM', 'ItemDescShowKind', 'csCPACodesG', 'csStorageLocationsTypesG',
  'ExpectedExpirationPeriod', 'LotRegistrationRequired', 'ExpirationDateRequired',
  'ShelfLifeDays', 'csSysTablesIdentTemplatesG', 'purchaseOnRequestOnly',
  'isSplitPaymentRequired', 'csItemsModelsId', 'itemSearchPriority',
  'withNutrition', 'csItemsVatClassyficationsG', 'ItemDesc_SK', 'ItemDesc1_SK',
  'csPurchaseVATRatesId', 'PartNo2', 'csProductExpertId', 'weightClass',
  'strengthClass', 'canSetSalePrice', 'isDiff', 'isGentle', 'KeyWords_HR',
  'ItemDesc_HR', 'ItemDesc1_HR', 'KeyWordsAuto_HR', 'SEODescription_HR',
  'SEOCanonical_HR', 'SEOTitle_HR', 'registerPrice', 'basePrice', 'ItemDesc_CZ',
  'ItemDesc1_CZ', 'blockEditETIMFeatures', 'globalPrice', 'globalStrictPrice'
];

// Nazwa tabeli docelowej w bazie `worek` (replika ERP pod migrację do Odoo —
// patrz mapowanie-wstepna.md, sekcja "Photo / PhotoSmall"). Na razie scraper
// zapisuje do plików; zapis do bazy dojdzie analogicznie do WZ, gdy `worek`
// się napełni i potwierdzimy schemat.
const PROD_TABLE = 'csItems';

// Jednostki (csItemsUnits) i kody kreskowe per jednostka (csItemsBarCodes) —
// Michał, 2026-09-14, przykład SKU 0025321. W obu przypadkach 100% kolumn
// od Michała pasuje 1:1 po nazwie do pól zwracanych przez API (inaczej niż
// przy csItems, gdzie tylko 105/141) — patrz mapowanie-wstepna.md.
const DOPASOWANE_JEDNOSTKI = [
  'csItemsUnitsId', 'csItemsUnitsG', 'csCompaniesId', 'csItemsId', 'csUnitsId',
  'QuantityInUnit', 'Weight', 'PackageWeight', 'Volume', 'Width', 'Height',
  'Length', 'Precision', 'IsStock', 'IsDef', 'CExportSalesPrice',
  'csCurrenciesGExportSalesPrice', 'csCurrenciesGPurchasePrice', 'CPurchasePrice',
  'CWholesalesPrice', 'CRetailSalesPrice', 'PackageLength', 'PackageVolumne',
  'PackageHeigth', 'csUnitsIdPackage', 'PackageWidth', 'GrossWeight',
  'PurchaseDiscount', 'Density', 'ItemUnitDesc1', 'COtherSalesPrice', 'Ord',
  'IsDefPurchase', 'ImageReductionRatio', 'ImageReductionLen', 'ImageReductionType',
  'ExportSalesDiscount', 'RetailSalesDiscount', 'WholesalesDiscount',
  'csItemsUnitsExtIdent', 'csCurrenciesGOtherSalesPrice', 'csCurrenciesGRetailSalesPrice',
  'csCurrenciesGWholesalesPrice', 'Discount4Calc', 'CRecyclingFee', 'IsPallet',
  'CSalesLimitPrice', 'CSalesMinPrice', 'PalletsInUnit', 'Atr01', 'LayersInUnit',
  'csUnitsId4SplitByUnit', 'CClosingSalesPrice', 'csCurrenciesGClosingSalePrice',
  'IsSalesPackage', 'IsPurchaseRound', 'IsQuantityInUnit4CalcPrice', 'CDepositFee',
  'isWarehouseTransfersRound', 'IsSaleRound', 'isFractionalQuantity', 'EANType',
  'quantityMinInOrder', 'dimensionMax', 'isOverallDimension', 'csPaletteTypesId',
  'unitType', 'isCutable'
];
const JEDNOSTKI_TABLE = 'csItemsUnits';

const DOPASOWANE_EAN = [
  'csItemsBarCodesId', 'csItemsBarCodesG', 'csCompaniesId', 'csItemsId',
  'csUnitsId', 'EAN', 'QrCode', 'Ord', 'isDef'
];
const EAN_TABLE = 'csItemsBarCodes';

// Grupy produktowe przypisane do produktu (csItemsGroupsItems) — Michał,
// 2026-09-18, bez listy kolumn (był w wyjeździe), tylko nazwa tabeli
// docelowej. Namierzone przez zakładkę „Grupy" na karcie — jedno zapytanie
// API, bez klikania per-wiersz (inaczej niż EAN). 15/15 kolumn realnej
// tabeli pasuje 1:1 po nazwie do API — sprawdzone w INFORMATION_SCHEMA na
// `worek` (tabela tam już istnieje, replika ERP).
const DOPASOWANE_GRUPY = [
  'csItemsGroupsItemsId', 'csItemsGroupsItemsG', 'csCompaniesId', 'csItemsGroupsId',
  'csItemsId', 'IsFromETIM', 'Ord', 'IsAutoKind', 'Def4Prices', 'Def4Analysis',
  'isMain', 'csWarehousesId', 'purchaseDiscount', 'comment', 'purchasePrice'
];
const GRUPY_TABLE = 'csItemsGroupsItems';

module.exports = {
  DOPASOWANE, PROD_TABLE,
  DOPASOWANE_JEDNOSTKI, JEDNOSTKI_TABLE,
  DOPASOWANE_EAN, EAN_TABLE,
  DOPASOWANE_GRUPY, GRUPY_TABLE
};
