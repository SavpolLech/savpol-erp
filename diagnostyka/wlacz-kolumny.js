// Zaznacza checkboxy w OTWARTYM panelu wyboru kolumn (.c-settings-list) po
// nazwie pola (data-fieldname) — zamiast klikać ręcznie jedno po drugim.
// WERSJA: 2026-09-07.1
//
// PO CO: z mapowania (automatyzacje/wz/mapowanie-pol.md) wiadomo dokładnie,
// których 11 pól brakuje w gridzie pozycji WZ. Zamiast klikać każde z osobna,
// jedna komenda zaznacza wszystkie naraz.
//
// NIE zamyka/zatwierdza panelu — to zrób ręcznie tak jak zwykle (żeby na oko
// zobaczyć, że checkboxy się zaznaczyły, zanim panel zniknie).
//
// Jak używać:
//   1. Otwórz panel wyboru kolumn na karcie pozycji WZ (tak jak na screenie).
//   2. Wklej ten plik w konsolę.
//   3. savpolWlaczKolumny()   — bez argumentu zaznacza domyślny zestaw
//      (11 pól pozycji z mapowania). Możesz też podać własną listę:
//      savpolWlaczKolumny(['PoleX', 'PoleY'])

(function () {
  'use strict';

  const WERSJA = '2026-09-07.1';
  console.log('[wlacz-kolumny] wersja ' + WERSJA);

  // 10 pól z Panelu #10 (pozycje) + ExchangeRate — patrz mapowanie-pol.md,
  // sekcja "Do zrobienia w ERP".
  const DOMYSLNE_POLA = [
    'csCompaniesId', 'csDocsHeadersId', 'csDocsItemsPositionsId',
    'CGAmount', 'CNAmount', 'CTAmount', 'FGAmount', 'FNAmount', 'FTAmount',
    'QStock', 'ExchangeRate'
  ];

  window.savpolWlaczKolumny = function (pola) {
    const lista = pola || DOMYSLNE_POLA;
    const panels = Array.from(document.querySelectorAll('.c-settings-list')).filter(p => p.offsetParent !== null);
    if (!panels.length) {
      console.error('[wlacz-kolumny] Brak widocznego panelu .c-settings-list. Otwórz panel wyboru kolumn i uruchom ponownie.');
      return null;
    }

    const wynik = { wlaczone: [], juz_bylo: [], nie_znaleziono: [] };

    // Panel bywa zduplikowany w DOM (widzieliśmy to w sondzie) — działamy na
    // WSZYSTKICH widocznych kopiach, żeby nie zaznaczyć niewłaściwej.
    panels.forEach(panel => {
      lista.forEach(field => {
        const el = panel.querySelector(':scope > .colField[data-fieldname="' + field + '"]');
        if (!el) {
          if (!wynik.nie_znaleziono.includes(field)) wynik.nie_znaleziono.push(field);
          return;
        }
        const checkbox = el.querySelector('input[type="checkbox"]');
        if (!checkbox) {
          if (!wynik.nie_znaleziono.includes(field)) wynik.nie_znaleziono.push(field);
          return;
        }
        if (checkbox.checked) {
          if (!wynik.juz_bylo.includes(field)) wynik.juz_bylo.push(field);
          return;
        }
        // Klik na widoczną "ikonę" checkboxa (label powiązany przez `for`),
        // nie na sam <input> — te niestandardowe checkboxy (patrz screen:
        // csCheckBox / cs-inited) zwykle nasłuchują kliku na warstwie
        // wizualnej, nie na natywnym evencie inputa.
        const label = el.querySelector('label.Icon');
        (label || checkbox).click();
        if (!wynik.wlaczone.includes(field)) wynik.wlaczone.push(field);
      });
    });

    console.log('[wlacz-kolumny] Włączone teraz: ' + (wynik.wlaczone.join(', ') || '(brak)'));
    console.log('[wlacz-kolumny] Już było włączone: ' + (wynik.juz_bylo.join(', ') || '(brak)'));
    if (wynik.nie_znaleziono.length) {
      console.warn('[wlacz-kolumny] NIE znaleziono w tym panelu: ' + wynik.nie_znaleziono.join(', '));
    }
    console.log('[wlacz-kolumny] Sprawdź na oko, czy checkboxy się zaznaczyły, potem zamknij/zatwierdź panel jak zwykle.');
    return wynik;
  };

  console.log('[wlacz-kolumny] Gotowe. Otwórz panel kolumn karty pozycji WZ i wywołaj: savpolWlaczKolumny()');
})();
