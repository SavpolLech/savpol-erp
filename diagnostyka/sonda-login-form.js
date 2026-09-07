// Sonda: jak wygląda formularz logowania ERP — wklej w konsolę NA STRONIE LOGOWANIA,
// PRZED wpisaniem loginu/hasła (albo po, sonda i tak nie czyta wartości pól hasła).
// WERSJA: 2026-09-04.1
//
// PO CO: Playwright będzie musiał sam wypełnić formularz logowania przy każdym
// uruchomieniu automatyzacji. Potrzebuje dokładnych selektorów (id/name pól),
// nie zgadywania.
//
// SONDA NICZEGO NIE WYSYŁA. Celowo NIE czyta wartości pola hasła (nawet jeśli
// już coś wpisałeś) — tylko jego selektor, żeby Playwright wiedział, GDZIE wpisać,
// a nie CO tam jest.

(function () {
  'use strict';

  const WERSJA = '2026-09-04.1';
  console.log('[sonda-login-form] wersja ' + WERSJA + '. URL: ' + location.href);

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda-login-form] ' + t); };

  window.savpolLoginSondaKopiuj = function () {
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
    const attrs = ['id', 'name', 'type', 'placeholder', 'class', 'autocomplete'];
    return '<' + el.tagName.toLowerCase() + '> ' +
      attrs.map(a => el.getAttribute(a) ? (a + '="' + el.getAttribute(a) + '"') : '').filter(Boolean).join(' ');
  }

  log('=== FORMULARZ LOGOWANIA — ' + new Date().toISOString() + ' — ' + location.href + ' ===');

  const inputs = Array.from(document.querySelectorAll('input')).filter(i => i.offsetParent !== null);
  log('Widocznych <input>: ' + inputs.length);
  inputs.forEach((i, idx) => {
    const isPwd = (i.type || '').toLowerCase() === 'password';
    log('  #' + idx + ' ' + describeEl(i) + (isPwd ? ' [WARTOŚĆ POMINIĘTA — to pole hasła]' : ''));
  });

  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
    .filter(b => b.offsetParent !== null);
  log('Widocznych przycisków: ' + buttons.length);
  buttons.forEach((b, idx) => {
    log('  #' + idx + ' ' + describeEl(b) + ' text="' + (b.textContent || b.value || '').trim().slice(0, 40) + '"');
  });

  const forms = Array.from(document.querySelectorAll('form'));
  log('Formularzy <form>: ' + forms.length);
  forms.forEach((f, idx) => {
    log('  #' + idx + ' action="' + (f.getAttribute('action') || '') + '" method="' + (f.getAttribute('method') || '') + '" id="' + (f.id || '') + '"');
  });

  console.log('[sonda-login-form] Gotowe. Wywołaj savpolLoginSondaKopiuj() i wklej wynik.');
})();
