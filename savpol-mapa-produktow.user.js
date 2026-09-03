// ==UserScript==
// @name         Savpol ERP -> Mapa produktów (waga per grupa klientów)
// @namespace    savpol-erp-tools
// @version      1.1.0
// @description  Przechodzi przefiltrowaną listę dokumentów sprzedaży, otwiera każdą fakturę, zbiera SKU/ilości/netto i buduje listę produktów posortowaną po wadze (częstotliwość x obrót), z medianą i P90 sprzedaży. Wynik do schowka jednym klikiem.
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-mapa-produktow.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-mapa-produktow.user.js
// @match        https://erp.savpol.pl/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[Savpol Mapa Produktów]';
  console.log(LOG, 'Skrypt załadowany. URL:', location.href);

  // ---------- Konfiguracja ----------

  // Skrypt startuje TYLKO na liście dokumentów sprzedaży. Filtry (daty,
  // kontrahenci) ustawia użytkownik ręcznie przed uruchomieniem — skrypt ich
  // nie dotyka, bo cały sens narzędzia to „policz to, co widzę na ekranie".
  const LIST_URL_FRAGMENT = 'erp.savpol.pl/pl/dokumenty-sprzedazy/csdocsheaders4sales';

  const BUTTON_ID = 'savpol-product-map-btn';
  const BUTTON_TEXT = '📊 Mapa produktów';
  const PANEL_ID = 'savpol-product-map-panel';

  const MAX_INVOICES = 500;              // górny limit faktur w jednym przebiegu
  const MAX_PAGES = 60;                  // zabezpieczenie przed nieskończoną pętlą paginacji
  const MAX_CONSECUTIVE_FAILURES = 3;    // tyle nieudanych otwarć z rzędu kończy zbieranie

  // Typy dokumentów brane do analizy. Korekty (FK) są POMIJANE świadomie:
  // mają ujemne ilości i wykrzywiłyby wagę produktu, którego korekta dotyczy.
  // Zanim się je włączy, trzeba zdecydować, czy odejmują od obrotu, czy liczą
  // się jako osobne wystąpienie produktu.
  const DOC_TYPES = ['FA'];

  // Waga produktu to średnia geometryczna dwóch znormalizowanych składników:
  //   penetracja = na ilu procentach faktur produkt wystąpił
  //   obrót      = suma netto produktu / suma netto największego produktu
  // Iloczyn (a nie suma) jest tu celowy: produkt częsty ale groszowy oraz
  // produkt drogi ale kupiony raz mają OBA dostać niską wagę. Suma dałaby im
  // połowę punktów, iloczyn — prawie zero. Wykładniki przesuwają akcent:
  // podnieś `penetration`, jeśli ważniejsza jest powtarzalność niż pieniądze.
  const WEIGHTS = {
    penetration: 1,
    revenue: 1
  };

  // Próg wagi dla schowka. Panel pokazuje WSZYSTKO (żeby było widać, co
  // wypadło i jak blisko progu), ale do arkusza idzie tylko to, co przekroczyło
  // próg — arkusz ma być listą zakupową grupy, nie pełnym spisem magazynu.
  const COPY_MIN_WEIGHT = 15;

  // Pauzy. ERP renderuje siatki asynchronicznie; bez zapasu po otwarciu
  // zakładki czytaliśmy pustą lub połowicznie wyrenderowaną siatkę.
  const DELAY_AFTER_OPEN = 300;
  const DELAY_AFTER_CLOSE = 300;
  const DELAY_AFTER_PAGE = 400;

  // ---------- Przerwanie ----------

  const ABORT = { requested: false };

  function requestAbort() {
    ABORT.requested = true;
    console.warn(LOG, 'Zażądano przerwania — kończę po bieżącej fakturze.');
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

  // ERP podaje liczby po polsku („1 580,21", ze spacją nierozdzielającą).
  function parsePl(raw) {
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[\s ]/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function formatPl(n, decimals = 2) {
    return n.toFixed(decimals).replace('.', ',');
  }

  // Percentyl z interpolacją liniową (metoda „inclusive", ta sama co
  // PERCENTYL/PERCENTILE w arkuszach) — wyniki będą się zgadzać, jeśli
  // policzysz je potem w Excelu z surowych danych.
  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
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

  // KLUCZOWE: obie siatki (lista i pozycje faktury) siedzą w DOM jednocześnie,
  // bo zakładki ERP nie są niszczone przy przełączaniu. Wybór po samym
  // istnieniu selektora czytałby pozycje z poprzedniej, ukrytej zakładki,
  // więc każda siatka musi być filtrowana po widoczności.
  function visibleGrids() {
    return Array.from(document.querySelectorAll('.cs-grid-data-table'))
      .filter(t => t.offsetParent !== null);
  }

  function getVisibleListGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }

  function getVisiblePositionsGrid() {
    return visibleGrids().find(t => t.querySelector('td[data-datafield="PositionItemDesc"]')
      && !t.querySelector('td[data-datafield="DocNumber"]')) || null;
  }

  function getVisibleToolbar() {
    return Array.from(document.querySelectorAll('#ToolBarPanel'))
      .find(t => t.offsetParent !== null) || null;
  }

  function listRows() {
    const grid = getVisibleListGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row'));
  }

  // Typ dokumentu nie jest osobną kolumną — siedzi jako pierwszy pogrubiony
  // div w komórce DocNumber („FA", obok napisu „Faktura sprzedaży").
  function rowDocType(row) {
    const cell = row.querySelector('td[data-datafield="DocNumber"]');
    if (!cell) return null;
    const bold = cell.querySelector('.cs-style-text-bold');
    if (!bold) return null;
    const txt = (bold.textContent || '').trim();
    return /^[A-Z]{2,4}$/.test(txt) ? txt : null;
  }

  function rowDocNumber(row) {
    const cell = row.querySelector('td[data-datafield="DocNumber"]');
    return cell ? cell.getAttribute('title') : null;
  }

  function targetRows() {
    return listRows().filter(r => DOC_TYPES.includes(rowDocType(r)));
  }

  function getActiveTabDocNumber() {
    const el = document.querySelector('li.k-state-active .k-link[title]');
    if (!el) return null;
    const title = el.getAttribute('title') || '';
    const idx = title.indexOf(':');
    return idx >= 0 ? title.slice(idx + 1).trim() : title.trim();
  }

  // SKU nie ma własnej kolumny. Nazwa i SKU dzielą komórkę PositionItemDesc:
  // nazwa to zwykły div (i tylko ona trafia do atrybutu title, przez co jest
  // NIEUCIĘTA — dlatego bierzemy ją stąd, a nie z textContent), SKU to div
  // pogrubiony poniżej.
  function extractPositions(docNumber) {
    const grid = getVisiblePositionsGrid();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('tr.cs-grid-data-row')).map(row => {
      const descCell = row.querySelector('td[data-datafield="PositionItemDesc"]');
      if (!descCell) return null;
      const skuEl = descCell.querySelector('.cs-style-text-bold');
      const sku = skuEl ? (skuEl.textContent || '').trim() : '';
      if (!sku) return null;
      const title = f => {
        const c = row.querySelector('td[data-datafield="' + f + '"]');
        return c ? (c.getAttribute('title') || '') : '';
      };
      return {
        doc: docNumber,
        sku: sku,
        name: descCell.getAttribute('title') || '',
        unit: title('Unit'),
        qty: parsePl(title('QuantityUnits')),
        net: parsePl(title('CNAmount'))
      };
    }).filter(Boolean);
  }

  // ---------- Paginacja ----------
  // Liczniki pagera w ERP potrafią kłamać w trakcie przeładowania, dlatego
  // pętla opiera się na stanie przycisku „next" i na deduplikacji numerów
  // dokumentów, a nie na „.ResultsCountValue". Licznik rekordów służy WYŁĄCZNIE
  // do paska postępu i szacowania czasu — pomyłka tam nic nie psuje.

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
    const inputBefore = pager.querySelector('.ActivePageNoInput');
    const beforeVal = inputBefore ? inputBefore.value : null;
    const next = pager.querySelector('.NextPageButton');
    if (!next) return false;
    next.click();
    const changed = await waitFor(() => {
      const p = getVisiblePager();
      const inp = p && p.querySelector('.ActivePageNoInput');
      return inp && inp.value !== beforeVal;
    }, 40, 250);
    await sleep(DELAY_AFTER_PAGE);
    if (!changed) {
      console.warn(LOG, 'Numer strony nie zmienił się po kliknięciu. Przed:', beforeVal,
        '| po:', describePager(getVisiblePager()));
    }
    return !!changed;
  }

  // ---------- Zbieranie ----------
  // Przerwanie jest MIĘKKIE: to, co zebrano do tej pory, i tak idzie do wyniku,
  // żeby kilkuminutowy przebieg nie przepadał. Wynik częściowy jest oznaczany
  // w panelu, żeby nie wziąć go potem za pełny obraz.

  async function collectAll(ui) {
    const positions = [];
    const processedDocs = new Set();
    let consecutiveFailures = 0;
    let processed = 0;
    let pageNum = 1;

    const total = pagerRecordCount(getVisiblePager());
    ui.total(total);

    while (processed < MAX_INVOICES && pageNum <= MAX_PAGES) {
      throwIfAborted();

      // Pusta strona to najczęściej „siatka jeszcze się ładuje", nie „brak
      // faktur" — bez tej pauzy przebieg kończył się zerem, mimo że sekundę
      // później dane były na miejscu.
      if (targetRows().length === 0) {
        await waitFor(() => targetRows().length > 0, 20, 300);
      }

      const docsOnPage = targetRows()
        .map(rowDocNumber)
        .filter(doc => doc && !processedDocs.has(doc));

      ui.phase('Strona ' + pageNum + ': ' + docsOnPage.length + ' nowych faktur');

      for (const targetDoc of docsOnPage) {
        throwIfAborted();
        if (processed >= MAX_INVOICES) break;

        // Wiersz pobierany na nowo za każdym razem — siatka bywa
        // przerenderowana po zamknięciu zakładki, a stara referencja
        // wskazywałaby wtedy na element wyrzucony z DOM.
        const row = targetRows().find(r => rowDocNumber(r) === targetDoc);
        if (!row) {
          console.warn(LOG, 'Nie znaleziono wiersza dla', targetDoc);
          continue;
        }

        processedDocs.add(targetDoc);

        const btn = row.querySelector('td[data-datafield="DocNumber"] .csButtonAction');
        if (!btn) {
          // Brak przycisku akcji to zwykle kwestia uprawnień: dokument widać,
          // ale nie wolno go otworzyć.
          console.warn(LOG, 'Brak przycisku akcji dla', targetDoc);
          continue;
        }

        btn.click();

        const grid = await waitFor(() => getVisiblePositionsGrid());
        if (!grid) {
          consecutiveFailures++;
          console.error(LOG, 'Nie udało się otworzyć faktury', targetDoc,
            '(porażka ' + consecutiveFailures + ')');

          // ODZYSKIWANIE. Bez tego jedna nieudana faktura kładła cały przebieg:
          // otwarta zakładka przykrywała listę, więc każdy kolejny dokument
          // kończył się „nie znaleziono wiersza" i wynik był pusty.
          const stray = document.querySelector('li.k-state-active .csCloseButton_span');
          if (stray) stray.click();
          await waitFor(() => getVisibleListGrid());
          await sleep(DELAY_AFTER_CLOSE);

          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(LOG, consecutiveFailures, 'nieudanych otwarć z rzędu — przerywam.');
            return { positions, invoices: processed, partial: true };
          }
          continue;
        }

        consecutiveFailures = 0;
        await sleep(DELAY_AFTER_OPEN);

        const docNumber = getActiveTabDocNumber() || targetDoc;
        const rows = extractPositions(docNumber);
        processed++;
        positions.push(...rows);

        ui.progress(processed, docNumber + ': ' + rows.length + ' pozycji');

        const closeBtn = document.querySelector('li.k-state-active .csCloseButton_span');
        if (closeBtn) closeBtn.click();
        await waitFor(() => getVisibleListGrid());
        await sleep(DELAY_AFTER_CLOSE);
      }

      if (processed >= MAX_INVOICES) break;

      const pager = getVisiblePager();
      if (!pagerHasNextPage(pager)) {
        ui.phase('Brak kolejnych stron.');
        break;
      }

      ui.phase('Przechodzę do strony ' + (pageNum + 1) + '...');
      if (!await goToNextPage(pager)) {
        console.warn(LOG, 'Paginacja stanęła. Zebrano', processed, 'faktur. Pager:',
          describePager(getVisiblePager()));
        return { positions, invoices: processed, partial: true };
      }
      pageNum++;
    }

    return { positions, invoices: processed, partial: false };
  }

  // ---------- Agregacja i waga ----------

  function aggregate(positions, invoiceCount) {
    const bySku = new Map();

    for (const p of positions) {
      let e = bySku.get(p.sku);
      if (!e) {
        e = { sku: p.sku, name: p.name, units: new Set(), docs: new Set(),
          qty: 0, net: 0, lines: 0, nets: [] };
        bySku.set(p.sku, e);
      }
      // Nazwa może się różnić między fakturami (zmiana kartoteki w czasie) —
      // zostawiamy najdłuższą, bo krótsza bywa uciętą wersją tej samej.
      if (p.name && p.name.length > (e.name || '').length) e.name = p.name;
      if (p.unit) e.units.add(p.unit);
      e.docs.add(p.doc);
      e.qty += p.qty;
      e.net += p.net;
      e.lines++;
      // Próbka do mediany i P90: jedna obserwacja na WYSTĄPIENIE produktu na
      // fakturze, nieważona ilością. Odpowiada na „ile zwykle schodzi tego
      // produktu na jedno zamówienie", a nie „ile kilogramów łącznie".
      e.nets.push(p.net);
    }

    const items = Array.from(bySku.values());
    const maxNet = items.reduce((m, i) => Math.max(m, i.net), 0) || 1;
    const denom = WEIGHTS.penetration + WEIGHTS.revenue;

    for (const i of items) {
      i.invoices = i.docs.size;
      i.penetration = invoiceCount ? i.invoices / invoiceCount : 0;
      i.revenueShare = i.net / maxNet;
      // Ważona średnia geometryczna. Zero w którymkolwiek składniku daje zero —
      // i tak ma być, bo produkt bez obrotu albo bez powtarzalności nie jest
      // częścią „listy, którą bierze ta grupa klientów".
      i.weight = 100 * Math.pow(
        Math.pow(i.penetration, WEIGHTS.penetration) * Math.pow(i.revenueShare, WEIGHTS.revenue),
        1 / denom
      );
      i.unit = Array.from(i.units).join('/');

      const sorted = i.nets.slice().sort((a, b) => a - b);
      i.median = percentile(sorted, 0.5);
      i.p90 = percentile(sorted, 0.9);
    }

    items.sort((a, b) => b.weight - a.weight);
    items.forEach((i, idx) => { i.rank = idx + 1; });
    return items;
  }

  // ---------- Wynik do arkusza ----------

  // Kolumny idą do arkusza, więc liczby są formatowane po polsku (przecinek
  // dziesiętny), a separatorem jest TAB — Excel i Arkusze Google rozkładają
  // taki wklej na kolumny bez żadnego importu.
  //
  // SKU z apostrofem na początku, bo arkusz inaczej czyta „0007719" jako liczbę
  // i gubi wiodące zera, a bez nich numer nie pasuje do niczego w ERP.
  const CLIPBOARD_COLUMNS = [
    ['SKU', i => "'" + i.sku],
    ['Nazwa', i => i.name],
    ['Mediana', i => formatPl(i.median, 2)],
    ['P90', i => formatPl(i.p90, 2)]
  ];

  function copyItems(items) {
    return items.filter(i => i.weight > COPY_MIN_WEIGHT);
  }

  function buildTsv(items) {
    const lines = [CLIPBOARD_COLUMNS.map(c => c[0]).join('\t')];
    for (const i of copyItems(items)) {
      lines.push(CLIPBOARD_COLUMNS.map(c => String(c[1](i))).join('\t'));
    }
    return lines.join('\n');
  }

  // Zapis do schowka odpala się z kliknięcia użytkownika, dlatego
  // navigator.clipboard działa (bez gestu przeglądarka odrzuca zapis).
  // execCommand zostaje jako zapas.
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
      'width:420px', 'max-width:92vw', 'max-height:80vh', 'box-sizing:border-box',
      'display:flex', 'flex-direction:column',
      'padding:14px 16px', 'background:#1f2933', 'color:#f5f7fa', 'border-radius:8px',
      'box-shadow:0 6px 24px rgba(0,0,0,.35)',
      'font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif'
    ].join(';');

    box.innerHTML = [
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">',
      '  <strong style="flex:1;font-size:13px">Mapa produktów</strong>',
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
      '    border-top:1px solid rgba(255,255,255,.15);min-height:0;display:none;',
      '    flex-direction:column"></div>'
    ].join('');

    document.body.appendChild(box);
    panel = box;

    // Zakładki ERP potrafią przerenderować drzewo i wyrzucić panel z DOM —
    // wtedy przebieg trwa, ale użytkownik traci z oczu postęp. Ten sam węzeł
    // jest doczepiany ponownie, więc nasłuchy i treść wyniku zostają całe.
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
      // Liczba rekordów wg pagera. Może być null (pager zerowany na czas
      // ładowania) — wtedy pasek działa w trybie „nie wiem ile jeszcze".
      total(n) { totalCount = n && n > 0 ? n : null; },
      phase(text) { el('phase').textContent = text; },
      progress(done, detail) {
        const elapsed = Date.now() - started;
        if (totalCount) {
          const pct = Math.min(100, (done / totalCount) * 100);
          el('bar').style.width = pct + '%';
          el('count').textContent = done + ' z ' + totalCount + ' faktur';
          // Średnia z całego przebiegu, nie z ostatniej faktury — pojedyncza
          // wolna faktura nie ma wtedy rozhuśtać szacunku.
          const perItem = elapsed / done;
          el('time').textContent = done < totalCount
            ? formatEta(perItem * (totalCount - done)) + ' do końca'
            : formatElapsed(elapsed);
        } else {
          el('count').textContent = done + ' faktur';
          el('time').textContent = formatElapsed(elapsed);
        }
        if (detail) el('detail').textContent = detail;
      },
      finish(text, ok) {
        const stop = el('stop');
        if (stop) stop.remove();
        el('phase').textContent = text;
        el('bar').style.width = '100%';
        el('bar').style.background = ok ? '#36b37e' : '#ff5630';
        el('time').textContent = formatElapsed(Date.now() - started);
      }
    };
  }

  function removePanel() {
    if (panelKeepAlive) { clearInterval(panelKeepAlive); panelKeepAlive = null; }
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    panel = null;
  }

  function showResults(ui, items, meta) {
    const tsv = buildTsv(items);
    const totalNet = items.reduce((s, i) => s + i.net, 0);

    ui.finish(meta.partial
      ? 'Zatrzymane w trakcie — wynik częściowy'
      : 'Gotowe', !meta.partial);

    ui.el('detail').textContent = items.length + ' produktów z ' + meta.invoices +
      ' faktur, obrót netto ' + formatPl(totalNet, 2) + ' PLN. ' +
      'Do schowka idzie ' + copyItems(items).length + ' z wagą > ' + COPY_MIN_WEIGHT + '.' +
      (meta.partial ? ' Przebieg nie objął całej listy — potraktuj to jako próbkę.' : '');

    const copied = copyItems(items);

    // Wiersze pod progiem są wyszarzone, a nie ukryte: widać wtedy, co siedzi
    // tuż pod granicą, i można świadomie ruszyć COPY_MIN_WEIGHT zamiast się
    // domyślać, czy próg nie odciął czegoś ważnego.
    const rows = items.slice(0, 40).map(i =>
      '<tr style="' + (i.weight > COPY_MIN_WEIGHT ? '' : 'opacity:.4') + '">' +
      '<td style="padding:2px 4px;opacity:.5">' + i.rank + '</td>' +
      '<td style="padding:2px 4px;font-weight:600;white-space:nowrap">' + i.sku + '</td>' +
      '<td style="padding:2px 4px">' + i.name + '</td>' +
      '<td style="padding:2px 4px;text-align:right;font-weight:600">' + formatPl(i.weight, 1) + '</td>' +
      '<td style="padding:2px 4px;text-align:right">' + formatPl(i.median, 2) + '</td>' +
      '<td style="padding:2px 4px;text-align:right">' + formatPl(i.p90, 2) + '</td>' +
      '<td style="padding:2px 4px;text-align:right;opacity:.7">' + i.invoices + '</td>' +
      '</tr>').join('');

    const rb = ui.el('resultbox');
    rb.style.display = 'flex';
    rb.innerHTML = [
      '<button data-role="copy" type="button" style="width:100%;cursor:pointer;font:inherit;',
      '    font-size:12px;padding:7px 10px;border:0;border-radius:4px;background:#36b37e;',
      '    color:#04231a;font-weight:600">📋 Kopiuj do arkusza (', copied.length,
      ' z wagą &gt; ', COPY_MIN_WEIGHT, ')</button>',
      '<div style="margin-top:8px;overflow:auto;min-height:0">',
      '  <table style="border-collapse:collapse;font-size:11px;width:100%">',
      '    <thead><tr style="text-align:left;opacity:.6">',
      '      <th style="padding:2px 4px"></th><th style="padding:2px 4px">SKU</th>',
      '      <th style="padding:2px 4px">Nazwa</th>',
      '      <th style="padding:2px 4px;text-align:right">Waga</th>',
      '      <th style="padding:2px 4px;text-align:right">Med.</th>',
      '      <th style="padding:2px 4px;text-align:right">P90</th>',
      '      <th style="padding:2px 4px;text-align:right">Fkt</th>',
      '    </tr></thead><tbody>', rows, '</tbody></table>',
      items.length > 40 ? '<div style="opacity:.5;padding:4px">...pozostałe ' +
        (items.length - 40) + ' w schowku i w konsoli</div>' : '',
      '</div>'
    ].join('');

    const copyBtn = rb.querySelector('[data-role="copy"]');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(tsv);
      const label = copyBtn.textContent;
      copyBtn.textContent = ok ? '✔ Skopiowane — wklej do arkusza' : '✘ Nie udało się skopiować';
      setTimeout(() => { copyBtn.textContent = label; }, 2500);
    });

    console.log(LOG, 'Wynik:', items);
    console.log(LOG, 'TSV do arkusza:\n' + tsv);
  }

  async function run() {
    ABORT.requested = false;
    const ui = createPanel();

    try {
      const res = await collectAll(ui);
      const items = aggregate(res.positions, res.invoices);
      if (!items.length) {
        ui.finish('Nic nie zebrałem', false);
        ui.el('detail').textContent = 'Żadna faktura nie dała pozycji. Sprawdź, czy lista ' +
          'jest przefiltrowana i czy widać na niej dokumenty typu ' + DOC_TYPES.join('/') + '.';
        return;
      }
      showResults(ui, items, res);
    } catch (err) {
      if (err && err.aborted) {
        console.warn(LOG, 'Przebieg przerwany przez użytkownika.');
        if (panel) {
          ui.finish('Przerwane', false);
          ui.el('detail').textContent = 'Nic nie policzyłem — uruchom ponownie, ' +
            'żeby przejść listę od początku.';
        }
        return;
      }
      console.error(LOG, err);
      if (panel) {
        ui.finish('Błąd', false);
        ui.el('detail').textContent = (err && err.message ? err.message : String(err)) +
          ' — szczegóły w konsoli.';
      }
    }
  }

  // ---------- Wstrzyknięcie przycisku ----------

  // Przycisk siada w toolbarze listy, obok „Pokaż"/„Korekta", tak samo jak
  // „🧩 Zbuduj opis" w skrypcie katalogowym — klasy są ERP-owe, żeby wyglądał
  // jak część aplikacji, a nie naklejka.
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
      'Skrypt otworzy po kolei każdą fakturę i policzy wagi produktów.">' + BUTTON_TEXT + '</div>';
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

  // Zakładki ERP są tworzone i niszczone bez przeładowania strony, więc
  // jednorazowe wstrzyknięcie na starcie nie wystarcza — obserwator dokłada
  // przycisk za każdym razem, gdy lista wraca na wierzch.
  const observer = new MutationObserver(() => insertButtonIfNeeded());
  observer.observe(document.body, { childList: true, subtree: true });
  insertButtonIfNeeded();
})();
