// Eksport CSV z już zdekodowanych danych produktu (window.__podsluchZdekodowany).
// WERSJA: 2026-09-14.1
//
// WYMAGANIE: uruchom NAJPIERW savpolPodsluchDekoduj(N) na wpisie z listy
// savpolPodsluchZrzut(), który ma OperationName: RefreshDataSetSQL_Synchronous
// i DictIdent: csItemsOneBro (to ten z danymi rekordu, nie z definicją
// formularza) — dopiero potem ten skrypt.
//
// Co robi: buduje DWA pliki CSV z tego samego rekordu i od razu je pobiera
// (normalne pobieranie przeglądarki, trafią do Twojego folderu Pobrane):
//   1. produkt_<Item>_dopasowane-kolumny.csv — tylko te 105 pól, które
//      jednoznacznie pasują nazwą do listy 141 kolumn od Michała
//      (automatyzacje/produkty/info/kolumny.txt).
//   2. produkt_<Item>_wszystkie-pola-api.csv — wszystkie ~314 pól, które
//      API faktycznie zwróciło dla tego produktu (pełny zrzut, do wglądu).
//
// Jak używać:
//   1. Wklej ten plik w konsolę PO wywołaniu savpolPodsluchDekoduj(N) na
//      właściwym wpisie (dane rekordu, nie definicja).
//   2. Dwa pliki CSV powinny się same pobrać.

