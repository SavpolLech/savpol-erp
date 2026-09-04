// ==UserScript==
// @name         Savpol ERP -> Eksport WZ (nagłówki + pozycje)
// @namespace    savpol-erp-tools
// @version      1.1.0
// @description  Na liście "Wydania zewnętrzne" (z ustawionymi filtrami) otwiera po kolei każdy WZ, czyta pozycje z karty dokumentu (WYMAGA dodanych kolumn csItemsId/csItemsUnitsId w ustawieniach siatki), łączy z danymi nagłówka z wiersza listy. Wynik (TSV, wybrane pola) do schowka jednym kliknięciem.
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-wz-eksport.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-wz-eksport.user.js
// @match        https://erp.savpol.pl/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[Savpol Eksport WZ]';
  const SCRIPT_VERSION = '1.1.0';
  console.log(LOG, 'Skrypt załadowany. URL:', location.href);

  // ---------- Konfiguracja ----------

  // Skrypt startuje TYLKO na liście wydań zewnętrznych. Filtry (daty, magazyn,
  // odbiorca) ustawia użytkownik ręcznie przed uruchomieniem — skrypt ich nie
  // dotyka, bierze to, co widzi na ekranie (tak samo jak Mapa produktów).
  const LIST_URL_FRAGMENT = 'erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';

  const BUTTON_ID = 'savpol-wz-export-btn';
  const BUTTON_TEXT = '📦 Eksportuj WZ';
  const PANEL_ID = 'savpol-wz-export-panel';

  const MAX_DOCS = 1000;                 // górny limit dokumentów w jednym przebiegu
  const MAX_PAGES = 100;                 // zabezpieczenie przed nieskończoną pętlą paginacji
  const MAX_CONSECUTIVE_FAILURES = 3;    // tyle nieudanych otwarć z rzędu kończy zbieranie

  // Typ dokumentu w komórce DocNumber to pierwszy pogrubiony fragment ("WZ").
  // Korekty wydań (jeśli ERP je tu miesza) mają inny kod i są POMIJANE
  // świadomie — mieszałyby ilości. Do włączenia trzeba świadomej decyzji,
  // czy korekta ma odejmować, czy liczyć się jako osobny wiersz.
  const DOC_TYPES = ['WZ'];

  // Pauzy. ERP renderuje siatki asynchronicznie; bez zapasu po otwarciu karty
  // czytaliśmy pustą lub połowicznie wyrenderowaną siatkę pozycji.
  const DELAY_AFTER_OPEN = 300;
  const DELAY_AFTER_CLOSE = 300;
  const DELAY_AFTER_PAGE = 400;

  // ---------- Dziennik przebiegu ----------

  const DIAG = { lines: [], started: 0 };

  function diagReset() {
    DIAG.lines = [];
    DIAG.started = Date.now();
    diag('START', 'Eksport WZ, wersja skryptu ' + SCRIPT_VERSION);
    diag('START', 'URL: ' + location.href);
  }

  function diag(tag, message) {
    const t = DIAG.started ? ((Date.now() - DIAG.started) / 1000).toFixed(1) : '0.0';
    DIAG.lines.push('[' + t + 's] ' + tag + ': ' + message);
    if (tag === 'BŁĄD') console.error(LOG, message);
    else if (tag === 'UWAGA') console.warn(LOG, message);
    else console.log(LOG, message);
  }

  function diagReport() {
    return DIAG.lines.join('\n');
  }

  // ---------- Przerwanie ----------

  const ABORT = { requested: false };

  function requestAbort() {
    ABORT.requested = true;
    diag('UWAGA', 'Zażądano przerwania — kończę po bieżącym dokumencie.');
  }

  function throwIfAborted() {
    if (ABORT.requested) {
      const e = new Error('ABORTED');
      e.aborted = true;
      throw e;
    }
  }

  // ---------- Narzędzia ----------

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function waitFor(fn, tries = 40, interval = 250) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ERP podaje liczby po polsku ("1 580,21", ze spacją nierozdzielającą).
  function parsePl(raw) {
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[\s ]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function formatEta(msLeft) {
    const sec = Math.round(msLeft / 1000);
    if (sec < 60) return '~' + sec + ' s';
    const min = Math.round(sec / 60);
    if (min < 60) return '~' + min + ' min';
    const h = Math.floor(min / 60);
    return '~' + h + ' godz. ' + (min % 60) + ' min';
  }

  function formatElapsed(ms) {
    const sec = Math.round(ms / 1000);
    const min = Math.floor(sec / 60);
    return min > 0 ? min + ' min ' + (sec % 60) + ' s' : sec + ' s';
  }

  // ---------- Odczyt DOM ----------

  // Obie siatki (lista i pozycje dokumentu) siedzą w DOM jednocześnie, bo
  // zakładki ERP nie są niszczone przy przełączaniu — filtrujemy po
  // widoczności, żeby nie czytać zakładki, która jest w tle.
  function visibleGrids() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .filter(t => t.offsetParent !== null);
  }

  function getVisibleListGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }

  function getVisiblePositionsGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="ItemDesc"]')
      && t.querySelector('td[data-datafield="QuantityUnits"]')) || null;
  }

  function getVisibleToolbar() {
    return Array.from(document.querySelectorAll('#ToolBarPanel'))
      .find(t => t.offsetParent !== null) || null;
  }

  function cellTitle(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    return c ? (c.getAttribute('title') || '') : '';
  }

  function cellText(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    return c ? (c.textContent || '').trim().replace(/\s+/g, ' ') : '';
  }

  function cellBold(row, field) {
    const c = row.querySelector('td[data-datafield="' + field + '"]');
    if (!c) return [];
    return Array.from(c.querySelectorAll('.cs-style-text-bold')).map(b => (b.textContent || '').trim());
  }

  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }

  function rowDocType(row) {
    const bold = cellBold(row, 'DocNumber');
    return bold.length ? bold[0] : null;
  }

  function rowDocNumber(row) {
    return cellTitle(row, 'DocNumber') || null;
  }

  function targetRows() {
    return listRows().filter(r => DOC_TYPES.includes(rowDocType(r)));
  }

  // Nagłówek dokumentu bierzemy z wiersza listy — otwieranie karty jest tylko
  // po pozycje, więc nie ma sensu odpytywać jej drugi raz o te same dane.
  function extractHeader(row) {
    return {
      docNumber: cellTitle(row, 'DocNumber'),
      docNumberExt: cellTitle(row, 'DocNumberExt'),
      docDate: (cellTitle(row, 'DocDate') || '').split(' ')[0],
      warehouseCode: cellTitle(row, 'Warehouse'),
      warehouseName: cellTitle(row, 'WarehouseDesc_PL'),
      wzn: cellTitle(row, 'DocNumberExtAdd2'),
      headerId: cellTitle(row, 'csDocsHeadersId'),
      warehouseId: cellTitle(row, 'csWarehousesId')
    };
  }

  // WAŻNE: kolumny csItemsId/csItemsUnitsId nie są w tej siatce widoczne
  // domyślnie — trzeba je włączyć w ustawieniach siatki ERP (wybór kolumn)
  // ZANIM ten skrypt zacznie klikać, inaczej wyjdą puste.
  function extractPositions(header) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      const descCell = row.querySelector('td[data-datafield="ItemDesc"]');
      if (!descCell) return null;
      const skuEl = descCell.querySelector('.cs-style-text-bold');
      const sku = skuEl ? (skuEl.textContent || '').trim() : '';
      if (!sku) return null;
      // Kolumna "Warehouse" (kod skrócony) bywa dodana też na siatce pozycji —
      // gdy jest, jest wiarygodniejsza dla tej konkretnej pozycji niż kod
      // z wiersza listy, więc wygrywa, gdy jest obecna.
      const lineWarehouseCode = cellTitle(row, 'Warehouse');
      return Object.assign({}, header, {
        warehouseCode: lineWarehouseCode || header.warehouseCode,
        sku: sku,
        name: (descCell.getAttribute('title') || '').trim(),
        unit: cellTitle(row, 'Unit'),
        qty: parsePl(cellTitle(row, 'QuantityUnits')),
        unitPrice: parsePl(cellTitle(row, 'StockUnitPrice')),
        lineValue: parsePl(cellTitle(row, 'FStock')),
        csItemsId: cellTitle(row, 'csItemsId'),
        csItemsUnitsId: cellTitle(row, 'csItemsUnitsId')
      });
    }).filter(Boolean);
  }

  // ---------- Paginacja ----------
  // Pętlą steruje przycisk "next" i deduplikacja numerów dokumentów, nie
  // licznik pagera — licznik bywa niewiarygodny w trakcie przeładowania.

  function getVisiblePager() {
    return Array.from(document.querySelectorAll('.csDataPager'))
      .find(el => el.offsetParent !== null) || null;
  }

  function pagerHasNextPage(pager) {
    if (!pager) return false;
    const next = pager.querySelector('.NextPageButton');
    return !!next && !next.className.split(/\s+/).includes('inactive');
  }

  function pagerRecordCount(pager) {
    if (!pager) return null;
    const e = pager.querySelector('.ResultsCountValue');
    if (!e) return null;
    const raw = (e.value || e.textContent || '').replace(/\s/g, '');
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function pagerPageCount(pager) {
    if (!pager) return null;
    const e = pager.querySelector('.TotalPagesCount');
    if (!e) return null;
    const raw = (e.value || e.textContent || '').replace(/\s/g, '');
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function describePager(pager) {
    if (!pager) return '(brak widocznego pagera)';
    const val = sel => {
      const e = pager.querySelector(sel);
      return e ? (e.value || e.textContent || '').trim() : '?';
    };
    const next = pager.querySelector('.NextPageButton');
    return ['strona=' + val('.ActivePageNoInput'), 'stron=' + val('.TotalPagesCount'),
      'rekordów=' + val('.ResultsCountValue'),
      'nextClass="' + (next ? next.className : 'brak') + '"'].join(' | ');
  }

  async function goToNextPage(pager) {
    const pageNoBefore = pager.querySelector('.ActivePageNoInput');
    const beforeVal = pageNoBefore ? pageNoBefore.value : null;
    const beforeNum = parseInt((beforeVal || '').replace(/\s/g, ''), 10);

    const pageChanged = () => {
      const p = getVisiblePager();
      const inp = p && p.querySelector('.ActivePageNoInput');
      return inp && inp.value !== beforeVal;
    };

    const next = pager.querySelector('.NextPageButton');
    if (next) {
      next.click();
      if (await waitFor(pageChanged, 40, 250)) {
        await sleep(DELAY_AFTER_PAGE);
        return true;
      }
      diag('UWAGA', 'Klik w "następną stronę" nie zmienił numeru strony. Przed: ' +
        beforeVal + ' | po: ' + describePager(getVisiblePager()));
    } else {
      diag('UWAGA', 'Brak przycisku "następna strona" w widocznym pagerze.');
    }

    if (!isNaN(beforeNum)) {
      const p = getVisiblePager();
      const inp = p && p.querySelector('.ActivePageNoInput');
      if (inp) {
        diag('UWAGA', 'Próbuję wpisać numer strony ' + (beforeNum + 1) + ' wprost w pole.');
        inp.focus();
        inp.value = String(beforeNum + 1);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));

        const docsBefore = targetRows().map(rowDocNumber).join('|');
        const moved = await waitFor(() => {
          const now = targetRows().map(rowDocNumber).join('|');
          return now && now !== docsBefore;
        }, 40, 250);
        await sleep(DELAY_AFTER_PAGE);
        if (moved) {
          diag('INFO', 'Wpisanie numeru strony zadziałało.');
          return true;
        }
        diag('BŁĄD', 'Wpisanie numeru strony też nie ruszyło siatki.');
      }
    }

    const pagerNow = getVisiblePager();
    diag('BŁĄD', 'Paginacja stanęła. Stan pagera: ' + describePager(pagerNow));
    return false;
  }

  // ---------- Zbieranie ----------
  // Przerwanie jest MIĘKKIE: to, co zebrano do tej pory, i tak idzie do
  // wyniku, żeby wielominutowy przebieg nie przepadał przy błędzie.

  async function collectAll(ui) {
    const positions = [];
    const processedDocs = new Set();
    let consecutiveFailures = 0;
    let processed = 0;
    let pageNum = 1;

    let knownTotal = null;
    let maxRowsPerPage = 0;
    let trustedTotal = null;
    let estimatedTotal = null;

    function refreshTotal() {
      const pager = getVisiblePager();
      const rec = pagerRecordCount(pager);
      const pages = pagerPageCount(pager);
      maxRowsPerPage = Math.max(maxRowsPerPage, targetRows().length);

      if (rec && (!pages || pages <= 1 || rec > maxRowsPerPage)) {
        trustedTotal = Math.max(trustedTotal || 0, rec);
      }
      if (pages && pages > 1 && maxRowsPerPage) {
        estimatedTotal = pages * maxRowsPerPage;
      }

      const best = trustedTotal || estimatedTotal;
      if (best && best !== knownTotal) {
        knownTotal = best;
        ui.total(best);
      }
    }

    while (processed < MAX_DOCS && pageNum <= MAX_PAGES) {
      throwIfAborted();

      if (targetRows().length === 0) {
        await waitFor(() => targetRows().length > 0, 20, 300);
      }

      refreshTotal();

      const docsOnPage = targetRows()
        .map(rowDocNumber)
        .filter(doc => doc && !processedDocs.has(doc));

      ui.phase('Strona ' + pageNum + ': ' + docsOnPage.length + ' nowych WZ');
      diag('STRONA', 'Strona ' + pageNum + ': wierszy WZ ' + targetRows().length +
        ', nowych ' + docsOnPage.length + ', przetworzonych łącznie ' + processed +
        ', suma wg pagera ' + (knownTotal || '?') + ' | ' + describePager(getVisiblePager()));

      for (const targetDoc of docsOnPage) {
        throwIfAborted();
        if (processed >= MAX_DOCS) break;

        const row = targetRows().find(r => rowDocNumber(r) === targetDoc);
        if (!row) {
          diag('UWAGA', 'Nie znaleziono wiersza dla ' + targetDoc +
            ' (wierszy WZ w widocznej siatce: ' + targetRows().length + ')');
          continue;
        }

        processedDocs.add(targetDoc);
        const header = extractHeader(row);

        const btn = row.querySelector('td[data-datafield="DocNumber"] .csButtonAction');
        if (!btn) {
          diag('UWAGA', 'Brak przycisku akcji dla ' + targetDoc + ' (uprawnienia?)');
          continue;
        }

        btn.click();

        const grid = await waitFor(() => getVisiblePositionsGrid());
        if (!grid) {
          consecutiveFailures++;
          diag('BŁĄD', 'Nie udało się otworzyć WZ ' + targetDoc +
            ' (porażka ' + consecutiveFailures + ' z ' + MAX_CONSECUTIVE_FAILURES + ')');

          const stray = document.querySelector('li.k-state-active .csCloseButton_span');
          if (stray) stray.click();
          await waitFor(() => getVisibleListGrid());
          await sleep(DELAY_AFTER_CLOSE);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            diag('BŁĄD', consecutiveFailures + ' nieudanych otwarć z rzędu — przerywam na ' +
              processed + ' dokumentach. To NIE jest problem z paginacją.');
            return { positions, docs: processed, partial: true };
          }
          continue;
        }

        consecutiveFailures = 0;
        await sleep(DELAY_AFTER_OPEN);

        const rows = extractPositions(header);
        processed++;
        positions.push(...rows);

        ui.progress(processed, targetDoc + ': ' + rows.length + ' pozycji');

        const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
        if (closeBtn) closeBtn.click();
        await waitFor(() => getVisibleListGrid());
        await sleep(DELAY_AFTER_CLOSE);
      }

      if (processed >= MAX_DOCS) break;

      if (!getVisibleListGrid() || getVisiblePositionsGrid()) {
        const stray = document.querySelector('li.k-state-active .csCloseButton_span');
        if (stray) {
          diag('UWAGA', 'Przed zmianą strony domykam zakładkę, która przykryła listę.');
          stray.click();
          await waitFor(() => getVisibleListGrid());
          await sleep(DELAY_AFTER_CLOSE);
        }
      }

      const pager = getVisiblePager();
      if (!pagerHasNextPage(pager)) {
        diag('INFO', 'Pager mówi, że nie ma kolejnych stron, po ' + processed +
          ' dokumentach (suma wg pagera: ' + (knownTotal || '?') + '). ' + describePager(pager));
        ui.phase('Brak kolejnych stron.');
        break;
      }

      ui.phase('Przechodzę do strony ' + (pageNum + 1) + '...');
      if (!await goToNextPage(pager)) {
        diag('BŁĄD', 'Kończę na ' + processed + ' dokumentach z ' + (knownTotal || '?') +
          ' — nie udało się przejść na stronę ' + (pageNum + 1) + '. Przyczyna: PAGINACJA.');
        return { positions, docs: processed, partial: true };
      }
      pageNum++;
    }

    return { positions, docs: processed, partial: false };
  }

  // ---------- Eksport ----------

  // Kolumny dobrane pod konkretne pola z bazy, o które proszono (nazwa z BD ->
  // etykieta w arkuszu). Nie eksportujemy tu nic, co nie zostało wymienione —
  // reszta danych z wiersza listy (klient, status, pracownik...) jest
  // wyciągana w extractHeader, ale świadomie NIE trafia do TSV.
  const EXPORT_COLUMNS = [
    ['DocDate (Data wystawienia)', p => p.docDate],
    ['WarehouseDesc_PL (Magazyn)', p => p.warehouseName],
    ['Warehouse (magazyn, kod)', p => p.warehouseCode],
    ['csDocsHeadersId', p => p.headerId],
    ['DocNumber', p => p.docNumber],
    ['DocNumberExt', p => p.docNumberExt],
    ['DocNumberExtAdd2 (Nr WMS)', p => p.wzn],
    ['csWarehousesId', p => p.warehouseId],
    ['csItemsId', p => p.csItemsId],
    ['ItemDesc (nazwa produktu)', p => p.name],
    ['SKU', p => p.sku],
    ['Unit (Jm)', p => p.unit],
    ['csItemsUnitsId', p => p.csItemsUnitsId],
    ['QuantityUnits (ilość)', p => p.qty],
    ['StockUnitPrice (cena)', p => p.unitPrice],
    ['FStock (wartość pozycji)', p => p.lineValue]
  ];

  // Z wierszem nagłówka — arkusz, do którego to trafia, jest osobnym plikiem
  // roboczym, nie ma jeszcze własnych nagłówków (inaczej niż Mapa produktów).
  function buildTsv(positions) {
    const header = EXPORT_COLUMNS.map(c => c[0]).join('\t');
    const rows = positions.map(p => EXPORT_COLUMNS.map(c => String(c[1](p) ?? '')).join('\t'));
    return [header].concat(rows).join('\n');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // ---------- Panel postępu i wyniku ----------

  let panel = null;
  let panelKeepAlive = null;

  function createPanel() {
    removePanel();

    const box = document.createElement('div');
    box.id = PANEL_ID;
    box.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483000',
      'width:420px', 'max-width:94vw', 'max-height:82vh', 'box-sizing:border-box',
      'display:flex', 'flex-direction:column',
      'padding:14px 16px', 'background:#1f2933', 'color:#f5f7fa', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
    ].join(';');

    box.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="flex:1;font-size:13px">Eksport WZ</strong>',
      '  <button data-role="stop" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '    padding:2px 8px;border:0;border-radius:4px;background:#5a3a3a;color:#ffd9d4">Przerwij</button>',
      '  <span data-role="close" title="Zamknij panel" style="cursor:pointer;opacity:.6;padding:0 6px;font-size:16px;line-height:1">&times;</span>',
      '</div>',
      '<div data-role="phase" style="margin-bottom:6px;opacity:.85">Startuję...</div>',
      '<div style="height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden">',
      '  <div data-role="bar" style="height:100%;width:0%;background:#4c9aff;transition:width .2s"></div>',
      '</div>',
      '<div style="display:flex;margin-top:6px;font-size:12px;opacity:.75">',
      '  <span data-role="count" style="flex:1"></span>',
      '  <span data-role="time"></span>',
      '</div>',
      '<div data-role="detail" style="margin-top:8px;font-size:12px;opacity:.7;word-break:break-word"></div>',
      '<div data-role="resultbox" style="display:none;margin-top:10px;padding-top:10px;',
      '    border-top:1px solid rgba(255,255,255,.15);flex-direction:column;gap:8px"></div>'
    ].join('');

    document.body.appendChild(box);
    panel = box;

    panelKeepAlive = setInterval(() => {
      if (panel && !panel.isConnected) document.body.appendChild(panel);
    }, 1000);

    const el = r => box.querySelector('[data-role="' + r + '"]');
    el('close').addEventListener('click', () => { requestAbort(); removePanel(); });
    el('stop').addEventListener('click', () => {
      requestAbort();
      el('stop').disabled = true;
      el('stop').textContent = 'Przerywam...';
    });

    const started = Date.now();
    let totalCount = null;

    return {
      el: el,
      total(n) { totalCount = n && n > 0 ? n : null; },
      phase(text) { el('phase').textContent = text; },
      progress(done, detail) {
        const pct = totalCount ? Math.min(100, Math.round(done / totalCount * 100)) : 0;
        el('bar').style.width = pct + '%';
        el('count').textContent = totalCount ? (done + ' / ' + totalCount + ' WZ') : (done + ' WZ');
        const elapsed = Date.now() - started;
        if (totalCount && done > 0) {
          const etaMs = elapsed / done * (totalCount - done);
          el('time').textContent = formatEta(etaMs) + ' pozostało';
        } else {
          el('time').textContent = formatElapsed(elapsed);
        }
        if (detail) el('detail').textContent = detail;
      },
      done() {
        el('stop').style.display = 'none';
      }
    };
  }

  function removePanel() {
    if (panelKeepAlive) { clearInterval(panelKeepAlive); panelKeepAlive = null; }
    if (panel) { panel.remove(); panel = null; }
  }

  function renderResult(ui, result) {
    const rb = ui.el('resultbox');
    rb.style.display = 'flex';
    rb.innerHTML = [
      '<div>' + (result.partial ? '⚠️ Wynik CZĘŚCIOWY' : '✅ Gotowe') +
        ' — ' + result.docs + ' WZ, ' + result.positions.length + ' pozycji.</div>',
      '<button data-role="copy" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '  padding:6px 10px;border:0;border-radius:4px;background:#2f5233;color:#d7ffe0">',
      '  📋 Kopiuj TSV do schowka</button>',
      '<button data-role="diag" type="button" style="cursor:pointer;font:inherit;font-size:12px;',
      '  padding:6px 10px;border:0;border-radius:4px;background:#33445a;color:#dbe7ff">',
      '  📄 Kopiuj dziennik przebiegu</button>'
    ].join('');

    const copyBtn = rb.querySelector('[data-role="copy"]');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(buildTsv(result.positions));
      copyBtn.textContent = ok ? '✔ Skopiowano (' + result.positions.length + ' wierszy)' : '✘ Nie udało się';
      setTimeout(() => { copyBtn.textContent = '📋 Kopiuj TSV do schowka'; }, 2500);
    });

    const diagBtn = rb.querySelector('[data-role="diag"]');
    diagBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(diagReport());
      diagBtn.textContent = ok ? '✔ Dziennik w schowku (' + DIAG.lines.length + ' linii)' : '✘ Nie udało się';
      setTimeout(() => { diagBtn.textContent = '📄 Kopiuj dziennik przebiegu'; }, 2500);
    });
  }

  // ---------- Przebieg ----------

  async function run() {
    diagReset();
    const ui = createPanel();
    try {
      const result = await collectAll(ui);
      ui.done();
      ui.phase(result.partial ? 'Zakończono (częściowo).' : 'Zakończono.');
      renderResult(ui, result);
      diag('KONIEC', result.docs + ' WZ, ' + result.positions.length + ' pozycji, partial=' + result.partial);
    } catch (e) {
      if (e && e.aborted) {
        diag('PRZERWANO', 'Przebieg przerwany przez użytkownika.');
        ui.done();
        ui.phase('Przerwano.');
      } else {
        diag('BŁĄD', 'Nieobsłużony wyjątek: ' + (e && e.stack || e));
        ui.done();
        ui.phase('Błąd — patrz dziennik.');
      }
    }
  }

  // ---------- Wstrzyknięcie przycisku ----------

  function insertButtonIfNeeded() {
    if (!location.href.includes(LIST_URL_FRAGMENT)) return;
    const toolbar = getVisibleToolbar();
    if (!toolbar) return;
    if (toolbar.querySelector('#' + BUTTON_ID)) return;

    const btn = document.createElement('div');
    btn.id = BUTTON_ID;
    btn.className = 'csButton _csControl csButtonAction csAutogenerateButton UnderlinedButton icon-left';
    btn.style.cursor = 'pointer';
    btn.innerHTML = '<div class="caption" title="Ustaw filtry listy, potem kliknij. ' +
      'Skrypt otworzy po kolei każdy WZ i zbierze nagłówki + pozycje.">' + BUTTON_TEXT + '</div>';
    btn.addEventListener('click', () => {
      if (document.getElementById(PANEL_ID)) {
        console.log(LOG, 'Przebieg już trwa albo panel jest otwarty.');
        return;
      }
      run();
    });
    toolbar.appendChild(btn);
    console.log(LOG, 'Przycisk wstrzyknięty do toolbara.');
  }

  const observer = new MutationObserver(() => insertButtonIfNeeded());
  observer.observe(document.body, { childList: true, subtree: true });
  insertButtonIfNeeded();
})();
