// Sonda: czym różnią się trzy zestawy pól na zakładce SEO.
// WERSJA: 2026-09-07.3
//            Konsola wypisuje ja po wklejeniu — jesli tam widzisz
//            inny numer, w przegladarce siedzi starsza kopia.
//
// Po co: skrypt ma wpisywać meta tytuł i meta opis w formularz karty (zapis
// zostawiamy człowiekowi). Zakładka SEO ma jednak TRZY komplety pól
// „Tytuł / Słowa kluczowe / Opis / Robots / Canonical" o identycznych
// etykietach, a `id` są losowe i zmieniają się przy każdym renderze.
// Wypełniony jest tylko pierwszy komplet. Muszę wiedzieć, co je rozróżnia,
// bo wpisanie polskiego opisu w pole innego języka byłoby błędem cichym.
//
// Jak używać:
//   1. Otwórz KARTĘ PRODUKTU i kliknij zakładkę SEO.
//   2. Wklej ten plik w konsolę.
//   3. Wynik sam ląduje w schowku (kilka tysięcy znaków, nie kilkadziesiąt).
//
// Nic nie klika i nic nie wysyła — tylko czyta DOM.

(function () {
  'use strict';

  const WERSJA = '2026-09-07.3';
  const ETYKIETY = ['tytul', 'opis', 'slowa kluczowe', 'robots', 'canonical'];

  function fold(s) {
    return String(s || '').toLowerCase()
      .replace(/[ąàáâä]/g, 'a').replace(/[ćç]/g, 'c').replace(/[ęèéêë]/g, 'e')
      .replace(/ł/g, 'l').replace(/[ńñ]/g, 'n').replace(/[óòôö]/g, 'o')
      .replace(/[śş]/g, 's').replace(/[żź]/g, 'z').replace(/[üùú]/g, 'u');
  }

  function wlasnyTekst(el) {
    return Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim()).join(' ').replace(/\s+/g, ' ').trim();
  }

  function etykietaPola(el) {
    let w = el;
    for (let i = 0; i < 6 && w; i++) {
      w = w.parentElement;
      if (!w) break;
      const lab = w.querySelector('label.Label, label, .Label');
      if (lab) return (lab.getAttribute('title') || lab.textContent || '').trim();
    }
    return '';
  }

  const linie = [];
  linie.push('Savpol ERP — sonda pól SEO, wersja ' + WERSJA);
  linie.push('URL: ' + location.href);
  linie.push('Data: ' + new Date().toISOString());

  const karta = Array.from(document.querySelectorAll('.csDictBaseForm.csItemsOneBro'))
    .find(k => k.offsetParent !== null);
  if (!karta) {
    linie.push('');
    linie.push('NIE MA OTWARTEJ KARTY. Wejdź w Edycję produktu, kliknij SEO i powtórz.');
  } else {
    // Panel AKTYWNEJ zakładki — tylko on nas interesuje. Czytanie całej karty
    // dawało 62 tysiące znaków, z czego 60 tysięcy to inne zakładki.
    const aktywna = Array.from(karta.querySelectorAll('li.csTabListItemHeaderContainer'))
      .find(li => /csTabItemActive/.test(li.className));
    linie.push('Aktywna zakładka: ' + (aktywna ? aktywna.getAttribute('title') : '(nie wiem)'));
    linie.push('');

    const pola = Array.from(karta.querySelectorAll('textarea, input'))
      .filter(el => el.type !== 'hidden')
      .filter(el => ETYKIETY.indexOf(fold(etykietaPola(el))) >= 0);

    linie.push('--- pola o szukanych etykietach: ' + pola.length + ' ---');
    linie.push('');

    pola.forEach((el, nr) => {
      const wartosc = String(el.value || '');
      linie.push('##### ' + (nr + 1) + '. „' + etykietaPola(el) + '"  <'
        + el.tagName.toLowerCase() + '>  znaków=' + wartosc.length);
      if (wartosc) linie.push('   wartość: ' + wartosc.slice(0, 120).replace(/\s+/g, ' '));
      linie.push('   widoczne: ' + (el.offsetParent !== null ? 'TAK' : 'nie'));

      // Droga w górę drzewa. Tu musi siedzieć to, co rozróżnia komplety:
      // nagłówek grupy, nazwa języka, portal albo indeks kontrolki.
      linie.push('   przodkowie (od pola do karty):');
      let w = el;
      for (let i = 0; i < 12 && w && w !== karta; i++) {
        w = w.parentElement;
        if (!w) break;
        const t = wlasnyTekst(w);
        const naglowek = w.querySelector(':scope > .csGroupBoxHeader, :scope > #Header');
        linie.push('     <' + w.tagName.toLowerCase()
          + (w.id ? ' id="' + w.id + '"' : '')
          + ' class="' + String(w.className || '').slice(0, 110) + '"'
          + (w.getAttribute('title') ? ' title="' + w.getAttribute('title') + '"' : '')
          + '>'
          + (t ? '  własny tekst: „' + t.slice(0, 50) + '"' : '')
          + (naglowek ? '  NAGŁÓWEK: „' + (naglowek.textContent || '').trim().slice(0, 50) + '"' : ''));
      }
      linie.push('');
    });

    // Wszystkie nagłówki grup na aktywnej zakładce — jeśli komplety rozróżnia
    // nagłówek, to zobaczymy go tutaj.
    linie.push('--- nagłówki grup w karcie ---');
    Array.from(karta.querySelectorAll('.csGroupBoxHeader')).slice(0, 40).forEach(h => {
      linie.push('  „' + (h.textContent || '').trim().slice(0, 60) + '"  '
        + (h.offsetParent !== null ? '[widoczny]' : '[ukryty]'));
    });
  }

  const txt = linie.join('\n');
  try {
    if (typeof copy === 'function') {
      copy(txt);
      console.log('[sonda SEO ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków');
      return;
    }
  } catch (e) { /* lecimy dalej */ }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt)
      .then(() => console.log('[sonda SEO ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'))
      .catch(() => zapas());
  } else {
    zapas();
  }

  function zapas() {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    console.log(ok
      ? '[sonda SEO ' + WERSJA + '] skopiowano, ' + txt.length + ' znaków'
      : '[sonda SEO ' + WERSJA + '] NIE UDAŁO SIĘ — użyj: copy(window.__sondaSeo)');
    window.__sondaSeo = txt;
  }
})();
