// Podsłuch sieciowy: loguje WSZYSTKIE requesty fetch/XHR (URL + treść żądania
// + rozmiar/początek odpowiedzi), plus próbuje automatycznie rozpoznać ten,
// który zawiera dane konkretnego produktu (po EAN).
// WERSJA: 2026-09-11.2
//            Konsola wypisuje ją po wklejeniu — jeśli tam widzisz inny numer,
//            w przeglądarce siedzi starsza kopia.
//
// Po co: automatyczne dopasowanie po treści (v1) nie złapało nic — albo dane
// wracają skompresowane (jak `definition` w getDefinition), albo aplikacja
// nie robi nowego requestu przy zamknięciu/otwarciu zakładki (cache w
// przeglądarce). Zamiast dalej zgadywać, ta wersja loguje KOMPLETNĄ listę
// requestów — przeglądamy ją razem, zamiast polegać na automatycznym
// dopasowaniu.
//
// WAŻNE: wklej ten skrypt PRZED akcją, którą chcemy podsłuchać (nie odświeżaj
// całej strony po wklejeniu — to kasuje podpięcie). Potem wykonaj w ERP to,
// co ma wywołać pobranie danych (zamknij/otwórz kartę, zmień zakładkę itp.).
//
// Jak używać:
//   1. Wklej ten plik w konsolę.
//   2. Wykonaj w ERP akcję, którą chcemy podsłuchać.
//   3. Wywołaj: savpolPodsluchZrzut()  → cała lista requestów do schowka.
//   4. Jeśli coś złapało się automatycznie po EAN, zobaczysz dodatkowo log
//      "[podsluch] ZŁAPANO PO TREŚCI".

(function () {
  'use strict';

  const WERSJA = '2026-09-11.2';
  const SZUKANY_TEKST = '5907779300001'; // EAN — zmień na inny, jeśli trzeba
  const MAX_PODGLAD = 400; // ile znaków treści żądania/odpowiedzi zachować

  const zarejestrowane = [];

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

  function dodajWpis(wpis) {
    zarejestrowane.push(wpis);
    if (wpis.odpowiedz && wpis.odpowiedz.indexOf(SZUKANY_TEKST) >= 0) {
      console.log('[podsluch ' + WERSJA + '] ZŁAPANO PO TREŚCI: ' + wpis.url);
    }
  }

  window.savpolPodsluchZrzut = function () {
    const linie = [];
    linie.push('Savpol ERP — podsłuch requestów, wersja ' + WERSJA);
    linie.push('Szukany tekst (EAN): ' + SZUKANY_TEKST);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('Razem zarejestrowanych requestów: ' + zarejestrowane.length);
    linie.push('');
    zarejestrowane.forEach((w, i) => {
      const pasuje = w.odpowiedz && w.odpowiedz.indexOf(SZUKANY_TEKST) >= 0;
      linie.push((i + 1) + '. ' + (pasuje ? '*** PASUJE PO TREŚCI *** ' : '') + w.url);
      linie.push('   metoda: ' + w.metoda);
      if (w.zadanie) linie.push('   żądanie (początek): ' + w.zadanie.slice(0, MAX_PODGLAD).replace(/\s+/g, ' '));
      linie.push('   odpowiedź: ' + (w.odpowiedz ? w.odpowiedz.length + ' znaków, początek: ' + w.odpowiedz.slice(0, MAX_PODGLAD).replace(/\s+/g, ' ') : '(brak / nieczytelna)'));
      linie.push('');
    });
    const txt = linie.join('\n');
    kopiuj(txt);
    console.log('[podsluch ' + WERSJA + '] skopiowano ' + zarejestrowane.length + ' requestów do schowka (' + txt.length + ' znaków)');
    return txt;
  };

  // --- fetch ---
  const oryginalnyFetch = window.fetch;
  if (oryginalnyFetch) {
    window.fetch = function (...args) {
      const url = (args[0] && args[0].url) || args[0];
      const opcje = args[1] || {};
      const zadanie = typeof opcje.body === 'string' ? opcje.body : (opcje.body ? '[body nie-tekstowe]' : null);
      return oryginalnyFetch.apply(this, args).then((resp) => {
        resp.clone().text().then((body) => {
          dodajWpis({ url: String(url), metoda: (opcje.method || 'GET'), zadanie, odpowiedz: body });
        }).catch(() => {
          dodajWpis({ url: String(url), metoda: (opcje.method || 'GET'), zadanie, odpowiedz: null });
        });
        return resp;
      });
    };
  }

  // --- XMLHttpRequest ---
  const oryginalnyOpen = XMLHttpRequest.prototype.open;
  const oryginalnySend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metoda, url, ...reszta) {
    this.__podsluchUrl = url;
    this.__podsluchMetoda = metoda;
    return oryginalnyOpen.call(this, metoda, url, ...reszta);
  };
  XMLHttpRequest.prototype.send = function (cialo) {
    const zadanie = typeof cialo === 'string' ? cialo : (cialo ? '[body nie-tekstowe]' : null);
    this.addEventListener('load', function () {
      let body = null;
      try { body = this.responseText; } catch (e) { /* binarne — pomijamy */ }
      dodajWpis({ url: String(this.__podsluchUrl), metoda: this.__podsluchMetoda, zadanie, odpowiedz: body });
    });
    return oryginalnySend.call(this, cialo);
  };

  console.log('[podsluch ' + WERSJA + '] gotowe — podpięto fetch i XMLHttpRequest. '
    + 'Wykonaj akcję w ERP, potem wywołaj: savpolPodsluchZrzut()');
})();
