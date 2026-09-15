// W OTWARTYM panelu wyboru kolumn (.c-settings-list) wymusza DOKŁADNY stan:
// zostawia zaznaczone TYLKO pola z listy KEEP, całą resztę odznacza. To
// odwrotność wlacz-wszystkie-kolumny.js — po zdjęciu mapy pól wracamy do
// minimalnego zestawu, którego faktycznie używa scraper (300 kolumn w gridzie
// niepotrzebnie spowalnia renderowanie każdego wiersza).
// WERSJA: 2026-09-15.1
//
// KEEP musi być KOMPLETNY dla danego gridu — jeśli scraper czyta kolumnę,
// której tu nie ma, po odznaczeniu zniknie <td data-datafield> i wartość
// wróci pusta. Gotowe listy (wyliczone z automatyzacje/mm/lib/fields.js):
//
//   GRID LISTY (nagłówek MM)  → savpolZostawKolumny(KEEP_LISTA)
//   GRID POZYCJI (karta MM)   → savpolZostawKolumny(KEEP_POZYCJE)
//
// KEEP_POZYCJE zawiera 'ItemDesc' mimo że nie trafia do bazy — jest wymagany
// do wykrycia gridu pozycji i odfiltrowania realnych wierszy (SKU).
//
// Wynik (co odznaczono / czego brakło w panelu) ląduje w schowku.
// NIE zamyka panelu — zatwierdź ręcznie (Zastosuj).

