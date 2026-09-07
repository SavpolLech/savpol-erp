// Sonda: wyciąga z panelu "wybór kolumn" (.c-settings-list) pary
// data-fieldname / etykieta — wklej w konsolę, gdy masz ten panel otwarty.
// WERSJA: 2026-09-07.1
//
// PO CO: znaleziony panel ustawień kolumn (.c-settings-list > .colField[data-fieldname])
// pokazuje WSZYSTKIE pola dostępne w danym gridzie, nie tylko włączone. Zamiast
// klikać każde z osobna i zgadywać nazwy z listy Michała, wyciągamy od razu
// całą mapę: nazwa techniczna (data-fieldname) -> etykieta po polsku (<span>),
// plus czy jest już zaznaczone (checkbox).
//
// SONDA NICZEGO NIE ZAZNACZA/ODZNACZA. Tylko czyta.
//
// Jak używać:
//   1. Otwórz panel wyboru kolumn (tak jak na screenie) na liście WZ.
//   2. Wklej ten plik w konsolę.
//   3. savpolKolumnySondaKopiuj()  → wynik do schowka.

(function () {
  'use strict';

  const WERSJA = '2026-09-07.1';
  console.log('[sonda-lista-kolumn] wersja ' + WERSJA + '. URL: ' + location.href);

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda-lista-kolumn] ' + t); };

  window.savpolKolumnySondaKopiuj = function () {
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

  log('=== LISTA KOLUMN DO WYBORU — ' + new Date().toISOString() + ' — ' + location.href + ' ===');

  const panels = Array.from(document.querySelectorAll('.c-settings-list'));
  if (!panels.length) {
    log('BRAK .c-settings-list w DOM — panel nie jest otwarty? Otwórz go i wklej sondę ponownie.');
  } else {
    log('Znaleziono paneli .c-settings-list: ' + panels.length);
  }

  panels.forEach((panel, pi) => {
    const fields = Array.from(panel.querySelectorAll(':scope > .colField[data-fieldname]'));
    log('--- Panel #' + pi + ' — pól: ' + fields.length + ' ---');
    fields.forEach(f => {
      const fieldname = f.getAttribute('data-fieldname');
      const key = f.getAttribute('data-key');
      const label = (f.querySelector(':scope > span') || {}).textContent || '';
      const checkbox = f.querySelector('input[type="checkbox"]');
      const checked = checkbox ? (checkbox.checked ? 'WŁĄCZONE' : 'wyłączone') : '?';
      log('  ' + fieldname + '\t| klucz=' + key + '\t| "' + label.trim() + '"\t| ' + checked);
    });
  });

  console.log('[sonda-lista-kolumn] Gotowe. Wywołaj savpolKolumnySondaKopiuj() i wklej wynik.');
})();
