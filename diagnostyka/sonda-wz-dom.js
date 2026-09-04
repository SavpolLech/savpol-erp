// Sonda: jakie kolumny/selektory ma lista i karta dokumentu WZ — wklej w konsolę.
// WERSJA: 2026-09-04.1
//            Konsola wypisuje ją po wklejeniu — jeśli tam widzisz inny numer,
//            w przeglądarce siedzi starsza kopia.
//
// PO CO: zanim napiszemy skrypt, który sam klika po liście WZ (jak
// savpol-mapa-produktow.user.js robi dla faktur), trzeba zobaczyć realne
// selektory: nazwy kolumn (data-datafield) na liście i na karcie pozycji WZ,
// jak wygląda wiersz, jak wygląda pager. Zgadywanie na podstawie faktur może
// nie trafić — WZ to inny typ dokumentu, inne kolumny.
//
// SONDA NICZEGO NIE ZAPISUJE I NICZEGO NIE KLIKA. Tylko czyta to, co już jest
// na ekranie.
//
// Jak używać:
//   1. Będąc na liście WZ (adres z „wydania-zewnetrzne/csdocsheaders4goodsissue"),
//      z ustawionymi filtrami, wklej ten plik i wywołaj:
//         savpolWzSondaLista()
//   2. Otwórz DWUKLIKIEM jeden dokument WZ z listy (żeby otworzyła się karta
//      z pozycjami), potem wywołaj:
//         savpolWzSondaKarta()
//   3. savpolWzSondaKopiuj()  → wynik (obu kroków razem) do schowka.
//
// savpolWzSondaStan() pokazuje, co już zebrano, bez czekania.

(function () {
  'use strict';

  const WERSJA = '2026-09-04.1';
  console.log('[sonda-wz-dom] wersja ' + WERSJA + '. URL: ' + location.href);

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda-wz-dom] ' + t); };
  const naglowek = (t) => { linie.push(''); linie.push('=== ' + t + ' ==='); };

  window.savpolWzSondaWynik = '(sonda jeszcze nie wywołana)';
  window.savpolWzSondaKopiuj = function () {
    const s = linie.join('\n') || window.savpolWzSondaWynik;
    window.savpolWzSondaWynik = s;
    try {
      if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków)'; }
    } catch (e) { /* niżej */ }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(s).catch(() => fallbackCopy(s));
      return '(skopiowano ' + s.length + ' znaków, przez navigator.clipboard)';
    }
    return fallbackCopy(s);
  };

  function fallbackCopy(s) {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nic więcej do zrobienia */ }
    document.body.removeChild(ta);
    return '(skopiowano ' + s.length + ' znaków, przez textarea)';
  }

  window.savpolWzSondaStan = function () {
    return '[sonda-wz-dom ' + WERSJA + '] zebranych linii: ' + linie.length +
      ' | URL: ' + location.href;
  };

  // ---------- Odczyt DOM (ogólny, bez zakładania konkretnych kolumn) ----------

  function visibleGrids() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .filter(t => t.offsetParent !== null);
  }

  function describeGrid(grid, maxRows) {
    const out = [];
    const headerCells = Array.from(grid.querySelectorAll('thead td, thead th, tr.cs-grid-header-row td'));
    if (headerCells.length) {
      out.push('Nagłówek (tekst): ' + headerCells.map(c => (c.textContent || '').trim()).join(' | '));
    }
    const rows = Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
    out.push('Liczba wierszy w DOM: ' + rows.length);
    const sample = rows.slice(0, maxRows || 2);
    sample.forEach((row, i) => {
      out.push('-- Wiersz ' + i + ' --');
      const cells = Array.from(row.querySelectorAll('td[data-datafield]'));
      cells.forEach(c => {
        const field = c.getAttribute('data-datafield');
        const title = c.getAttribute('title');
        const text = (c.textContent || '').trim().replace(/\s+/g, ' ');
        const boldEls = Array.from(c.querySelectorAll('.cs-style-text-bold'))
          .map(b => (b.textContent || '').trim());
        out.push('  ' + field + ' | title="' + (title || '') + '" | text="' +
          text.slice(0, 120) + '"' +
          (boldEls.length ? ' | bold=[' + boldEls.join(' / ') + ']' : ''));
      });
    });
    return out.join('\n');
  }

  function describePager() {
    const pagers = Array.from(document.querySelectorAll('.csDataPager')).filter(p => p.offsetParent !== null);
    if (!pagers.length) return '(brak widocznego pagera)';
    return pagers.map(p => p.outerHTML.replace(/\s+/g, ' ').slice(0, 800)).join('\n---\n');
  }

  function describeToolbar() {
    const tb = Array.from(document.querySelectorAll('#ToolBarPanel')).find(t => t.offsetParent !== null);
    return tb ? tb.outerHTML.replace(/\s+/g, ' ').slice(0, 500) : '(brak widocznego #ToolBarPanel)';
  }

  // ---------- Krok 1: lista ----------

  window.savpolWzSondaLista = function () {
    naglowek('LISTA WZ — ' + new Date().toISOString() + ' — ' + location.href);
    const grids = visibleGrids();
    log('Widocznych siatek .cs-grid-data-table: ' + grids.length);
    grids.forEach((g, i) => {
      log('--- Siatka #' + i + ' ---');
      log(describeGrid(g, 3));
    });
    log('--- Pager ---');
    log(describePager());
    log('--- Toolbar ---');
    log(describeToolbar());
    log('--- Zakładki (jeśli są) ---');
    const tabs = Array.from(document.querySelectorAll('li.k-state-active .k-link[title]'));
    log(tabs.map(t => t.getAttribute('title')).join(' | ') || '(brak)');
    return savpolWzSondaKopiuj();
  };

  // ---------- Krok 2: karta dokumentu (po dwukliku na wierszu listy) ----------

  window.savpolWzSondaKarta = function () {
    naglowek('KARTA WZ (po otwarciu dokumentu) — ' + new Date().toISOString() + ' — ' + location.href);
    const grids = visibleGrids();
    log('Widocznych siatek .cs-grid-data-table: ' + grids.length + ' (jedna z nich to zwykle pozycje dokumentu)');
    grids.forEach((g, i) => {
      log('--- Siatka #' + i + ' ---');
      log(describeGrid(g, 5));
    });
    // Nagłówek dokumentu (kontrahent, data, magazyn) często nie siedzi w
    // siatce, tylko w polach formularza — zrzucamy wszystkie widoczne pola
    // z etykietą, żeby było z czego wybrać właściwe.
    log('--- Widoczne pola formularza z etykietą (label/input/select) ---');
    const labels = Array.from(document.querySelectorAll('label')).filter(l => l.offsetParent !== null);
    labels.slice(0, 60).forEach(l => {
      const forId = l.getAttribute('for');
      let val = '';
      if (forId) {
        const el = document.getElementById(forId);
        if (el) val = el.value !== undefined ? el.value : (el.textContent || '').trim();
      }
      log('  "' + (l.textContent || '').trim() + '" => ' + (val || '').toString().slice(0, 80));
    });
    log('--- Zakładki (jeśli są) ---');
    const tabs = Array.from(document.querySelectorAll('li.k-state-active .k-link[title]'));
    log(tabs.map(t => t.getAttribute('title')).join(' | ') || '(brak)');
    return savpolWzSondaKopiuj();
  };
})();
