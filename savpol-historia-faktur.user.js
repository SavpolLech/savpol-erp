// ==UserScript==
// @name         Savpol ERP -> Historia faktur produktu (CSV)
// @namespace    savpol-erp-tools
// @version      1.4
// @description  Pobiera historię faktur (Wszystkie, od 1 stycznia) dla wybranego produktu i eksportuje do CSV
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[Savpol Historia Faktur] Skrypt załadowany. URL:', location.href);

  const TARGET_URL_FRAGMENT = 'erp.savpol.pl/pl/katalog/csitems/';
  const BUTTON_ID = 'savpol-invoice-history-btn';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fn, tries = 40, interval = 250) {
    for (let i = 0; i < tries; i++) {
      const val = fn();
      if (val) return val;
      await sleep(interval);
    }
    return null;
  }

  // ---------- Krok 0: otwórz "Historia produktu" ----------
  function openHistory() {
    const el = document.querySelector('[title="Historia produktu"]');
    if (el) { el.click(); return true; }
    return false;
  }

  // ---------- SKU głównego produktu (z inputa "Produkt" w filtrach) ----------
  function getMainProductSku() {
    const panels = Array.from(document.querySelectorAll('.cs-layout-search-panel'))
      .filter(el => el.offsetParent !== null);

    for (const panel of panels) {
      const input = panel.querySelector('input[placeholder="Produkt"]');
      if (input) {
        const sku = input.getAttribute('title') || input.value;
        if (sku) return sku.trim();
      }
    }
    return null;
  }

  // ---------- Krok 1: znajdź panel filtrów (odporne na duplikaty) ----------
  function findFilterPanel() {
    const panels = Array.from(document.querySelectorAll('.cs-layout-search-panel'))
      .filter(el => el.offsetParent !== null);

    for (const panel of panels) {
      const dateInput = panel.querySelector('input[placeholder="Od"]');
      const allLabel = Array.from(panel.querySelectorAll('.csDBRadioGroupItemLabel'))
        .find(l => l.textContent.trim() === 'Wszystkie');
      if (dateInput && allLabel) {
        return { panel, dateInput, allLabel };
      }
    }
    return null;
  }

  async function setFilters() {
    const found = await waitFor(findFilterPanel);
    if (!found) throw new Error('Nie znaleziono panelu z filtrami daty i radio.');

    const { dateInput, allLabel } = found;
    const dp = unsafeWindow.jQuery(dateInput).data('kendoDatePicker');
    if (!dp) throw new Error('Brak instancji kendoDatePicker.');

    const firstDayThisYear = new Date(new Date().getFullYear(), 0, 1);
    dp.value(firstDayThisYear);
    dp.trigger('change');
    unsafeWindow.jQuery(dateInput).trigger('blur');

    await sleep(300);
    allLabel.click();

    // Czekaj aż lista faktycznie się odświeży (zamiast sztywnego sleep)
    await waitFor(() => {
        const rows = Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
        .filter(row => row.offsetParent !== null);
        return rows.length > 0;
    }, 40, 300);
    await sleep(500); // dodatkowy zapas na pełne wyrenderowanie
  }

  // ---------- Krok 2: iteracja po fakturach FA ----------
  function visibleGridRows() {
    return Array.from(document.querySelectorAll('tr.cs-grid-data-row'))
      .filter(row => row.offsetParent !== null);
  }

  function getVisibleInvoiceGrid() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
    .find(t => t.offsetParent !== null
      && t.querySelectorAll('tr.cs-grid-data-row').length > 0
      && t.querySelector('td[data-datafield="Item"]')
      && t.querySelector('td[data-datafield="PositionItemDesc"]'));
  }

  function extractInvoiceRows(docNumber) {
    const grid = getVisibleInvoiceGrid();
    if (!grid) return [];
    const rows = Array.from(grid.querySelectorAll('tbody tr'));
    return rows.map(row => {
      const skuCell = row.querySelector('td[data-datafield="Item"]');
      const nameCell = row.querySelector('td[data-datafield="PositionItemDesc"]');
      const qtyCell = row.querySelector('td[data-datafield="QuantityUnits"]');
      if (!skuCell) return null;
      return {
        doc: docNumber,
        sku: skuCell.getAttribute('title') || '',
        product: nameCell ? nameCell.getAttribute('title') : '',
        qty: qtyCell ? qtyCell.getAttribute('title') : ''
      };
    }).filter(Boolean);
  }

  function getActiveTabDocNumber() {
    const el = document.querySelector('li.k-state-active .k-link[title]');
    if (!el) return null;
    const title = el.getAttribute('title');
    const idx = title.indexOf(':');
    return idx >= 0 ? title.slice(idx + 1).trim() : title.trim();
  }

  function getFaRows() {
    return visibleGridRows().filter(row => {
      const cell = row.querySelector('td[data-datafield="DocType"]');
      return cell && cell.getAttribute('title') === 'FA';
    });
  }

  async function collectAllInvoices(maxCount, onProgress) {
    const results = [];
    const initialFaRows = getFaRows();
    const total = Math.min(initialFaRows.length, maxCount);
    if (onProgress) onProgress(`Znaleziono ${initialFaRows.length} faktur FA. Przetwarzam ${total}...`);

    for (let i = 0; i < total; i++) {
      const currentRows = getFaRows();
      const row = currentRows[i];
      if (!row) { console.warn('Brak wiersza o indeksie', i); continue; }

      const docNumberCell = row.querySelector('td[data-datafield="DocNumber"]');
      const listDocNumber = docNumberCell ? docNumberCell.getAttribute('title') : `unknown_${i}`;
      const btn = docNumberCell.querySelector('.csButtonAction');
      if (!btn) { console.warn('Brak przycisku dla', listDocNumber); continue; }

      btn.click();

      const grid = await waitFor(() => getVisibleInvoiceGrid());
      if (!grid) {
        console.error('Nie udało się otworzyć faktury:', listDocNumber);
        continue;
      }
      await sleep(300);

      const docNumber = getActiveTabDocNumber() || listDocNumber;
      const invoiceRows = extractInvoiceRows(docNumber);
      if (onProgress) onProgress(`[${i + 1}/${total}] ${docNumber}: ${invoiceRows.length} pozycji`);
      results.push(...invoiceRows);

      const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (closeBtn) closeBtn.click();

      await waitFor(() => visibleGridRows().length > 0);
      await sleep(300);
    }

    return results;
  }

  // ---------- Krok 3: CSV ----------
  function downloadCSV(data, mainSku) {
    const header = 'Numer dokumentu;Produkt;SKU;Ilość\n';
    const body = data.map(r =>
      `"${r.doc}";"${r.product}";"${r.sku}";"${r.qty}"`
    ).join('\n');
    const csv = header + body;

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historia_faktur_${mainSku || 'produkt'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Główny pipeline ----------
  async function runFullPipeline(button) {
    const originalText = button.textContent;
    try {
      button.textContent = 'Otwieram historię...';
      const opened = openHistory();
      if (!opened) throw new Error('Nie znaleziono przycisku "Historia produktu". Czy produkt jest zaznaczony?');
      await sleep(500);

      const mainSku = await waitFor(getMainProductSku);

      button.textContent = 'Ustawiam filtry...';
      await setFilters();

      button.textContent = 'Pobieram faktury...';
      const data = await collectAllInvoices(20, (msg) => {
        button.textContent = msg;
        console.log(msg);
      });

      button.textContent = `Gotowe: ${data.length} pozycji. Zapisuję CSV...`;
      downloadCSV(data, mainSku);

      // Zamknij zakładkę zestawienia
      const summaryCloseBtn = document.querySelector('li.k-state-active .csCloseButton_span');
      if (summaryCloseBtn) {
        await sleep(300);
        summaryCloseBtn.click();
      }

      button.textContent = originalText;
    } catch (err) {
      console.error('[Savpol Historia Faktur] Błąd:', err);
      button.textContent = 'Błąd — zobacz konsolę';
      setTimeout(() => { button.textContent = originalText; }, 3000);
    }
  }

  // ---------- Wstrzyknięcie przycisku ----------
  function getVisibleToolbar() {
    return Array.from(document.querySelectorAll('#ToolBarPanel'))
      .find(t => t.offsetParent !== null);
  }

  function insertButtonIfNeeded() {
    if (!location.href.includes(TARGET_URL_FRAGMENT)) return;

    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + BUTTON_ID)) return;

    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="caption" title="Pobierz historię faktur">Pobierz historię faktur</div>';
    btn.addEventListener('click', () => runFullPipeline(btn));

    toolbar.appendChild(btn);
  }

  setInterval(insertButtonIfNeeded, 1000);
})();