// Podsłuch sieciowy: łapie ten JEDEN request (fetch/XHR), którego odpowiedź
// zawiera dane konkretnego produktu — rozpoznawane po EAN.
// WERSJA: 2026-09-11.1
//
// Po co: generyczne nazwy endpointów tej aplikacji (OperatrionInvoke, getData,
// getDefinition) są używane do dziesiątek różnych rzeczy — ręczne klikanie po
// Network ciągle trafia w ten sam, często odpytywany request sesji/menu
// (csNGSessions), nie w dane produktu. Zamiast zgadywać po nazwie, ten skrypt
// podpina się pod fetch i XMLHttpRequest i sam filtruje po TREŚCI odpowiedzi.
//
// WAŻNE: wklej ten skrypt w konsolę PRZED odświeżeniem/otwarciem karty
// produktu — musi być podłączony, zanim leci właściwy request. Jeśli karta
// jest już otwarta, po prostu odśwież stronę (F5) PO wklejeniu skryptu.
//
// Jak używać:
//   1. Wklej ten plik w konsolę (na dowolnej stronie ERP, przed nawigacją).
//   2. Wejdź / odśwież kartę produktu.
//   3. W konsoli pojawi się log "[podsluch] ZŁAPANO" z URL-em requestu.
//      Treść trafia też do schowka automatycznie.
//   4. Wklej wynik do rozmowy.
//
// Domyślnie szuka EAN produktu 0000031 (5907779300001) — zmień SZUKANY_TEKST
// poniżej, jeśli chcesz podsłuchać inny produkt.

(function () {
  'use strict';

  const WERSJA = '2026-09-11.1';
  const SZUKANY_TEKST = '5907779300001'; // EAN — zmień na inny, jeśli trzeba

  function kopiuj(txt) {
    try {
      if (typeof copy === 'function') { copy(txt); return; }
    } catch (e) { /* dalej */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).catch(() => zapas(txt));
    } else {
      zapas(txt);
    }
    function zapas(t) {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* trudno */ }
      document.body.removeChild(ta);
    }
  }

  function zloap(url, body) {
    const linie = [];
    linie.push('Savpol ERP — podsłuch danych produktu, wersja ' + WERSJA);
    linie.push('Szukany tekst: ' + SZUKANY_TEKST);
    linie.push('URL: ' + url);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('');
    linie.push('--- TREŚĆ ODPOWIEDZI ---');
    linie.push(body);
    const txt = linie.join('\n');
    console.log('[podsluch ' + WERSJA + '] ZŁAPANO: ' + url + ' (' + body.length + ' znaków, skopiowano do schowka)');
    kopiuj(txt);
    window.__podsluchZlapany = txt;
  }

  // --- fetch ---
  const oryginalnyFetch = window.fetch;
  if (oryginalnyFetch) {
    window.fetch = function (...args) {
      const url = (args[0] && args[0].url) || args[0];
      return oryginalnyFetch.apply(this, args).then((resp) => {
        resp.clone().text().then((body) => {
          if (body && body.indexOf(SZUKANY_TEKST) >= 0) {
            zloap(String(url), body);
          }
        }).catch(() => {});
        return resp;
      });
    };
  }

  // --- XMLHttpRequest ---
  const oryginalnyOpen = XMLHttpRequest.prototype.open;
  const oryginalnySend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metoda, url, ...reszta) {
    this.__podsluchUrl = url;
    return oryginalnyOpen.call(this, metoda, url, ...reszta);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const body = this.responseText;
        if (body && body.indexOf(SZUKANY_TEKST) >= 0) {
          zloap(String(this.__podsluchUrl), body);
        }
      } catch (e) { /* nieczytelna odpowiedź (np. binarna) — pomijamy */ }
    });
    return oryginalnySend.apply(this, args);
  };

  console.log('[podsluch ' + WERSJA + '] gotowe — podpięto fetch i XMLHttpRequest. '
    + 'Teraz odśwież/otwórz kartę produktu. Szukam tekstu: "' + SZUKANY_TEKST + '"');
})();
