// Podsłuch sieciowy: loguje requesty fetch/XHR (URL + rozpoznany DictIdent),
// automatycznie w tle rozpoznaje OperationName każdej odpowiedzi (definicja
// formularza czy dane rekordu) i pozwala pobrać/zdekodować pełną treść
// wybranego wpisu.
// WERSJA: 2026-10-02.1
//            Konsola wypisuje ją po wklejeniu — jeśli tam widzisz inny numer,
//            w przeglądarce siedzi starsza kopia.
//
// UWAGA BEZPIECZEŃSTWA: ta wersja CELOWO NIE zapisuje treści żądań (payload
// wysyłany DO serwera) — żądania tej aplikacji zawierają dane logowania
// (login+hasło) w praktycznie czystej postaci (base64+zip, nie szyfrowanie).
// Zapisujemy tylko: URL, metodę, wyciągnięty bezpiecznie "DictIdent" z
// żądania (sama nazwa tabeli/okna, nic wrażliwego) oraz treść ODPOWIEDZI
// (to, co wraca z serwera).
//
// Po co: generyczne nazwy endpointów (OperatrionInvoke, getData) są używane
// do dziesiątek różnych rzeczy — jedyny sposób, żeby rozróżnić wywołania, to
// pole "DictIdent" w treści żądania (np. "csItemsOneBro" = karta produktu)
// ORAZ "OperationName" w treści odpowiedzi (np. "DictDefinition" = sama
// struktura formularza, nie wartości; inne nazwy = dane rekordu). Wcześniej
// trzeba było ręcznie dekodować każdy wpis, żeby to sprawdzić — teraz dzieje
// się to automatycznie w tle zaraz po złapaniu odpowiedzi.
//
// WAŻNE: wklej ten skrypt PRZED akcją, którą chcemy podsłuchać (nie odświeżaj
// całej strony po wklejeniu — to kasuje podpięcie).
//
// Jak używać:
//   1. Wklej ten plik w konsolę.
//   2. Wykonaj w ERP akcję, którą chcemy podsłuchać.
//   3. Poczekaj sekundę (dekodowanie w tle) i wywołaj: savpolPodsluchZrzut()
//      → lista z URL/DictIdent/OperationName/pierwszymi polami (jeśli to
//      dane) do schowka. Od razu widać, który wpis to dane rekordu.
//   4. savpolPodsluchDekoduj(N)   → PEŁNA, zdekodowana treść wpisu N do
//      schowka (i krótkie podsumowanie w konsoli) — użyj, gdy już wiesz,
//      który numer Cię interesuje.
//   4b. savpolPodsluchStruktura() → wszystkie tabele danych ze wszystkich
//      odpowiedzi (pola, liczba wierszy, wiersz 1) jednym zrzutem.
//   5. savpolPodsluchPelna(N)     → PEŁNA, ale NIEZDEKODOWANA treść
//      odpowiedzi wpisu nr N — tylko do wyjątkowych przypadków.

