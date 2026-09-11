// Podsłuch sieciowy: loguje requesty fetch/XHR (URL + rozpoznany DictIdent +
// rozmiar/początek odpowiedzi) i pozwala pobrać PEŁNĄ, nieobciętą treść
// odpowiedzi wybranego wpisu.
// WERSJA: 2026-09-11.3
//            Konsola wypisuje ją po wklejeniu — jeśli tam widzisz inny numer,
//            w przeglądarce siedzi starsza kopia.
//
// UWAGA BEZPIECZEŃSTWA: ta wersja CELOWO NIE zapisuje treści żądań (payload
// wysyłany DO serwera) — poprzednia wersja to robiła, a żądania tej aplikacji
// zawierają dane logowania (login+hasło) w praktycznie czystej postaci
// (base64+zip, nie szyfrowanie). Zapisujemy tylko: URL, metodę, wyciągnięty
// bezpiecznie "DictIdent" z żądania (sama nazwa tabeli/okna, nic wrażliwego)
// oraz treść ODPOWIEDZI (to, co wraca z serwera — dane produktu, nie dane
// logowania).
//
// Po co: generyczne nazwy endpointów (OperatrionInvoke, getData) są używane
// do dziesiątek różnych rzeczy — jedyny sposób, żeby rozróżnić wywołania, to
// pole "DictIdent" w treści żądania (np. "csItemsOneBro" = karta produktu).
//
// WAŻNE: wklej ten skrypt PRZED akcją, którą chcemy podsłuchać (nie odświeżaj
// całej strony po wklejeniu — to kasuje podpięcie).
//
// Jak używać:
//   1. Wklej ten plik w konsolę.
//   2. Wykonaj w ERP akcję, którą chcemy podsłuchać.
//   3. savpolPodsluchZrzut()      → skrócona lista (URL/DictIdent/rozmiar) do schowka.
//   4. savpolPodsluchPelna(N)     → PEŁNA treść odpowiedzi wpisu nr N (z listy
//      powyżej) do schowka — użyj, gdy chcemy zobaczyć całą (dużą) odpowiedź.

(function () {
  'use strict';

  const WERSJA = '2026-09-11.3';
  const MAX_PODGLAD = 300;

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

  function wyciagnijDictIdent(zadanie) {
    if (!zadanie) return null;
    const m = /"DictIdent"\s*:\s*"([^"]+)"/.exec(zadanie);
    return m ? m[1] : null;
  }

  function dodajWpis(url, metoda, zadanieSurowe, odpowiedz) {
    zarejestrowane.push({
      url: url,
      metoda: metoda,
      dictIdent: wyciagnijDictIdent(zadanieSurowe),
      odpowiedz: odpowiedz
    });
  }

  window.savpolPodsluchZrzut = function () {
    const linie = [];
    linie.push('Savpol ERP — podsłuch requestów, wersja ' + WERSJA);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('Razem zarejestrowanych requestów: ' + zarejestrowane.length);
    linie.push('(treści żądań NIE są zapisywane — zawierają dane logowania. '
      + 'Wywołaj savpolPodsluchPelna(N) po pełną treść ODPOWIEDZI wpisu N.)');
    linie.push('');
    zarejestrowane.forEach((w, i) => {
      linie.push((i + 1) + '. ' + w.url);
      linie.push('   metoda: ' + w.metoda + (w.dictIdent ? '   DictIdent: ' + w.dictIdent : ''));
      linie.push('   odpowiedź: ' + (w.odpowiedz
        ? w.odpowiedz.length + ' znaków, początek: ' + w.odpowiedz.slice(0, MAX_PODGLAD).replace(/\s+/g, ' ')
        : '(brak / nieczytelna)'));
      linie.push('');
    });
    const txt = linie.join('\n');
    kopiuj(txt);
    console.log('[podsluch ' + WERSJA + '] skopiowano ' + zarejestrowane.length + ' requestów do schowka (' + txt.length + ' znaków)');
    return txt;
  };

  window.savpolPodsluchPelna = function (n) {
    const w = zarejestrowane[n - 1];
    if (!w) { console.log('[podsluch] brak wpisu nr ' + n); return; }
    if (!w.odpowiedz) { console.log('[podsluch] wpis nr ' + n + ' nie ma czytelnej odpowiedzi'); return; }
    kopiuj(w.odpowiedz);
    console.log('[podsluch ' + WERSJA + '] skopiowano PEŁNĄ odpowiedź wpisu ' + n
      + ' (' + w.odpowiedz.length + ' znaków): ' + w.url);
    return w.odpowiedz;
  };

  // --- fetch ---
  const oryginalnyFetch = window.fetch;
  if (oryginalnyFetch) {
    window.fetch = function (...args) {
      const url = (args[0] && args[0].url) || args[0];
      const opcje = args[1] || {};
      const zadanie = typeof opcje.body === 'string' ? opcje.body : null;
      return oryginalnyFetch.apply(this, args).then((resp) => {
        resp.clone().text().then((body) => {
          dodajWpis(String(url), (opcje.method || 'GET'), zadanie, body);
        }).catch(() => {
          dodajWpis(String(url), (opcje.method || 'GET'), zadanie, null);
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
    const zadanie = typeof cialo === 'string' ? cialo : null;
    this.addEventListener('load', function () {
      let body = null;
      try { body = this.responseText; } catch (e) { /* binarne — pomijamy */ }
      dodajWpis(String(this.__podsluchUrl), this.__podsluchMetoda, zadanie, body);
    });
    return oryginalnySend.call(this, cialo);
  };

  console.log('[podsluch ' + WERSJA + '] gotowe — podpięto fetch i XMLHttpRequest (treści żądań NIE są zapisywane). '
    + 'Wykonaj akcję w ERP, potem: savpolPodsluchZrzut() / savpolPodsluchPelna(N)');
})();
