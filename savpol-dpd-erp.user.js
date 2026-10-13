// ==UserScript==
// @name         Savpol ERP → DPD Kurier
// @namespace    https://github.com/savpol
// @version      2.0.1
// @description  Dodaje przycisk "Zamów kuriera" w widoku zamówienia (zakładka Adresy). Zbiera dane odbiorcy i otwiera DPD z autofill.
// @author       Savpol
// @match        https://erp.savpol.pl/*
// @grant        GM_openInTab
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-dpd-erp.user.js
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-dpd-erp.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true;
  const log = (...args) => { if (DEBUG) console.log('[Savpol DPD]', ...args); };

  log('🚀 Skrypt załadowany. URL:', window.location.href);

  const BUTTON_ID = 'savpol-dpd-btn';
  const CHECK_INTERVAL = 2000;

  // --- Selektory ERP (Certusoft) ---
  // Prefiks: wszystkie dane z wiersza "Do wysyłki" w tabeli adresów
  const ROW = 'td[data-datafield="addresType"][title="Do wysyłki"] ~ ';

  const SEL = {
    // Zakładka Adresy musi być aktywna
    adresyTab: 'li.csTabListItemHeaderContainer.csTabItemActive[title="Adresy"]',

    // Wszystko z wiersza "Do wysyłki"
    imie:        ROW + 'td[data-datafield="Name"]',
    nazwisko:    ROW + 'td[data-datafield="Surname"]',
    telefon:     ROW + 'td[data-datafield="Phone"]',
    email:       ROW + 'td[data-datafield="EMail"]',
    miasto:      ROW + 'td[data-datafield="City"]',
    kodPocztowy: ROW + 'td[data-datafield="PostalCode"]',
    ulica:       ROW + 'td[data-datafield="Street"]',
    nrDomu:      ROW + 'td[data-datafield="HNo"]',
    nrLokalu:    ROW + 'td[data-datafield="LNo"]',
    firma:       ROW + 'td[data-datafield="CustomerDesc"]',

    // Waga zagregowana (poza tabelą adresów)
    waga:        '.csAggregateFunctionResultContainer[data-caption="Waga"]',
  };

  function getVal(selector) {
    // SPA: wiele pasujących elementów w DOM — bierz widoczny
    const all = document.querySelectorAll(selector);
    for (const el of all) {
      if (el.offsetParent !== null || el.offsetWidth > 0) {
        return (el.value || el.textContent || el.getAttribute('title') || '').trim();
      }
    }
    return '';
  }

  function getDocNumber() {
    // Parsuj z URL: "2026-zoid-gls1-004565" → "2026/ZOID/GLS1/004565"
    const match = window.location.pathname.match(/\/(\d{4}-[a-z]+-[a-z0-9]+-\d+)\//i);
    if (match) {
      return match[1].split('-').map(s => s.toUpperCase()).join('/');
    }
    // Fallback: szukamy w DOM
    const domMatch = document.body.innerText.match(/(\d{4}\/ZOID\/[A-Z0-9]+\/\d+)/);
    return domMatch ? domMatch[1] : '';
  }

  function scrapeAndSend() {
    const waga = getVal(SEL.waga).replace(',', '.'); // 0,84 → 0.84
    const nrDomu = getVal(SEL.nrDomu);
    const nrLokalu = getVal(SEL.nrLokalu);
    const numer = nrLokalu ? nrDomu + '/' + nrLokalu : nrDomu;

    const data = {
      firma:        getVal(SEL.firma),
      imieNazwisko: (getVal(SEL.imie) + ' ' + getVal(SEL.nazwisko)).trim(),
      ulica:        (getVal(SEL.ulica) + ' ' + numer).trim(),
      kodPocztowy:  getVal(SEL.kodPocztowy),
      miasto:       getVal(SEL.miasto),
      telefon:      getVal(SEL.telefon),
      email:        getVal(SEL.email),
      waga:         waga,
      nrZamowienia: getDocNumber(),
      timestamp:    Date.now(),
    };

    // Walidacja — minimum adres i nazwa
    const missing = [];
    if (!data.imieNazwisko) missing.push('Imię/Nazwisko');
    if (!data.ulica)        missing.push('Ulica');
    if (!data.kodPocztowy)  missing.push('Kod pocztowy');
    if (!data.miasto)       missing.push('Miasto');

    if (missing.length > 0) {
      alert('⚠️ Brakuje danych:\n' + missing.join('\n') + '\n\nSprawdź czy zakładka Adresy jest otwarta i czy jest wiersz "Do wysyłki".');
      return;
    }

    // Dane przekazywane przez URL hash — GM storage nie potrzebny

    // Pokaż podsumowanie
    const ok = confirm(
      '📦 Dane do wysyłki:\n\n' +
      (data.firma ? data.firma + '\n' : '') +
      data.imieNazwisko + '\n' +
      data.ulica + '\n' +
      data.kodPocztowy + ' ' + data.miasto + '\n' +
      'Tel: ' + data.telefon + '\n' +
      'Email: ' + data.email + '\n' +
      'Waga: ' + data.waga + ' kg\n' +
      'Zamówienie: ' + data.nrZamowienia + '\n\n' +
      'Otworzyć formularz DPD?'
    );

    if (ok) {
      const encoded = encodeURIComponent(JSON.stringify(data));
      GM_openInTab('https://online.dpd.com.pl/shipment/editPackagePrepare.do?serial=false#savpol=' + encoded, { active: true });
    }
  }

  function isOrderView() {
    const match = window.location.href.includes('csdocsheaders_salesordersro');
    log('isOrderView:', match, '| URL:', window.location.href);
    return match;
  }

  function injectButton() {
    if (!isOrderView()) return;

    // SPA: szukaj WIDOCZNEGO taba Adresy (aktywnego)
    let adresyActive = false;
    const adresyTabs = document.querySelectorAll(SEL.adresyTab);
    for (const tab of adresyTabs) {
      if (tab.offsetParent !== null || tab.offsetWidth > 0) {
        adresyActive = true;
        break;
      }
    }

    // Znajdź toolbar, który jest WIDOCZNY
    const toolbars = document.querySelectorAll('#ToolBarPanel');
    let toolbar = null;
    for (const tb of toolbars) {
      if (tb.offsetParent !== null || tb.offsetWidth > 0) {
        toolbar = tb;
        break;
      }
    }

    // Usuń wszystkie stare buttony
    document.querySelectorAll('#' + BUTTON_ID).forEach(el => el.remove());

    // Sprawdź czy widoczny wiersz "Do wysyłki" istnieje
    let hasDoWysylki = false;
    const rows = document.querySelectorAll('td[data-datafield="addresType"][title="Do wysyłki"]');
    for (const r of rows) {
      if (r.offsetParent !== null || r.offsetWidth > 0) {
        hasDoWysylki = true;
        break;
      }
    }

    if (adresyActive && toolbar && hasDoWysylki) {
      const wrapper = document.createElement('div');
      wrapper.className = 'csButton _csControl csButtonAction UnderlinedButton cs-inited icon-left';
      wrapper.id = BUTTON_ID;
      wrapper.style.cssText = 'cursor: pointer; margin-left: 8px;';

      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.title = 'Zamów kuriera DPD';
      caption.textContent = '📦 Kurier DPD';
      wrapper.appendChild(caption);

      wrapper.addEventListener('click', scrapeAndSend);
      toolbar.appendChild(wrapper);
      log('✅ Button dodany do widocznego toolbara');
    }
  }

  // Sprawdzaj cyklicznie — ERP to SPA, DOM się zmienia
  setInterval(injectButton, CHECK_INTERVAL);
})();
