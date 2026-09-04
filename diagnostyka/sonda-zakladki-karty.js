// Sonda: jak zbudowane są zakładki WEWNĄTRZ karty produktu.
// WERSJA: 2026-09-04.1
//            Konsola wypisuje ja po wklejeniu — jesli tam widzisz
//            inny numer, w przegladarce siedzi starsza kopia.
//
// Po co: skrypt ma sam wchodzić w zakładkę z opisami B2B, tak jak już wchodzi
// w załączniki. Szukanie po `li.k-item` nic w karcie nie znajduje, a w całym
// dokumencie nie ma napisu zawierającego „opis" — czyli i selektor, i nazwa
// są inne, niż zakładałem. Ta sonda pyta stronę, jak jest naprawdę.
//
// Jak używać:
//   1. Otwórz w ERP KARTĘ PRODUKTU (Edycja) — dowolnego.
//   2. Wklej ten plik w konsolę.
//   3. Wynik sam ląduje w schowku. Wklej go do rozmowy.
//
// Nic nie klika i nic nie wysyła — tylko czyta DOM.

(function () {
  'use strict';

  const WERSJA = '2026-09-04.1';
  const MAX_ETYKIET = 200;

  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/[ąàáâä]/g, 'a').replace(/[ćç]/g, 'c').replace(/[ęèéêë]/g, 'e')
      .replace(/ł/g, 'l').replace(/[ńñ]/g, 'n').replace(/[óòôö]/g, 'o')
      .replace(/[śş]/g, 's').replace(/[żź]/g, 'z').replace(/[üùú]/g, 'u');
  }

  // Tekst NALEŻĄCY do elementu, bez tekstu dzieci. Kontener obejmujący całą
  // kartę też zawiera słowo „Opisy" — a nie o niego nam chodzi.
  function wlasnyTekst(el) {
    return Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function opisEl(el) {
    return '<' + el.tagName.toLowerCase()
      + (el.id ? ' id="' + el.id + '"' : '')
      + ' class="' + String(el.className || '').slice(0, 90) + '"'
      + (el.getAttribute('role') ? ' role="' + el.getAttribute('role') + '"' : '')
      + (el.getAttribute('title') ? ' title="' + el.getAttribute('title') + '"' : '')
      + '>';
  }

  const linie = [];
  linie.push('Savpol ERP — sonda zakładek karty produktu, wersja ' + WERSJA);
  linie.push('URL: ' + location.href);
  linie.push('Data: ' + new Date().toISOString());

  // Karta produktu poznaje się po własnej klasie formularza.
  const karty = Array.from(document.querySelectorAll('.csItemsOneBro'));
  linie.push('Formularzy .csItemsOneBro: ' + karty.length);
  const karta = karty.find(k => k.offsetParent !== null) || karty[0];
  if (!karta) {
    linie.push('');
    linie.push('NIE MA OTWARTEJ KARTY PRODUKTU. Wejdź w Edycję produktu i powtórz.');
  } else {
    linie.push('Biorę: ' + opisEl(karta));
    linie.push('');

    // 1. Wszystkie własne etykiety w karcie — to z nich składają się zakładki,
    //    niezależnie od tego, jakim widżetem są zrobione.
    linie.push('--- etykiety w karcie (własny tekst, do ' + MAX_ETYKIET + ') ---');
    const etykiety = [];
    karta.querySelectorAll('*').forEach(el => {
      const t = wlasnyTekst(el);
      if (!t || t.length > 60) return;
      etykiety.push({ el: el, t: t });
    });
    etykiety.slice(0, MAX_ETYKIET).forEach(e => {
      linie.push('  ' + e.t.padEnd(34).slice(0, 34) + '  ' + opisEl(e.el));
    });
    if (etykiety.length > MAX_ETYKIET) {
      linie.push('  …[jeszcze ' + (etykiety.length - MAX_ETYKIET) + ']');
    }

    // 2. Czy cokolwiek w karcie w ogóle mówi o opisach, portalu albo B2B.
    //    Szukamy po słowach, których spodziewamy się na tej zakładce.
    linie.push('');
    linie.push('--- co pasuje do szukanych słów ---');
    ['opis', 'b2b', 'portal', 'esavpol', 'tresc', 'nazwa produktu', 'seo', 'dodatkow']
      .forEach(slowo => {
        const trafienia = etykiety.filter(e => fold(e.t).indexOf(slowo) >= 0);
        linie.push('  „' + slowo + '" → ' + trafienia.length
          + (trafienia.length
            ? ': ' + trafienia.slice(0, 8).map(e => e.t + ' ' + opisEl(e.el)).join('  |  ')
            : ''));
      });

    // 3. Budowa karty w głąb — żeby zobaczyć, gdzie siedzi pasek zakładek.
    linie.push('');
    linie.push('--- budowa karty, 4 poziomy ---');
    (function zejdz(el, poziom) {
      if (poziom > 4) return;
      Array.from(el.children).slice(0, 14).forEach(w => {
        const t = wlasnyTekst(w);
        linie.push('  '.repeat(poziom) + opisEl(w) + (t ? '  „' + t.slice(0, 50) + '"' : ''));
        zejdz(w, poziom + 1);
      });
    })(karta, 1);

    // 4. Elementy, które wyglądają na klikalne przełączniki.
    linie.push('');
    linie.push('--- kandydaci na przełączniki (klasa mówi tab/nav/menu/page) ---');
    const przelaczniki = Array.from(karta.querySelectorAll('*'))
      .filter(el => /tab|nav|menu|page|group|section/i.test(String(el.className || '')))
      .slice(0, 60);
    przelaczniki.forEach(el => {
      linie.push('  ' + opisEl(el) + '  „' + wlasnyTekst(el).slice(0, 40) + '"');
    });
  }

  const txt = linie.join('\n');

  // Do schowka sam — zasada projektu: nic nie zaznaczamy w konsoli ręcznie.
  try {
    if (typeof copy === 'function') {
      copy(txt);
      console.log('[sonda ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków');
      return;
    }
  } catch (e) { /* lecimy dalej */ }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt)
      .then(() => console.log('[sonda ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'))
      .catch(() => zapas());
  } else {
    zapas();
  }

  function zapas() {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    console.log(ok
      ? '[sonda ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'
      : '[sonda ' + WERSJA + '] NIE UDAŁO SIĘ skopiować — użyj: copy(window.__sondaZakladki)');
    window.__sondaZakladki = txt;
  }
})();