(function () {
  'use strict';

  const WERSJA = '2026-09-14.1';

  // 105 nazw pól ze 141 kolumn Michała, które dosłownie pasują do nazw
  // zwracanych przez API (patrz automatyzacje/produkty/info/mapowanie-wstepna.md).
  const DOPASOWANE = ["csItemsId","csItemsG","csCompaniesId","Item","ItemDesc","ItemDesc1","ItemDesc2","ItemDesc3","ItemDesc4","csEBIProducersId","csEBIBrandsId","csEBICategoriesId","csEBIConcessionsId","csEBIVarietiesId","PartNo","csItemsStatusesValuesId","csItemsTypesId","csVATRatesId","CPACode","csETIMClassesId","csPCGSG","IsInventoryRecords","csSeriesId","csProductManagerId","ItemDesc_DE","ItemDesc_EN","ItemDesc_ES","ItemDesc_FR","ItemDesc_NL","ItemDesc_PL","ItemDesc1_DE","ItemDesc1_EN","ItemDesc1_ES","ItemDesc1_FR","ItemDesc1_NL","ItemDesc1_PL","EAN","KeyWords_PL","StockLevelMin","ItemDesc_PT","ItemDesc_RU","ItemDesc_UK","ItemDesc1_PT","ItemDesc1_RU","ItemDesc1_UK","KeyWords_EN","FirstInSeries","AutoItemNo","ItemDesc_IT","ItemDesc1_IT","CeneoItemDesc","csCountriesG","csCompaniesId4FTI","SEZKind","IsExp","IsForRetail","IsForSC01","IsForWholesale","SEOTitle_PL","SEOrobots","SEODescription_EN","SEODescription_PL","SEOTitle_EN","SEOCanonical_EN","SEOCanonical_PL","BMM","SMM","ItemDescShowKind","csCPACodesG","csStorageLocationsTypesG","ExpectedExpirationPeriod","LotRegistrationRequired","ExpirationDateRequired","ShelfLifeDays","csSysTablesIdentTemplatesG","purchaseOnRequestOnly","isSplitPaymentRequired","csItemsModelsId","itemSearchPriority","withNutrition","csItemsVatClassyficationsG","ItemDesc_SK","ItemDesc1_SK","csPurchaseVATRatesId","PartNo2","csProductExpertId","weightClass","strengthClass","canSetSalePrice","isDiff","isGentle","KeyWords_HR","ItemDesc_HR","ItemDesc1_HR","KeyWordsAuto_HR","SEODescription_HR","SEOCanonical_HR","SEOTitle_HR","registerPrice","basePrice","ItemDesc_CZ","ItemDesc1_CZ","blockEditETIMFeatures","globalPrice","globalStrictPrice"];

  function escCsv(v) {
    if (v === null || v === undefined) return '';
    const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function pobierzPlik(nazwa, tresc) {
    const blob = new Blob(['﻿' + tresc], { type: 'text/csv;charset=utf-8' }); // BOM dla Excela
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nazwa;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  if (!window.__podsluchZdekodowany) {
    console.log('[eksport-csv ' + WERSJA + '] Brak window.__podsluchZdekodowany — '
      + 'najpierw uruchom savpolPodsluchDekoduj(N) na wpisie z danymi rekordu.');
    return;
  }

  let obiekt;
  try {
    obiekt = JSON.parse(window.__podsluchZdekodowany);
  } catch (e) {
    console.log('[eksport-csv] window.__podsluchZdekodowany nie jest poprawnym JSON-em: ' + e.message);
    return;
  }

  let dt;
  try {
    dt = obiekt.Result.RefreshObjectReturnList[0].DataTable;
  } catch (e) {
    console.log('[eksport-csv] Nie znalazłem Result.RefreshObjectReturnList[0].DataTable — '
      + 'to na pewno wpis z OperationName: RefreshDataSetSQL_Synchronous?');
    return;
  }

  console.log('[eksport-csv] klucze DataTable: ' + Object.keys(dt).join(', '));
  const nazwyPol = dt.FieldDefs.map(f => f.FieldName);

  // Nazwa klucza z wierszami różni się między wersjami/kontekstami tego API —
  // próbujemy kilku najbardziej prawdopodobnych.
  const wiersze = dt.Records || dt.Rows || dt.Data || dt.records || dt.rows || dt.data;
  if (!wiersze || !wiersze.length) {
    console.log('[eksport-csv] Nie znalazłem tablicy wierszy w DataTable. '
      + 'Zobacz "klucze DataTable" wyżej i daj znać, pod jakim kluczem są wartości — poprawimy skrypt.');
    console.log('  Cały obiekt DataTable (bez FieldDefs, dla czytelności):');
    const kopia = Object.assign({}, dt);
    delete kopia.FieldDefs;
    console.log(kopia);
    return;
  }

  const pierwszyWiersz = wiersze[0];
  let rekord = {};
  if (Array.isArray(pierwszyWiersz)) {
    nazwyPol.forEach((n, i) => { rekord[n] = pierwszyWiersz[i]; });
  } else if (pierwszyWiersz && typeof pierwszyWiersz === 'object') {
    rekord = pierwszyWiersz;
  } else {
    console.log('[eksport-csv] Nieoczekiwany kształt wiersza: ' + JSON.stringify(pierwszyWiersz).slice(0, 200));
    return;
  }

  const identyfikator = (rekord.Item || rekord.item || 'produkt').toString().replace(/[^A-Za-z0-9_-]/g, '_');

  const csvWszystkie = nazwyPol.map(escCsv).join(',') + '\n'
    + nazwyPol.map(n => escCsv(rekord[n])).join(',');
  const csvDopasowane = DOPASOWANE.map(escCsv).join(',') + '\n'
    + DOPASOWANE.map(n => escCsv(rekord[n])).join(',');

  pobierzPlik('produkt_' + identyfikator + '_dopasowane-kolumny.csv', csvDopasowane);
  pobierzPlik('produkt_' + identyfikator + '_wszystkie-pola-api.csv', csvWszystkie);

  console.log('[eksport-csv ' + WERSJA + '] Gotowe — 2 pliki CSV powinny się pobrać '
    + '(dopasowane-kolumny: ' + DOPASOWANE.length + ' pól, wszystkie-pola-api: ' + nazwyPol.length + ' pól).');
})();