(function () {
  'use strict';

  const WERSJA = '2026-09-15.1';

  // Zsynchronizowane z automatyzacje/mm/lib/fields.js (2026-09-15, po
  // weryfikacji na żywym ERP). KEEP_LISTA = HEADER_FIELDS (40): 30 podstawowych
  // + 10 pól dawniej "niedostępnych", które w bogatszym gridzie listy MM są
  // dostępne (PaymentDay, csPaymentsTypesId, csPeriodsId, csDocsHeadersStatusId,
  // csVATPeriodsId, csEmployeesId, csB2BPortalsId, csB2BPortalsDeliveryMethodsId,
  // csPayersId, anaDocDate). KEEP_POZYCJE = POSITION_FIELDS + ItemDesc.
  // UWAGA: po zaznaczeniu zapisz nowy układ listy i ustaw jako DOMYŚLNY —
  // inaczej ERP nie zapamięta włączonych kolumn.
  window.KEEP_LISTA = ["csDocsHeadersId","csDocsHeadersG","csCompaniesId","csDocsTypesId","DocNo","DocNumber","DocNumberExt","CGAmount","CNAmount","CTAmount","FGAmount","FNAmount","FTAmount","DocDate","DocDateExt","csCustomersId","PaymentDate","DocSaleDate","DocVATDate","Stock","csWarehousesId","FStock","DocNumberExtAdd2","ExchangeRate","csCurrenciesId","S01Amount","S02Amount","DocWeight","DocGrossWeight","csWarehousesIdDel","PaymentDay","csPaymentsTypesId","csPeriodsId","csDocsHeadersStatusId","csVATPeriodsId","csEmployeesId","csB2BPortalsId","csB2BPortalsDeliveryMethodsId","csPayersId","anaDocDate"];
  window.KEEP_POZYCJE = ["ItemDesc","csCompaniesId","csDocsHeadersId","csDocsItemsPositionsId","csDocsItemsPositionsG","Id","csItemsId","csItemsUnitsId","csVATRatesId","QuantityUnits","Quantity","Discount","CUnitPrice","CUnitNetPrice","FUnitNetPrice","CUnitGrossPrice","FUnitGrossPrice","CNetPrice","FNetPrice","CGrossPrice","FGrossPrice","CGAmount","CNAmount","CTAmount","FGAmount","FNAmount","FTAmount","csCurrenciesId","PositionDesc","Rate","FStock","QStock","dCGAmount","dCNAmount","dCTAmount","dFGAmount","dFNAmount","dFTAmount","dQuantity","PStock","csWarehousesId","csWarehousesIdDel","S01Amount","S01Quantity","S02Amount","S02Quantity","CUnitListPrice","CUnitListPriceLimit","CUnitListPriceMin","DocPackageWeight","DocWeight","QuantityPallets","DocGrossWeight","priceInfo","CUnitPriceSuggested","CUnitPriceSuggestedSalesAgr","paramsJSON"];

  console.log('[zostaw-kolumny] wersja ' + WERSJA + '. Gotowe listy: KEEP_LISTA (' +
    window.KEEP_LISTA.length + '), KEEP_POZYCJE (' + window.KEEP_POZYCJE.length + ').');

  function doSchowka(s) {
    try { if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków przez copy())'; } } catch (e) { /* niżej */ }
    if (navigator.clipboard) { navigator.clipboard.writeText(s).catch(() => {}); return '(skopiowano przez navigator.clipboard)'; }
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nic */ }
    document.body.removeChild(ta);
    return '(skopiowano przez textarea)';
  }

  window.savpolZostawKolumny = function (keep) {
    if (!Array.isArray(keep) || !keep.length) {
      console.error('[zostaw-kolumny] Podaj listę pól, np. savpolZostawKolumny(KEEP_POZYCJE).');
      return null;
    }
    const keepSet = new Set(keep);
    const panels = Array.from(document.querySelectorAll('.c-settings-list')).filter(p => p.offsetParent !== null);
    if (!panels.length) {
      console.error('[zostaw-kolumny] Brak widocznego panelu .c-settings-list. Otwórz panel wyboru kolumn i uruchom ponownie.');
      return null;
    }

    const odznaczone = [];
    const wlaczoneBrakujace = []; // z KEEP, a były wyłączone — dozaznaczamy
    const znalezione = new Set();

    panels.forEach(panel => {
      Array.from(panel.querySelectorAll(':scope > .colField[data-fieldname]')).forEach(el => {
        const field = el.getAttribute('data-fieldname');
        const cb = el.querySelector('input[type="checkbox"]');
        if (!cb) return;
        znalezione.add(field);
        const chcemy = keepSet.has(field);
        if (chcemy && !cb.checked) {
          (el.querySelector('label.Icon') || cb).click();
          if (!wlaczoneBrakujace.includes(field)) wlaczoneBrakujace.push(field);
        } else if (!chcemy && cb.checked) {
          (el.querySelector('label.Icon') || cb).click();
          if (!odznaczone.includes(field)) odznaczone.push(field);
        }
      });
    });

    // Pola z KEEP, których w ogóle nie ma w panelu tego gridu — sygnał, że
    // lista KEEP nie pasuje do gridu (np. KEEP_LISTA puszczona na karcie pozycji).
    const brakWPanelu = keep.filter(f => !znalezione.has(f));

    const raport = [
      '=== ZOSTAW TYLKO POTRZEBNE KOLUMNY — ' + new Date().toISOString() + ' — ' + location.href + ' ===',
      'Paneli widocznych: ' + panels.length + ', KEEP: ' + keep.length,
      'Odznaczono (' + odznaczone.length + '): ' + (odznaczone.join(', ') || '(nic — już był minimalny zestaw)'),
      'Dozaznaczono z KEEP (' + wlaczoneBrakujace.length + '): ' + (wlaczoneBrakujace.join(', ') || '(nic)'),
      'BRAK w panelu tego gridu (' + brakWPanelu.length + '): ' + (brakWPanelu.join(', ') || '(brak — wszystkie z KEEP są)')
    ].join('\n');

    const info = doSchowka(raport);
    console.log('[zostaw-kolumny] Odznaczono ' + odznaczone.length + ', dozaznaczono ' + wlaczoneBrakujace.length +
      (brakWPanelu.length ? ', UWAGA brak w panelu: ' + brakWPanelu.length + ' (zła lista dla tego gridu?)' : '') +
      '. ' + info + '. Sprawdź na oko i kliknij Zastosuj.');
    return { odznaczone, wlaczoneBrakujace, brakWPanelu };
  };

  console.log('[zostaw-kolumny] Gotowe. Na liście MM: savpolZostawKolumny(KEEP_LISTA). Na karcie pozycji: savpolZostawKolumny(KEEP_POZYCJE).');
})();
