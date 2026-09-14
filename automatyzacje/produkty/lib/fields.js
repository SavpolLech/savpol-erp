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

module.exports = { DOPASOWANE, PROD_TABLE };
