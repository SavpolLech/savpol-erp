// Zrzut WSZYSTKICH widocznych pól karty produktu — do matchowania z listą
// kolumn tabeli produktowej (csItems) od Michała.
// WERSJA: 2026-09-11.2
//            Konsola wypisuje ją po wklejeniu — jeśli tam widzisz
//            inny numer, w przeglądarce siedzi starsza kopia.
//
// Po co: mamy listę ~141 kolumn tabeli produktowej z ERP (automatyzacje/
// produkty/info/kolumny.txt) i chcemy sprawdzić, ile z nich da się wyłuskać
// ze scrapowania karty produktu. Ta sonda nie zgaduje, w której zakładce co
// jest — zrzuca WSZYSTKO, co jest w danej chwili renderowane i widoczne
// (odfiltrowane przez offsetParent !== null), więc jeśli klikniesz inną
// zakładkę, dostaniesz jej zawartość — bez względu na to, czy to górny
// przełącznik (Dane podstawowe/dodatkowe) czy boczna lista (Zapasy/Zdjęcia/
// Grupy/...).
//
// Jak używać:
//   1. Otwórz w ERP KARTĘ PRODUKTU (Edycja) dowolnego produktu.
//   2. Wklej ten plik w konsolę — RAZ. Od razu robi pierwszy zrzut i
//      rejestruje funkcję globalną.
//   3. Wynik sam ląduje w schowku. Wklej go do rozmowy.
//   4. Kliknij kolejną zakładkę, wpisz w konsoli: savpolZrzutPolKarty()
//      (bez ponownego wklejania całego skryptu) — i tak za każdym razem.
//
// Nic nie klika i nic nie wysyła — tylko czyta DOM.

(function () {
  'use strict';

  const WERSJA = '2026-09-11.2';

  function wlasnyTekst(el) {
    return Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).join(' ').replace(/\s+/g, ' ').trim();
  }

  function opisEl(el) {
    return '<' + el.tagName.toLowerCase()
      + (el.id ? ' id="' + el.id + '"' : '')
      + ' class="' + String(el.className || '').slice(0, 70) + '"'
      + '>';
  }

  function etykietaPola(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    let w = el;
    for (let i = 0; i < 6 && w; i++) {
      w = w.parentElement;
      if (!w) break;
      const lab = w.querySelector(':scope > label.Label, :scope label.Label, :scope > label, :scope > .Label');
      if (lab) return (lab.getAttribute('title') || lab.textContent || '').trim();
    }
    return '';
  }

  function wartoscPola(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      return el.checked ? 'TAK' : 'nie';
    }
    if (tag === 'select') {
      const opt = el.options[el.selectedIndex];
      return opt ? opt.text : String(el.value || '');
    }
    return String(el.value || '');
  }

  // Atrybuty, które mogą wprost zdradzić techniczną nazwę kolumny w bazie —
  // złoto do matchowania z listą Michała, jeśli akurat są ustawione.
  const TECH_ATRYBUTY = ['name', 'id', 'data-bind', 'data-field', 'data-datafield', 'formcontrolname', 'data-role'];
  function techPola(el) {
    const out = [];
    TECH_ATRYBUTY.forEach(a => {
      const v = el.getAttribute(a);
      if (v) out.push(a + '="' + v + '"');
    });
    return out.join(' ');
  }

  function kopiuj(txt) {
    try {
      if (typeof copy === 'function') {
        copy(txt);
        console.log('[zrzut-pol-karty ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków');
        return;
      }
    } catch (e) { /* lecimy dalej */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt)
        .then(() => console.log('[zrzut-pol-karty ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'))
        .catch(() => zapas(txt));
    } else {
      zapas(txt);
    }
  }

  function zapas(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    console.log(ok
      ? '[zrzut-pol-karty ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'
      : '[zrzut-pol-karty ' + WERSJA + '] NIE UDAŁO SIĘ skopiować — użyj: copy(window.__zrzutPolKarty)');
    window.__zrzutPolKarty = txt;
  }

  // Funkcja globalna — po pierwszym wklejeniu wywołuj tylko ją, bez
  // ponownego wklejania całego skryptu przy zmianie zakładki.
  window.savpolZrzutPolKarty = function () {
    const linie = [];
    linie.push('Savpol ERP — zrzut pól karty produktu, wersja ' + WERSJA);
    linie.push('URL: ' + location.href);
    linie.push('Data: ' + new Date().toISOString());

    const karty = Array.from(document.querySelectorAll('.csItemsOneBro'));
    const karta = karty.find(k => k.offsetParent !== null) || karty[0];
    if (!karta) {
      linie.push('');
      linie.push('NIE MA OTWARTEJ KARTY PRODUKTU. Wejdź w Edycję produktu i powtórz.');
    } else {
      linie.push('Formularzy .csItemsOneBro na stronie: ' + karty.length + ' (biorę widoczny)');
      linie.push('');

      // Które zakładki są aktualnie podświetlone — obu przełączników, jeśli
      // się różnią markupem, złapie to poniższa heurystyka (klasa zawiera
      // "active"/"selected"/"current"), więc nie musimy znać ich selektorów.
      linie.push('--- aktualnie aktywne zakładki (heurystyka po klasie) ---');
      Array.from(karta.querySelectorAll('*'))
        .filter(el => /active|selected|current/i.test(String(el.className || '')))
        .map(el => wlasnyTekst(el))
        .filter(t => t && t.length <= 40)
        .forEach(t => linie.push('  „' + t + '"'));

      linie.push('');
      linie.push('--- WIDOCZNE POLA (input / select / textarea), znaczenie = to co teraz renderuje przeglądarka ---');
      const pola = Array.from(karta.querySelectorAll('input, select, textarea'))
        .filter(el => el.type !== 'hidden')
        .filter(el => el.offsetParent !== null);

      linie.push('razem widocznych pól: ' + pola.length);
      linie.push('');

      pola.forEach((el, i) => {
        const etykieta = etykietaPola(el) || '(bez etykiety)';
        const wartosc = wartoscPola(el);
        const tech = techPola(el);
        linie.push((i + 1) + '. ' + etykieta.padEnd(36).slice(0, 36)
          + '  ' + opisEl(el)
          + (tech ? '  [' + tech + ']' : '')
          + '  wartość=„' + wartosc.slice(0, 100).replace(/\s+/g, ' ') + '"');
      });

      // Nagłówki grup na aktywnej zakładce — pomaga zorientować się w
      // sekcjach, gdy etykieta pola sama w sobie nic nie mówi.
      linie.push('');
      linie.push('--- widoczne nagłówki grup (.csGroupBoxHeader) ---');
      Array.from(karta.querySelectorAll('.csGroupBoxHeader'))
        .filter(h => h.offsetParent !== null)
        .forEach(h => linie.push('  „' + (h.textContent || '').trim().slice(0, 60) + '"'));
    }

    const txt = linie.join('\n');
    kopiuj(txt);
  };

  console.log('[zrzut-pol-karty ' + WERSJA + '] gotowe. Przy zmianie zakładki wywołuj: savpolZrzutPolKarty()');
  window.savpolZrzutPolKarty();
})();
