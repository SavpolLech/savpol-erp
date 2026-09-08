// Sonda: jak wygląda panel filtrów nad listą WZ (pola dat, przycisk "Pokaż")
// — wklej w konsolę NA LIŚCIE WZ, z panelem filtrów widocznym na ekranie
// (nie musisz niczego wpisywać — sonda tylko czyta strukturę).
// WERSJA: 2026-09-08.1
//
// PO CO: automatyzacja (Playwright) startuje w osobnej, świeżej sesji
// przeglądarki — filtr ustawiony ręcznie w Twojej karcie jej nie dotyczy.
// Żeby scraper mógł sam ustawić zakres dat, potrzebujemy dokładnych
// selektorów pól filtra (nie zgadywania).
//
// SONDA NICZEGO NIE KLIKA I NIE WYPEŁNIA. Tylko czyta to, co już jest na ekranie.
//
// Jak używać:
//   1. Na liście WZ, z widocznym panelem filtrów (daty, ewentualnie inne
//      pola), wklej ten plik.
//   2. savpolFiltrSondaKopiuj()  → wynik do schowka.

(function () {
  'use strict';

  const WERSJA = '2026-09-08.1';
  console.log('[sonda-filtr-daty] wersja ' + WERSJA + '. URL: ' + location.href);

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda-filtr-daty] ' + t); };

  window.savpolFiltrSondaKopiuj = function () {
    const s = linie.join('\n');
    try { if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków)'; } } catch (e) { /* niżej */ }
    if (navigator.clipboard) { navigator.clipboard.writeText(s).catch(() => {}); return '(skopiowano przez navigator.clipboard)'; }
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nic więcej */ }
    document.body.removeChild(ta);
    return '(skopiowano przez textarea)';
  };

  function describeEl(el) {
    const attrs = ['id', 'name', 'type', 'placeholder', 'class', 'data-datafield', 'data-key', 'title', 'value'];
    return '<' + el.tagName.toLowerCase() + '> ' +
      attrs.map(a => el.getAttribute(a) ? (a + '="' + el.getAttribute(a) + '"') : '').filter(Boolean).join(' ');
  }

  log('=== PANEL FILTRÓW LISTY WZ — ' + new Date().toISOString() + ' — ' + location.href + ' ===');

  // Pola dat bywają w tym ERP różnie zbudowane (zwykły input, albo widget
  // z osobnym kalendarzem) — zrzucamy szeroko: wszystko z "date"/"data" w
  // atrybutach, plus cały widoczny panel filtra jeśli go znajdziemy.
  const dateLike = Array.from(document.querySelectorAll('input, [class*="date" i], [class*="Date"], [id*="date" i]'))
    .filter(el => el.offsetParent !== null);
  log('Elementy "datopodobne" widoczne na ekranie: ' + dateLike.length);
  dateLike.slice(0, 40).forEach(el => log('  ' + describeEl(el)));

  const filterPanel = document.querySelector('.csFilterPanel, [class*="Filter" i], #FilterPanel');
  if (filterPanel) {
    log('--- Znaleziony panel filtra: ' + describeEl(filterPanel) + ' ---');
    log(filterPanel.outerHTML.replace(/\s+/g, ' ').slice(0, 4000));
  } else {
    log('Nie znaleziono elementu pasującego do ".csFilterPanel"/"[class*=Filter]"/"#FilterPanel" — podaj ręcznie, gdzie fizycznie na ekranie są pola dat.');
  }

  // Przycisk "Pokaż" / zatwierdzenie filtra.
  const buttons = Array.from(document.querySelectorAll('.csButton, button, [role="button"]'))
    .filter(b => b.offsetParent !== null && /pok|szuk|filtr|zastosuj/i.test(b.textContent || ''));
  log('--- Przyciski pasujące do "Pokaż/Szukaj/Filtruj/Zastosuj" ---');
  buttons.forEach(b => log('  ' + describeEl(b) + ' text="' + (b.textContent || '').trim().slice(0, 40) + '"'));

  console.log('[sonda-filtr-daty] Gotowe. Wywołaj savpolFiltrSondaKopiuj() i wklej wynik.');
})();
