// Podsłuch sieciowy: loguje requesty fetch/XHR (URL + rozpoznany DictIdent +
// rozmiar/początek odpowiedzi) i pozwala ZDEKODOWAĆ w przeglądarce (bez
// ręcznego przepisywania base64) skompresowaną treść odpowiedzi wybranego
// wpisu.
// WERSJA: 2026-09-11.7
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
//   4. savpolPodsluchDekoduj(N)   → NAJWAŻNIEJSZA funkcja: odpowiedzi tej
//      aplikacji są spakowane (base64+ZIP+deflate) w polu "JSONResult" —
//      ta funkcja dekoduje to W PRZEGLĄDARCE (DecompressionStream, bez
//      żadnej biblioteki) i kopiuje do schowka już czytelny, ładnie
//      sformatowany JSON. Używaj TEJ, nie savpolPodsluchPelna, dla wpisów
//      z polem JSONResult (prawie wszystkie OperatrionInvoke).
//   5. savpolPodsluchPelna(N)     → PEŁNA, ale NIEZDEKODOWANA treść
//      odpowiedzi wpisu nr N — tylko do wyjątkowych przypadków (np. gdy
//      odpowiedź nie jest spakowana).

(function () {
  'use strict';

  const WERSJA = '2026-09-11.7';
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

  // Ta aplikacja pakuje większe odpowiedzi jako base64(ZIP z jednym plikiem,
  // metoda deflate) w polu "JSONResult". Zamiast ręcznie przepisywać ten
  // ogromny base64 do rozmowy (podatne na literówki przy tak długich
  // stringach — dokładnie to nam się przydarzyło), dekodujemy TUTAJ, w
  // przeglądarce, korzystając z wbudowanego DecompressionStream. Zero
  // ręcznego przepisywania danych binarnych.
  // Celowo BEZ Blob/Response/fetch — na tej stronie fetch bywa przeciążony
  // (patrz reszta tego skryptu), a Response/Blob.stream() potrafią pod
  // spodem po cichu korzystać z fetch w niektórych silnikach. Piszemy
  // wprost do writer/reader strumienia DecompressionStream, zero pośredników.
  async function dekompresujDeflateRaw(bajty) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    // Nie znamy dokładnego rozmiaru skompresowanych danych (nagłówek ZIP tej
    // aplikacji ma nierzetelne pole "compressed size"), więc podajemy
    // WSZYSTKO po nagłówku — łącznie z katalogiem centralnym ZIP, który
    // przypadkiem jest doklejony na końcu. Prawdziwe dane zawsze przychodzą
    // PRZED tymi śmieciami, więc łapiemy błąd "junk after end" i po prostu
    // zwracamy to, co zdążyliśmy zebrać do tego momentu.
    writer.write(bajty).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const kawalki = [];
    let razem = 0;
    for (;;) {
      let wynikOdczytu;
      try {
        wynikOdczytu = await reader.read();
      } catch (e) {
        console.log('[podsluch] (info) koniec danych z resztkami po nich — ignoruję resztki: ' + e.message);
        break;
      }
      const { done, value } = wynikOdczytu;
      if (done) break;
      kawalki.push(value);
      razem += value.length;
    }
    const wynik = new Uint8Array(razem);
    let offset = 0;
    for (const k of kawalki) { wynik.set(k, offset); offset += k.length; }
    return wynik;
  }

  window.savpolPodsluchDekoduj = async function (n) {
    const w = zarejestrowane[n - 1];
    if (!w || !w.odpowiedz) { console.log('[podsluch] brak wpisu/odpowiedzi nr ' + n); return; }
    let zewnetrzny;
    try { zewnetrzny = JSON.parse(w.odpowiedz); } catch (e) {
      console.log('[podsluch] odpowiedź wpisu ' + n + ' nie jest JSON-em: ' + e.message);
      return;
    }
    const b64 = zewnetrzny.JSONResult || zewnetrzny.Input;
    if (!b64) { console.log('[podsluch] brak pola JSONResult/Input w odpowiedzi wpisu ' + n); return; }
    const surowe = atob(b64);
    const bajty = new Uint8Array(surowe.length);
    for (let i = 0; i < surowe.length; i++) bajty[i] = surowe.charCodeAt(i);
    const dv = new DataView(bajty.buffer);
    if (dv.getUint32(0, true) !== 0x04034b50) {
      console.log('[podsluch] brak sygnatury ZIP na początku (0x504B0304) — nieoczekiwany format');
      return;
    }
    const nazwaLen = dv.getUint16(26, true);
    const dodatkoweLen = dv.getUint16(28, true);
    const startDanych = 30 + nazwaLen + dodatkoweLen;
    const skompresowane = bajty.slice(startDanych);
    try {
      const rozkompresowane = await dekompresujDeflateRaw(skompresowane);
      const tekst = new TextDecoder('utf-8').decode(rozkompresowane);
      let ladny = tekst;
      let obiekt = null;
      try { obiekt = JSON.parse(tekst); ladny = JSON.stringify(obiekt, null, 2); } catch (e) { /* nie-JSON, zostaw jak jest */ }

      // Krótkie podsumowanie w konsoli PRZED skopiowaniem całości — żeby
      // dało się szybko rozpoznać, czy to DEFINICJA formularza czy DANE
      // rekordu, bez wklejania za każdym razem ogromnego tekstu do rozmowy.
      if (obiekt) {
        const opInfo = obiekt.OperationInvokeResult || {};
        console.log('[podsluch ' + WERSJA + '] --- PODSUMOWANIE wpisu ' + n + ' ---');
        console.log('  OperationName: ' + (opInfo.OperationName || '(brak)'));
        console.log('  górne klucze Result: ' + Object.keys(obiekt.Result || obiekt).join(', '));
        // Jeśli to wygląda na DANE rekordu (nie definicję), pokaż od razu
        // pierwsze ~20 kluczy pól i ich wartości — najczęściej to wystarczy,
        // żeby rozpoznać właściwy wpis bez kopiowania całości.
        const wynikDanych = (obiekt.Result && Object.values(obiekt.Result)[0]) || null;
        if (wynikDanych && wynikDanych.rows && wynikDanych.rows[0]) {
          const rekord = wynikDanych.rows[0];
          console.log('  TO WYGLĄDA NA DANE REKORDU — pierwsze pola:');
          Object.keys(rekord).slice(0, 20).forEach(k => {
            console.log('    ' + k + ' = ' + JSON.stringify(rekord[k]));
          });
        } else if (opInfo.OperationName === 'DictDefinition') {
          console.log('  (to DEFINICJA formularza — data-datafield w VisualDefinition, nie wartości)');
        }
      }

      kopiuj(ladny);
      console.log('[podsluch ' + WERSJA + '] zdekodowano wpis ' + n + ' (' + ladny.length + ' znaków), skopiowano do schowka');
      window.__podsluchZdekodowany = ladny;
      return ladny;
    } catch (e) {
      console.log('[podsluch] błąd dekompresji wpisu ' + n + ': ' + e.message);
    }
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
