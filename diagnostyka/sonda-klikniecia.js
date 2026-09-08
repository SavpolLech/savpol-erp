// Sonda: nagrywa KOLEJNOŚĆ kliknięć, żeby pokazać dokładnie co i w jakiej
// kolejności trzeba kliknąć, zamiast zgadywać selektory po zrzutach DOM.
// WERSJA: 2026-09-08.1
//
// PO CO: automat nie trafia w prawidłowy przycisk zatwierdzający filtr dat
// na liście WZ (dwa różne "Pokaż" otwierały dokument zamiast filtrować).
// Zamiast zgadywać kolejny raz, nagrywamy Twoje prawdziwe kliknięcia.
//
// SONDA NICZEGO NIE BLOKUJE ANI NIE ZMIENIA — tylko podsłuchuje kliknięcia
// (capture phase, bez preventDefault), strona działa normalnie.
//
// Jak używać:
//   1. Wklej ten plik w konsolę PRZED tym, jak zaczniesz klikać (najlepiej
//      zaraz po wejściu na listę WZ, zanim cokolwiek zrobisz).
//   2. Wykonaj dokładnie tę sekwencję kliknięć, którą normalnie robisz, żeby
//      przefiltrować listę po dacie (ustawienie Od/Do i cokolwiek klikasz
//      żeby zatwierdzić).
//   3. savpolKlikSondaKopiuj()  → wynik do schowka, wklej mi.
//
// savpolKlikSondaStan() pokazuje, ile kliknięć już nagrano, bez kopiowania.

(function () {
  'use strict';

  const WERSJA = '2026-09-08.1';
  console.log('[sonda-klikniecia] wersja ' + WERSJA + '. Nagrywam kliknięcia od teraz. URL: ' + location.href);

  const zdarzenia = [];
  const started = Date.now();

  function opisz(el) {
    if (!el || el.nodeType !== 1) return null;
    const attrs = ['id', 'class', 'title', 'data-datafield', 'data-key', 'placeholder', 'type', 'name', 'href'];
    const attrTxt = attrs
      .map(a => el.getAttribute && el.getAttribute(a) ? a + '="' + el.getAttribute(a) + '"' : null)
      .filter(Boolean)
      .join(' ');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return '<' + el.tagName.toLowerCase() + '> ' + attrTxt + (text ? ' text="' + text + '"' : '');
  }

  function sciezka(el) {
    // Element kliknięty + do 4 przodków, żeby było widać w jakim kontenerze siedzi.
    const linie = [];
    let node = el;
    let poziom = 0;
    while (node && node.nodeType === 1 && poziom < 5) {
      linie.push('  '.repeat(poziom) + opisz(node));
      node = node.parentElement;
      poziom++;
    }
    return linie.join('\n');
  }

  document.addEventListener('click', function (e) {
    const t = (Date.now() - started) / 1000;
    zdarzenia.push('=== KLIKNIĘCIE #' + zdarzenia.length + ' — [' + t.toFixed(1) + 's] — URL: ' + location.href + ' ===\n' +
      sciezka(e.target));
    console.log('[sonda-klikniecia] Zarejestrowano klik #' + (zdarzenia.length - 1) + ': ' + opisz(e.target));
  }, true);

  window.savpolKlikSondaStan = function () {
    return '[sonda-klikniecia] nagranych kliknięć: ' + zdarzenia.length;
  };

  window.savpolKlikSondaKopiuj = function () {
    const s = '=== NAGRANE KLIKNIĘCIA — ' + new Date().toISOString() + ' ===\n\n' + zdarzenia.join('\n\n');
    try { if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków, ' + zdarzenia.length + ' kliknięć)'; } } catch (e) { /* niżej */ }
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

  console.log('[sonda-klikniecia] Gotowe. Klikaj normalnie. Na koniec: savpolKlikSondaKopiuj()');
})();
