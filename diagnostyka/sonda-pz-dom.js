// Sonda: jakie kolumny/selektory ma lista i karta dokumentu PZ (Przyjęcie
// zewnętrzne) — wklej w konsolę. WERSJA: 2026-09-17.1
//
// PO CO: budujemy scraper PZ na wzorcu automatyzacje/wz/ (patrz
// automatyzacje/pz/mapowanie-pol.md). Michał: "ten sam zestaw pól co WZ" —
// ale KAŻDY typ dokumentu renderuje inny zestaw kolumn (uprawnienia/widok
// użytkownika), więc nie zgadujemy, tylko czytamy realny DOM. Łączy w sobie
// sondę gridów (jak diagnostyka/sonda-wz-dom.js) i sondę panelu wyboru kolumn
// (jak diagnostyka/sonda-lista-kolumn.js) w JEDNYM przebiegu — jeden zrzut do
// wklejenia zamiast kilku.
//
// SONDA NICZEGO NIE ZAPISUJE I NICZEGO NIE KLIKA. Tylko czyta.
//
// Jak używać:
//   1. Włącz WSZYSTKIE kolumny w panelu kolumn PZ (lista i karta pozycji) —
//      diagnostyka/wlacz-wszystkie-kolumny.js — inaczej sonda nie zobaczy pól,
//      które istnieją, ale są wyłączone.
//   2. Będąc na liście PZ, wklej ten plik i wywołaj:
//        savpolPzSondaLista()
//   3. Otwórz DWUKLIKIEM jeden dokument PZ z listy, potem:
//        savpolPzSondaKarta()
//        savpolPzSondaSurowyWiersz()
//   4. Jeśli otwarty jest panel wyboru kolumn (osobno dla listy i dla karty
//      pozycji — powtórz dla obu):
//        savpolPzSondaKolumny()
//   5. savpolPzSondaKopiuj()  → cały zebrany wynik do schowka, wklej w czacie.
//
// savpolPzSondaStan() pokazuje, co już zebrano, bez czekania.

