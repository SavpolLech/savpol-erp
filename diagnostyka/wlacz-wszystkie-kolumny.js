// Zaznacza WSZYSTKIE checkboxy w OTWARTYM panelu wyboru kolumn
// (.c-settings-list) — pełny widok kolumn do scrapingu, bez klikania jednego
// po drugim. WERSJA: 2026-09-15.1
//
// PO CO: pod nowy typ dokumentu (MM) chcemy zobaczyć KAŻDĄ dostępną kolumnę
// w gridzie, żeby sonda-lista-kolumn.js zdjęła pełną mapę pól. Ten skrypt
// tylko WŁĄCZA (nigdy nie odznacza — pomija już zaznaczone).
//
// Wynik (co włączono / co już było) sam ląduje w schowku — nic nie zaznaczasz
// w konsoli ręcznie (zasada z CLAUDE.md).
//
// Jak używać:
//   1. Otwórz panel wyboru kolumn na gridzie (lista MM albo karta pozycji MM).
//   2. Wklej ten plik w konsolę.
//   3. savpolWlaczWszystkieKolumny()   → włącza + kopiuje raport do schowka.
//   NIE zamyka panelu — zatwierdź go ręcznie jak zwykle (Zastosuj), żeby na
//   oko sprawdzić, że checkboxy się zaznaczyły.

(function () {
  'use strict';

  const WERSJA = '2026-09-15.1';
  console.log('[wlacz-wszystkie-kolumny] wersja ' + WERSJA + '. URL: ' + location.href);

  function doSchowka(s) {
    try { if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków przez copy())'; } } catch (e) { /* niżej */ }
    if (navigator.clipboard) { navigator.clipboard.writeText(s).catch(() => {}); return '(skopiowano przez navigator.clipboard)'; }
    const ta = document.createElement('textarea');
    ta.value = s; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nic więcej */ }
    document.body.removeChild(ta);
    return '(skopiowano przez textarea)';
  }

  window.savpolWlaczWszystkieKolumny = function () {
    // Uwaga: w konsoli DevTools nie używaj nazwy `$` na własną zmienną — `$`
    // to wbudowany alias querySelector, kolizja rzuca "$.forEach is not a
    // function". Tutaj zmienna nazywa się `panels`, więc problemu nie ma.
    const panels = Array.from(document.querySelectorAll('.c-settings-list')).filter(p => p.offsetParent !== null);
    if (!panels.length) {
      console.error('[wlacz-wszystkie-kolumny] Brak widocznego panelu .c-settings-list. Otwórz panel wyboru kolumn i uruchom ponownie.');
      return null;
    }

    const wlaczone = [];
    const juzBylo = [];

    // Panel bywa zduplikowany w DOM — działamy na WSZYSTKICH widocznych kopiach.
    panels.forEach(panel => {
      const pola = Array.from(panel.querySelectorAll(':scope > .colField[data-fieldname]'));
      pola.forEach(el => {
        const field = el.getAttribute('data-fieldname');
        const checkbox = el.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        if (checkbox.checked) {
          if (!juzBylo.includes(field)) juzBylo.push(field);
          return;
        }
        // Klik na label.Icon (warstwa wizualna), nie na natywny <input> — te
        // niestandardowe checkboxy (csCheckBox / cs-inited) nasłuchują kliku na
        // ikonie, nie na evencie inputa. Sprawdzone przy WZ (wlacz-kolumny.js).
        const label = el.querySelector('label.Icon');
        (label || checkbox).click();
        if (!wlaczone.includes(field)) wlaczone.push(field);
      });
    });

    const naglowek = '=== WŁĄCZANIE WSZYSTKICH KOLUMN — ' + new Date().toISOString() + ' — ' + location.href + ' ===';
    const raport = [
      naglowek,
      'Paneli widocznych: ' + panels.length,
      'Włączono teraz (' + wlaczone.length + '): ' + (wlaczone.join(', ') || '(brak — wszystko już było włączone)'),
      'Już było włączone (' + juzBylo.length + '): ' + (juzBylo.join(', ') || '(brak)')
    ].join('\n');

    const info = doSchowka(raport);
    console.log('[wlacz-wszystkie-kolumny] Włączono ' + wlaczone.length + ', już było ' + juzBylo.length + '. ' + info +
      '. Sprawdź na oko i zatwierdź panel (Zastosuj).');
    return { wlaczone, juzBylo };
  };

  console.log('[wlacz-wszystkie-kolumny] Gotowe. Otwórz panel kolumn i wywołaj: savpolWlaczWszystkieKolumny()');
})();
