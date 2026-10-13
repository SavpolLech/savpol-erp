// ==UserScript==
// @name         Savpol DPD Autofill
// @namespace    https://github.com/savpol
// @version      1.7.1
// @description  Automatycznie wypełnia formularz nadania przesyłki DPD danymi z ERP Savpol.
// @author       Savpol
// @match        https://online.dpd.com.pl/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-dpd-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-dpd-autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true;
  const log = (...args) => { if (DEBUG) console.log('[Savpol DPD]', ...args); };

  log('🚀 Skrypt DPD załadowany. URL:', window.location.href);

  // --- Selektory DPD ---
  const DPD = {
    // Odbiorca
    receiverCompany:    '#receiver-company__input',
    receiverName:       '#receiver-name__input',
    receiverStreet:     '#receiver-street__input',
    receiverPostalCode: '#receiver-postal-code__input',
    receiverCity:       '#receiver-city__input',
    receiverTelephone:  '#receiver-telephone__input',
    receiverEmail:      '#receiver-email__input',

    // Nadawca (stałe wartości Savpol)
    senderTelephone:    '#sender-telephone__input',
    senderEmail:        '#sender-email__input',

    // Przesyłka
    contents:           '#contents__input',
    ref1:               '#ref-1__input',

    // Paczka
    weight:             'input[formcontrolname="weight"]',
  };

  // Stałe nadawcy
  const SENDER = {
    telephone: '725250751',
    email:     'sklep@savpol.pl',
  };

  // Maksymalny czas oczekiwania na załadowanie formularza (ms)
  const MAX_WAIT = 15000;
  const POLL_INTERVAL = 500;

  /**
   * Ustawia wartość pola i triggeruje eventy,
   * żeby Angular/framework DPD zarejestrował zmianę
   */
  function setField(selector, value) {
    const el = document.querySelector(selector);
    if (!el || !value) return false;

    // Focus
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));

    // Ustaw wartość
    el.value = value;

    // Triggeruj eventy — Angular słucha na input i change
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Blur
    el.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
  }

  /**
   * Czeka na pojawienie się elementu w DOM
   */
  function waitForElement(selector, timeout) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) { resolve(el); return; }

      const start = Date.now();
      const interval = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          reject(new Error('Timeout: ' + selector));
        }
      }, POLL_INTERVAL);
    });
  }

  /**
   * Sprawdza czy formularz "Nowa przesyłka" jest otwarty
   * i czy DPD załadował swój klik na "Nowa"
   */
  function isNewPackageForm() {
    // Po kliknięciu "Nowa" powinien pojawić się formularz z polami odbiorcy
    return !!document.querySelector(DPD.receiverName);
  }

  /**
   * Główna funkcja autofill
   */
  async function autoFill() {
    log('▶ autoFill() start');

    // Pobierz dane z URL hash
    const hash = window.location.hash;
    log('URL hash:', hash ? hash.substring(0, 100) + '...' : 'EMPTY');

    if (!hash || !hash.includes('savpol=')) {
      log('❌ Brak danych w URL hash. Otwarcie ręczne lub dane nie zostały przekazane.');
      return;
    }

    let data;
    try {
      const encoded = hash.split('savpol=')[1];
      data = JSON.parse(decodeURIComponent(encoded));
      log('✅ Dane sparsowane:', data);
    } catch (e) {
      log('❌ Błąd parsowania danych z hash:', e);
      return;
    }

    const ageMinutes = Math.round((Date.now() - data.timestamp) / 60000);
    log('Wiek danych:', ageMinutes, 'min');
    if (ageMinutes > 30) {
      log('❌ Dane starsze niż 30 min — ignoruję.');
      return;
    }

    // Wyczyść hash z URL (żeby refresh nie wypełniał ponownie)
    history.replaceState(null, '', window.location.pathname + window.location.search);

    // Czekaj na formularz
    log('Czekam na formularz (receiverName)...');
    try {
      await waitForElement(DPD.receiverName, MAX_WAIT);
      log('✅ Formularz znaleziony');
    } catch (e) {
      log('❌ Timeout czekania na formularz:', e);
      return;
    }

    log('Czekam 1s na stabilizację Angulara...');
    await new Promise(r => setTimeout(r, 1000));

    // --- Wypełnij pola ---
    let filled = 0;
    let failed = [];

    // Odbiorca
    const fields = [
      // Odbiorca
      [DPD.receiverCompany,    data.firma,         'Firma'],
      [DPD.receiverName,       data.imieNazwisko,  'Imię i nazwisko'],
      [DPD.receiverStreet,     data.ulica,         'Ulica'],
      [DPD.receiverPostalCode, data.kodPocztowy,   'Kod pocztowy'],
      [DPD.receiverCity,       data.miasto,        'Miasto'],
      [DPD.receiverTelephone,  data.telefon,       'Telefon'],
      [DPD.receiverEmail,      data.email,         'E-mail'],
      // Nadawca — stałe
      [DPD.senderTelephone,    SENDER.telephone,   'Tel. nadawcy'],
      [DPD.senderEmail,        SENDER.email,       'Email nadawcy'],
      // Przesyłka
      [DPD.contents,           data.nrZamowienia,  'Zawartość'],
    ];

    if (data.waga) {
      log('📦 Waga przesyłki:', data.waga, 'kg — czekam na odblokowanie pola wagi...');
    }

    for (const [selector, value, label] of fields) {
      const el = document.querySelector(selector);
      const result = setField(selector, value);
      log(`  ${label}: selector=${selector} | found=${!!el} | value="${value}" | result=${result}`);
      if (result) {
        filled++;
      } else if (value) {
        failed.push(label);
      }
    }

    // Waga — wypełniana po reszcie, bo pole pojawia się dopiero gdy kody pocztowe są uzupełnione
    if (data.waga) {
      try {
        await waitForElement(DPD.weight, MAX_WAIT);
        await new Promise(r => setTimeout(r, 500)); // dodatkowa stabilizacja
        const weightResult = setField(DPD.weight, data.waga);
        log('  Waga: found=' + !!document.querySelector(DPD.weight) + ' | result=' + weightResult);
        if (weightResult) filled++;
        else failed.push('Waga');
      } catch (e) {
        log('❌ Timeout czekania na pole wagi:', e);
        failed.push('Waga (timeout)');
      }
    }

    // Nadpisz miasto z powrotem — DPD ustawia je automatycznie po kodzie pocztowym, często błędnie dla małych miejscowości
    if (data.miasto) {
      await new Promise(r => setTimeout(r, 300));
      setField(DPD.receiverCity, data.miasto);
      log('  Miasto (ponowne):', data.miasto);
    }

    // Hash już wyczyszczony wcześniej

    // Pokaż status
    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = `
      position: fixed;
      top: 10px;
      right: 20px;
      z-index: 99999;
      padding: 12px 20px;
      background: ${failed.length > 0 ? '#FFA500' : '#28a745'};
      color: white;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
    `;
    statusDiv.textContent = failed.length > 0
      ? `✅ Wypełniono ${filled} pól. ⚠️ Nie udało się: ${failed.join(', ')}`
      : `✅ Wypełniono ${filled} pól z zamówienia ${data.nrZamowienia}`;

    statusDiv.addEventListener('click', () => statusDiv.remove());
    document.body.appendChild(statusDiv);

    // Auto-ukryj po 10s
    setTimeout(() => { if (statusDiv.parentNode) statusDiv.remove(); }, 10000);

    console.log(`[Savpol DPD] Autofill done: ${filled} filled, ${failed.length} failed.`);
  }

  // --- Start ---
  log('readyState:', document.readyState);
  if (document.readyState === 'complete') {
    log('Strona załadowana — start autoFill za 1.5s');
    setTimeout(autoFill, 1500);
  } else {
    log('Czekam na load event...');
    window.addEventListener('load', () => {
      log('Load event — start autoFill za 1.5s');
      setTimeout(autoFill, 1500);
    });
  }
})();