(function () {
  'use strict';

  const WERSJA = '2026-10-02.1';
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

  // Celowo BEZ Blob/Response/fetch — na tej stronie fetch bywa przeciążony
  // (patrz monkey-patch niżej), a Response/Blob.stream() potrafią pod spodem
  // po cichu korzystać z fetch w niektórych silnikach. Piszemy wprost do
  // writer/reader strumienia DecompressionStream, zero pośredników.
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
        break; // koniec prawdziwych danych, reszta to śmieci po nich — ignorujemy
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

  // Rdzeń dekodowania — używany zarówno przez automatyczne tagowanie w tle,
  // jak i przez savpolPodsluchDekoduj(N). Zwraca { ladny, obiekt, opName,
  // pierwszePola } albo null, jeśli się nie udało.
  async function zdekodujOdpowiedz(odpowiedzTekst) {
    let zewnetrzny;
    try { zewnetrzny = JSON.parse(odpowiedzTekst); } catch (e) { return null; }
    const b64 = zewnetrzny.JSONResult || zewnetrzny.Input;
    if (!b64) return null;
    let bajty;
    try {
      const surowe = atob(b64);
      bajty = new Uint8Array(surowe.length);
      for (let i = 0; i < surowe.length; i++) bajty[i] = surowe.charCodeAt(i);
    } catch (e) { return null; }
    const dv = new DataView(bajty.buffer);
    if (dv.getUint32(0, true) !== 0x04034b50) return null;
    const nazwaLen = dv.getUint16(26, true);
    const dodatkoweLen = dv.getUint16(28, true);
    const startDanych = 30 + nazwaLen + dodatkoweLen;
    const skompresowane = bajty.slice(startDanych);
    let tekst;
    try {
      const rozkompresowane = await dekompresujDeflateRaw(skompresowane);
      tekst = new TextDecoder('utf-8').decode(rozkompresowane);
    } catch (e) { return null; }

    let ladny = tekst;
    let obiekt = null;
    try { obiekt = JSON.parse(tekst); ladny = JSON.stringify(obiekt, null, 2); } catch (e) { /* nie-JSON */ }

    let opName = null;
    let pierwszePola = null;
    let dataSetIdent = null;
    let liczbaPol = null;
    if (obiekt) {
      const opInfo = obiekt.OperationInvokeResult || {};
      opName = opInfo.OperationName || null;

      // Kształt A: RefreshDataSetSQL_Synchronous → Result.RefreshObjectReturnList[0].DataTable
      // z FieldDefs (nazwy pól) + Records/Rows/Data (wartości, tablica-w-tablicy).
      const refreshObj = obiekt.Result && obiekt.Result.RefreshObjectReturnList
        && obiekt.Result.RefreshObjectReturnList[0];
      if (refreshObj && refreshObj.DataTable && refreshObj.DataTable.FieldDefs) {
        const dt = refreshObj.DataTable;
        const nazwyPol = dt.FieldDefs.map(f => f.FieldName);
        dataSetIdent = refreshObj.DataSetSQLIdent || null;
        liczbaPol = nazwyPol.length;
        const wiersze = dt.Records || dt.Rows || dt.Data || dt.records || dt.rows || dt.data;
        if (wiersze && wiersze[0]) {
          const w0 = wiersze[0];
          const rekord = Array.isArray(w0)
            ? nazwyPol.reduce((acc, n, i) => { acc[n] = w0[i]; return acc; }, {})
            : w0;
          pierwszePola = Object.keys(rekord).slice(0, 20).map(k => k + '=' + JSON.stringify(rekord[k]));
        }
      } else {
        // Kształt B (np. csNGSessions): Result.<klucz>.rows[0] jako obiekt wprost.
        const wynikDanych = (obiekt.Result && Object.values(obiekt.Result)[0]) || null;
        if (wynikDanych && wynikDanych.rows && wynikDanych.rows[0]) {
          const rekord = wynikDanych.rows[0];
          pierwszePola = Object.keys(rekord).slice(0, 20).map(k => k + '=' + JSON.stringify(rekord[k]));
        }
      }
    }
    return { ladny, obiekt, opName, pierwszePola, dataSetIdent, liczbaPol };
  }

  function dodajWpis(url, metoda, zadanieSurowe, odpowiedz) {
    const wpis = {
      url: url,
      metoda: metoda,
      dictIdent: wyciagnijDictIdent(zadanieSurowe),
      odpowiedz: odpowiedz,
      opName: undefined,      // undefined = jeszcze nie sprawdzone w tle
      pierwszePola: null,
      dataSetIdent: null,
      liczbaPol: null
    };
    zarejestrowane.push(wpis);
    // Dekodowanie w tle — best-effort, nie blokuje niczego. Jeśli się nie
    // uda (np. odpowiedź to nie ten format), opName zostaje null.
    if (odpowiedz) {
      zdekodujOdpowiedz(odpowiedz).then((wynik) => {
        wpis.opName = (wynik && wynik.opName) || null;
        wpis.pierwszePola = (wynik && wynik.pierwszePola) || null;
        wpis.dataSetIdent = (wynik && wynik.dataSetIdent) || null;
        wpis.liczbaPol = (wynik && wynik.liczbaPol) || null;
      }).catch(() => { wpis.opName = null; });
    } else {
      wpis.opName = null;
    }
  }

  window.savpolPodsluchZrzut = function () {
    const linie = [];
    linie.push('Savpol ERP — podsłuch requestów, wersja ' + WERSJA);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('Razem zarejestrowanych requestów: ' + zarejestrowane.length);
    linie.push('(treści żądań NIE są zapisywane — zawierają dane logowania.)');
    linie.push('');
    zarejestrowane.forEach((w, i) => {
      linie.push((i + 1) + '. ' + w.url);
      linie.push('   metoda: ' + w.metoda + (w.dictIdent ? '   DictIdent: ' + w.dictIdent : ''));
      const opStatus = w.opName === undefined ? '(jeszcze dekoduję w tle...)' : (w.opName || '(nie udało się rozpoznać)');
      linie.push('   OperationName: ' + opStatus + (w.dataSetIdent ? '   DataSetSQLIdent: ' + w.dataSetIdent : '')
        + (w.liczbaPol ? '   (' + w.liczbaPol + ' pól)' : ''));
      if (w.pierwszePola) {
        linie.push('   >>> TO SĄ DANE REKORDU <<<  pierwsze pola: ' + w.pierwszePola.slice(0, 8).join(', '));
      }
      linie.push('   odpowiedź: ' + (w.odpowiedz
        ? w.odpowiedz.length + ' znaków, początek: ' + w.odpowiedz.slice(0, MAX_PODGLAD).replace(/\s+/g, ' ')
        : '(brak / nieczytelna)'));
      linie.push('');
    });
    const txt = linie.join('\n');
    kopiuj(txt);
    console.log('[podsluch ' + WERSJA + '] skopiowano ' + zarejestrowane.length + ' requestów do schowka (' + txt.length + ' znaków). '
      + 'Jeśli widzisz "(jeszcze dekoduję w tle...)", poczekaj chwilę i wywołaj ponownie.');
    return txt;
  };

  // Struktura WSZYSTKICH odpowiedzi naraz: w każdej szuka rekurencyjnie
  // obiektów z FieldDefs (tabele danych), gdziekolwiek leżą — karta
  // kontrahenta (csCustomersOneBroFull) pakuje kilka zbiorów w inny kształt
  // niż karta produktu i główne tagowanie ich nie rozpoznaje. Wypisuje pełną
  // listę pól, liczbę wierszy i wartości pierwszego wiersza; zamiast kilku
  // zrzutów po ~1 MB jeden zwięzły do schowka.
  function odpakujKomorke(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const k = Object.keys(v);
      if (k.length === 1) return v[k[0]];
    }
    return v;
  }

  function znajdzTabele(obiekt, sciezka, wynik, glebokosc) {
    if (!obiekt || typeof obiekt !== 'object' || glebokosc > 12) return;
    if (Array.isArray(obiekt.FieldDefs)) {
      wynik.push({ sciezka: sciezka, dt: obiekt });
      return;
    }
    for (const k of Object.keys(obiekt)) {
      znajdzTabele(obiekt[k], sciezka + '.' + k, wynik, glebokosc + 1);
    }
  }

  window.savpolPodsluchStruktura = async function () {
    const linie = [];
    linie.push('Savpol ERP — struktura odpowiedzi, wersja ' + WERSJA);
    linie.push('URL: ' + location.href);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('');
    for (let i = 0; i < zarejestrowane.length; i++) {
      const w = zarejestrowane[i];
      const wynik = w.odpowiedz ? await zdekodujOdpowiedz(w.odpowiedz) : null;
      linie.push('=== ' + (i + 1) + '. DictIdent: ' + (w.dictIdent || '-') + '   ' + w.url.replace(/^https?:\/\/[^/]+/, ''));
      if (!wynik || !wynik.obiekt) { linie.push('   (nie JSON / nie zdekodowano)'); linie.push(''); continue; }
      const ob = wynik.obiekt;
      linie.push('   klucze główne: ' + Object.keys(ob).join(', ')
        + (ob.Result && typeof ob.Result === 'object' ? '   | Result: ' + Object.keys(ob.Result).join(', ') : ''));
      linie.push('   OperationName: ' + (wynik.opName || '(brak)'));
      if (wynik.opName === 'DictDefinition') { linie.push('   (definicja formularza — pomijam)'); linie.push(''); continue; }
      const tabele = [];
      znajdzTabele(ob, '', tabele, 0);
      if (!tabele.length) linie.push('   brak tabel z FieldDefs');
      tabele.forEach((t, j) => {
        const dt = t.dt;
        const nazwy = dt.FieldDefs.map(f => f.FieldName + (f.DataType !== undefined ? ':' + f.DataType : ''));
        const wiersze = dt.Records || dt.Rows || dt.Data || dt.records || dt.rows || dt.data || [];
        linie.push('   --- tabela ' + (j + 1) + ' @ ' + t.sciezka + '   pól: ' + nazwy.length + '   wierszy: ' + wiersze.length);
        linie.push('   pola: ' + nazwy.join(', '));
        if (wiersze[0]) {
          const w0 = wiersze[0];
          const rek = Array.isArray(w0)
            ? dt.FieldDefs.reduce((a, f, x) => { a[f.FieldName] = odpakujKomorke(w0[x]); return a; }, {})
            : Object.keys(w0).reduce((a, k) => { a[k] = odpakujKomorke(w0[k]); return a; }, {});
          linie.push('   wiersz 1: ' + Object.keys(rek).filter(k => rek[k] !== null && rek[k] !== '')
            .map(k => k + '=' + String(JSON.stringify(rek[k])).slice(0, 80)).join(' | '));
        }
      });
      linie.push('');
    }
    const txt = linie.join('\n');
    kopiuj(txt);
    console.log('[podsluch ' + WERSJA + '] struktura ' + zarejestrowane.length + ' odpowiedzi skopiowana (' + txt.length + ' znaków)');
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

  window.savpolPodsluchDekoduj = async function (n) {
    const w = zarejestrowane[n - 1];
    if (!w || !w.odpowiedz) { console.log('[podsluch] brak wpisu/odpowiedzi nr ' + n); return; }
    const wynik = await zdekodujOdpowiedz(w.odpowiedz);
    if (!wynik) { console.log('[podsluch] nie udało się zdekodować wpisu ' + n + ' (może to nie ten format)'); return; }
    console.log('[podsluch ' + WERSJA + '] --- PODSUMOWANIE wpisu ' + n + ' ---');
    console.log('  OperationName: ' + (wynik.opName || '(brak)')
      + (wynik.dataSetIdent ? '   DataSetSQLIdent: ' + wynik.dataSetIdent : '')
      + (wynik.liczbaPol ? '   (' + wynik.liczbaPol + ' pól)' : ''));
    if (wynik.pierwszePola) {
      console.log('  TO WYGLĄDA NA DANE REKORDU — pierwsze pola:');
      wynik.pierwszePola.forEach(p => console.log('    ' + p));
    } else if (wynik.opName === 'DictDefinition') {
      console.log('  (to DEFINICJA formularza — data-datafield w VisualDefinition, nie wartości)');
    }
    kopiuj(wynik.ladny);
    console.log('[podsluch ' + WERSJA + '] zdekodowano wpis ' + n + ' (' + wynik.ladny.length + ' znaków), skopiowano do schowka');
    window.__podsluchZdekodowany = wynik.ladny;
    return wynik.ladny;
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
    + 'Każda odpowiedź jest teraz automatycznie tagowana w tle (OperationName). '
    + 'Wykonaj akcję w ERP, poczekaj chwilę, potem: savpolPodsluchZrzut()');
})();