(function () {
  'use strict';

  const WERSJA = '2026-09-17.1';
  console.log('[sonda-pz-dom] wersja ' + WERSJA + '. URL: ' + location.href);

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda-pz-dom] ' + t); };
  const naglowek = (t) => { linie.push(''); linie.push('=== ' + t + ' ==='); };

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

  window.savpolPzSondaWynik = '(sonda jeszcze nie wywołana)';
  window.savpolPzSondaKopiuj = function () {
    const naglowekCaly = '=== SONDA PZ ' + WERSJA + ' — ' + new Date().toISOString() + ' — ' + location.href + ' ===';
    const s = [naglowekCaly, ''].concat(linie).join('\n');
    window.savpolPzSondaWynik = s;
    const info = doSchowka(s);
    console.log('[sonda-pz-dom] ' + info + ' (' + s.length + ' znaków).');
    return info;
  };

  window.savpolPzSondaStan = function () {
    return '[sonda-pz-dom ' + WERSJA + '] zebranych linii: ' + linie.length + ' | URL: ' + location.href;
  };

  // ---------- Odczyt gridów (bez zakładania konkretnych kolumn) ----------

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

  // ---------- Krok: lista ----------

  window.savpolPzSondaLista = function () {
    naglowek('LISTA PZ — ' + new Date().toISOString() + ' — ' + location.href);
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
    log('--- Zapisane filtry (jeśli panel zaawansowanego filtra jest otwarty) ---');
    const filterOptions = Array.from(document.querySelectorAll('li.k-item')).filter(li => li.offsetParent !== null);
    log(filterOptions.length ? filterOptions.map(li => '"' + (li.textContent || '').trim() + '"').join(', ') : '(panel filtra niewidoczny — pomiń albo otwórz go i wywołaj ponownie)');
    return savpolPzSondaKopiuj();
  };

  // ---------- Krok: karta dokumentu (po otwarciu jednego PZ) ----------

  window.savpolPzSondaKarta = function () {
    naglowek('KARTA PZ (po otwarciu dokumentu) — ' + new Date().toISOString() + ' — ' + location.href);
    const grids = visibleGrids();
    log('Widocznych siatek .cs-grid-data-table: ' + grids.length + ' (jedna z nich to zwykle pozycje dokumentu)');
    grids.forEach((g, i) => {
      log('--- Siatka #' + i + ' ---');
      log(describeGrid(g, 5));
    });
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
    return savpolPzSondaKopiuj();
  };

  // ---------- Krok: surowy wiersz pozycji (ID-ki ukryte poza kolumnami) ----------

  function positionsGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="ItemDesc"]')
      && t.querySelector('td[data-datafield="QuantityUnits"]')) || null;
  }

  window.savpolPzSondaSurowyWiersz = function () {
    naglowek('SUROWY WIERSZ POZYCJI PZ — ' + new Date().toISOString() + ' — ' + location.href);
    const grid = positionsGrid();
    if (!grid) {
      log('Nie znaleziono widocznej siatki pozycji (ItemDesc + QuantityUnits). Otwórz kartę PZ.');
      return savpolPzSondaKopiuj();
    }
    const row = grid.querySelector('tr.cs-grid-data-row');
    if (!row) {
      log('Siatka pozycji jest widoczna, ale brak wiersza z klasą cs-grid-data-row.');
      return savpolPzSondaKopiuj();
    }
    log('--- Atrybuty <tr> pierwszego wiersza pozycji ---');
    Array.from(row.attributes).forEach(a => log('  ' + a.name + ' = "' + a.value + '"'));

    log('--- Czy ItemDesc ma pogrubiony SKU (jak WZ) czy zwykły tekst (jak MM)? ---');
    const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
    const bold = descCell ? Array.from(descCell.querySelectorAll('.cs-style-text-bold')).map(b => (b.textContent || '').trim()) : [];
    log('ItemDesc bold=[' + bold.join(' / ') + '] (puste = brak pogrubienia, jak MM)');

    log('--- Wszystkie <td> w tym wierszu, także bez data-datafield ---');
    Array.from(row.querySelectorAll('td')).forEach((c, i) => {
      const attrs = Array.from(c.attributes).map(a => a.name + '="' + a.value + '"').join(' ');
      log('  td#' + i + ' [' + attrs + '] text="' + (c.textContent || '').trim().slice(0, 60) + '"');
    });

    log('--- Cały <tr> (skrócony do 2000 znaków) ---');
    log(row.outerHTML.replace(/\s+/g, ' ').slice(0, 2000));

    return savpolPzSondaKopiuj();
  };

  // ---------- Krok: panel wyboru kolumn (jeśli otwarty) ----------
  // Jak diagnostyka/sonda-lista-kolumn.js — wyciąga z .c-settings-list pary
  // data-fieldname / etykieta / czy zaznaczone. Wywołaj osobno dla panelu
  // listy PZ i dla panelu karty pozycji PZ.

  window.savpolPzSondaKolumny = function () {
    naglowek('PANEL WYBORU KOLUMN — ' + new Date().toISOString() + ' — ' + location.href);
    const panels = Array.from(document.querySelectorAll('.c-settings-list')).filter(p => p.offsetParent !== null);
    if (!panels.length) {
      log('BRAK widocznego .c-settings-list — otwórz panel wyboru kolumn i wywołaj ponownie.');
      return savpolPzSondaKopiuj();
    }
    log('Paneli widocznych: ' + panels.length);
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
    return savpolPzSondaKopiuj();
  };

  console.log('[sonda-pz-dom] Gotowe. Kolejność: savpolPzSondaLista() → otwórz dokument PZ → ' +
    'savpolPzSondaKarta() + savpolPzSondaSurowyWiersz() → (opcjonalnie) savpolPzSondaKolumny() ' +
    'na otwartym panelu kolumn → savpolPzSondaKopiuj().');
})();
