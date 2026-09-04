// Podgląd żądań zapisu w ERP — do wklejenia w konsolę przeglądarki.
// WERSJA: 2026-09-04.2
//            Konsola wypisuje ja po wklejeniu — jesli tam widzisz
//            inny numer, w przegladarce siedzi starsza kopia.
//
// Po co: zanim skrypt zacznie zapisywać opisy przez API ERP, trzeba wiedzieć,
// JAK ten zapis wygląda naprawdę — który endpoint, jakie pola, co jest
// tożsamością rekordu, a co stałą sesji.
//
// Jak używać:
//   1. Otwórz kartę produktu w ERP i wklej ten plik w konsolę.
//   2. savpolSniffStart('A - dodanie nazwy')   ← nazwa przebiegu, dowolna
//   3. Zrób W ERP JEDNĄ rzecz, o którą chodzi w tym przebiegu.
//   4. await savpolSniffCopy()  → komplet ląduje w schowku.
//   Kolejny przebieg = znowu savpolSniffStart('B - …'). Sam Start czyści
//   poprzednie nagranie; bez niego skopiujesz stare.
//
// UWAGA — TEN ERP WYSYŁA HASŁO PRZY KAŻDYM ŻĄDANIU. W polu `Input` siedzi
// `LoginInfo` z `UserName` i `Password` otwartym tekstem. Snippet rozpakowuje
// payload i USUWA dane logowania, zanim cokolwiek trafi do schowka.
//
// Mimo to: zrzut nadal zawiera treść dokumentów i identyfikatory sesji.
// Repo savpol-erp jest PUBLICZNE — nie commituj tu wyniku.
//
// ZMIANY 2026-09-04.1 — trzy błędy, przez które przebiegi A/B/C wyszły takie same
// i niekompletne:
//   * Żądanie ZAPISU bywa spakowane DEFLATE, a nie „stored". Rozpakowywanie
//     zakładało tylko „stored", więc akurat najważniejsze żądanie zamieniało
//     się w krzaki. Teraz czytamy metodę z nagłówka ZIP-a i inflate'ujemy.
//   * Ciała dłuższe niż 20 000 znaków były ucinane na twardo — ginęła treść
//     opisu. Teraz payload jest STRESZCZANY (Params + wiersze siatek), więc
//     mieści się bez ucinania czegokolwiek istotnego.
//   * Kopiowanie bez wcześniejszego Start oddawało po cichu POPRZEDNIE
//     nagranie. Zrzut nosi teraz nazwę przebiegu i godzinę, a kopiowanie
//     nagrania zatrzymanego albo pustego głośno ostrzega.

(function () {
  'use strict';

  const WERSJA = '2026-09-04.2';

  const MUTUJACE = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const LIMIT_SUROWY = 4000;   // tylko dla payloadow, ktorych nie umiemy zrozumiec
  const LIMIT_POLA = 4000;     // pojedyncza wartość w wierszu siatki
  const zapisy = [];
  let start = null;
  let etykieta = '';
  let kopiowane = false;

  // Wycina dane logowania. Wzorzec działa na TEKŚCIE, nie na sparsowanym
  // JSON-ie — payload bywa uszkodzony albo ucięty, a wtedy JSON.parse pada
  // i hasło by przeszło.
  const WRAZLIWE = /("(?:Password|Pwd|Haslo|Hasło|Token|AccessToken|ApiKey)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

  function odchudz(s) {
    return String(s).replace(WRAZLIWE, '$1"[USUNIĘTE]"');
  }

  // ---------- rozpakowanie ----------

  function naBajty(b64) {
    let sur;
    try { sur = atob(b64); } catch (e) { return null; }
    return Uint8Array.from(sur, c => c.charCodeAt(0));
  }

  // ERP pakuje raz tak, raz tak: żądania widoku idą jako ZIP „stored" (JSON
  // leży w środku otwartym tekstem), ale ŻĄDANIE ZAPISU potrafi być spakowane
  // deflate. Nie zgadujemy — czytamy metodę z nagłówka ZIP-a.
  // Za JSON-em w ZIP-ie „stored" idzie jeszcze centralny katalog archiwum
  // (kończy się bajtami „PK…"). Bez odcięcia go JSON.parse pada — i to właśnie
  // przez to pierwsze poprawione nagranie wyszło jako „nie zrozumiałem".
  function wytnijJson(s) {
    if (s == null) return null;
    const od = s.indexOf('{');
    const doo = s.lastIndexOf('}');
    return (od < 0 || doo <= od) ? null : s.slice(od, doo + 1);
  }

  async function rozpakujB64(b64) {
    const bajty = naBajty(b64);
    if (!bajty || !bajty.length) return null;

    if (bajty[0] !== 0x50 || bajty[1] !== 0x4b) {
      return wytnijJson(new TextDecoder().decode(bajty));
    }
    const metoda = bajty[8] | (bajty[9] << 8);
    const od = 30 + (bajty[26] | (bajty[27] << 8)) + (bajty[28] | (bajty[29] << 8));
    const dane = bajty.slice(od);
    if (metoda === 0) return wytnijJson(new TextDecoder().decode(dane));
    if (typeof DecompressionStream !== 'function') return null;
    try {
      const st = new Blob([dane]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return wytnijJson(await new Response(st).text());
    } catch (e) {
      return null;
    }
  }

  async function wyjmijPole(txt, pole) {
    const m = new RegExp('"' + pole + '"\\s*:\\s*"([A-Za-z0-9+/=]{100,})"').exec(String(txt || ''));
    return m ? await rozpakujB64(m[1]) : null;
  }

  // ---------- streszczanie ----------

  const SMIECI = ['__private', 'csevents', 'interfaces', 'IsDisposed', 'Hash'];

  function wartosc(v) {
    const s = JSON.stringify(v);
    return s == null ? 'null'
      : (s.length > LIMIT_POLA ? s.slice(0, LIMIT_POLA) + '…[+' + (s.length - LIMIT_POLA) + ']' : s);
  }

  function wierszeSiatki(w, linie, wciecie) {
    const dt = w.DataTableInit && w.DataTableInit.DataTable;
    const n = dt && dt.Rows ? dt.Rows.length : 0;
    linie.push(wciecie + (w.DataSetSQLIdent || '?') + '  wierszy=' + n
      + (w.Refresh ? '  Refresh' : ''));
    if (!n) return;
    const nazwy = dt.FieldDefs.map(f => f.FieldName);
    dt.Rows.slice(0, 5).forEach(row => {
      row.forEach((kom, i) => {
        const v = kom && typeof kom === 'object' ? kom.Item : kom;
        if (v === null || v === '') return;   // puste kolumny to szum
        linie.push(wciecie + '   ' + nazwy[i] + ' = ' + wartosc(v));
      });
      linie.push(wciecie + '   ·');
    });
    if (n > 5) linie.push(wciecie + '   …[jeszcze ' + (n - 5) + ' wierszy]');
  }

  // Odpowiedź ma inny kształt niż żądanie: siatki leżą w RefreshObjectReturnList,
  // a ich DataSetSQLIdent bywa pusty — rozpoznajemy je po nazwach kolumn.
  function streszczOdpowiedz(d) {
    const wynik = d.OperationInvokeResult || d.Result;
    if (!wynik) return null;
    const linie = [];
    if (d.Error || wynik.Error) linie.push('BŁĄD: ' + wartosc(d.Error || wynik.Error));
    ['RemoteFileInfoList', 'ReturnValue', 'ActionResult'].forEach(k => {
      if (wynik[k] != null) linie.push(k + ': ' + wartosc(wynik[k]));
    });
    const zwroty = wynik.RefreshObjectReturnList;
    if (zwroty && typeof zwroty === 'object') {
      Object.keys(zwroty).filter(k => k !== 'length').forEach(k => {
        const z = zwroty[k];
        const dt = z && z.DataTable;
        if (!dt || !dt.FieldDefs) return;
        const n = dt.Rows ? dt.Rows.length : 0;
        linie.push('siatka [' + (z.DataSetSQLIdent || 'bez identu') + '] wierszy=' + n
          + '  kolumny: ' + dt.FieldDefs.map(f => f.FieldName).join(', ').slice(0, 600));
      });
    }
    return linie.length ? linie.join('\n') : '(odpowiedź bez treści, której szukam)';
  }

  // Zamiast 55 000 znaków, z czego 54 000 to puste struktury — kilka ekranów
  // tego, co naprawdę niesie treść.
  function streszcz(json) {
    let d;
    try { d = JSON.parse(json); } catch (e) { return null; }
    if (!d) return null;
    if (!d.OperationInvokeInput) return streszczOdpowiedz(d);
    const op = d.OperationInvokeInput;

    const linie = [];
    const p = op.Params || {};
    linie.push('OperationName: ' + op.OperationName);
    Object.keys(p).forEach(k => {
      if (p[k] === null || p[k] === '' || SMIECI.indexOf(k) >= 0) return;
      linie.push('  ' + k + ': ' + wartosc(p[k]));
    });
    const ri = op.RefreshInputObject;
    if (ri && ri.ParentUniqName) {
      linie.push('  ParentUniqName: ' + ri.ParentUniqName + '   ParentIdent: ' + ri.ParentIdent);
    }
    linie.push('  sesja: SID=' + op.SID + ' SessionId=' + op.SessionId
      + ' CompaniesId=' + op.CompaniesId
      + ' CPG=' + ((d.LoginInfo && d.LoginInfo.CPG) || '?'));

    [['DataTableInitList (na wierzchu)', op.DataTableInitList],
     ['DataTableInitList (w RefreshInputObject)', ri && ri.DataTableInitList]]
      .forEach(([tytul, lst]) => {
        if (!lst || typeof lst !== 'object') return;
        const klucze = Object.keys(lst).filter(k => k !== 'length');
        if (!klucze.length) return;
        linie.push('  ' + tytul + ':');
        klucze.sort((a, b) => Number(a) - Number(b)).forEach(k => {
          const w = lst[k];
          if (w && typeof w === 'object') wierszeSiatki(w, linie, '    ');
        });
      });
    return linie.join('\n');
  }

  async function przetworz(surowy, pole) {
    if (surowy == null || surowy === '') return '(puste)';
    const rozp = await wyjmijPole(surowy, pole);
    if (rozp) {
      const czysty = odchudz(rozp);
      const skrot = streszcz(czysty);
      if (skrot) return skrot;
      return '[nie zrozumiałem struktury — surowo]\n' + czysty.slice(0, LIMIT_SUROWY);
    }
    const s = odchudz(surowy);
    return s.length > LIMIT_SUROWY
      ? s.slice(0, LIMIT_SUROWY) + '\n…[ucięte, całość ' + s.length + ' znaków]'
      : s;
  }

  // ---------- nagrywanie ----------

  function dodaj(rec) {
    rec.t = ((Date.now() - start) / 1000).toFixed(1) + 's';
    zapisy.push(rec);
    console.log('[sniff] ' + zapisy.length + '. ' + rec.method + ' '
      + rec.url.replace(location.origin, '') + ' → ' + rec.status);
  }

  const origFetch = window.fetch;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  let wlaczony = false;

  window.savpolSniffStart = function (nazwa, wszystkie) {
    zapisy.length = 0;
    kopiowane = false;
    start = Date.now();
    etykieta = String(nazwa || '').trim();
    if (!etykieta) {
      console.warn('[sniff] Nazwij przebieg, np. savpolSniffStart("B - edycja opisu") — '
        + 'bez nazwy łatwo pomylić zrzuty między sobą.');
      etykieta = '(bez nazwy)';
    }
    if (wlaczony) {
      console.log('[sniff] nagrywam od nowa: ' + etykieta);
      return;
    }
    wlaczony = true;
    const bierzemy = m => wszystkie || MUTUJACE.indexOf((m || 'GET').toUpperCase()) >= 0;

    // ERP jest aplikacją Kendo/ASP.NET — zapisy potrafią iść zarówno przez
    // fetch, jak i przez klasyczny XHR. Podpinamy oba, bo z góry nie wiadomo.
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const body = init && init.body;
      const naglowki = {};
      try {
        new Headers((init && init.headers) || (input && input.headers) || {})
          .forEach((v, k) => { naglowki[k] = v; });
      } catch (e) { /* nieistotne */ }

      return origFetch.apply(this, arguments).then(res => {
        if (bierzemy(method)) {
          // Klon, bo strumień odpowiedzi da się przeczytać tylko raz —
          // bez tego ERP dostałby pustkę i widok by się rozjechał.
          res.clone().text().then(txt => dodaj({
            zrodlo: 'fetch', method, url, naglowki,
            body: typeof body === 'string' ? body : (body ? '[' + String(body) + ']' : ''),
            status: res.status, odpowiedz: txt
          })).catch(() => {});
        }
        return res;
      });
    };

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__sniff = { method: (method || 'GET').toUpperCase(), url: url, naglowki: {} };
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (this.__sniff) this.__sniff.naglowki[k] = v;
      return origSetHeader.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const s = this.__sniff;
      if (s && bierzemy(s.method)) {
        this.addEventListener('loadend', () => {
          let odp = '';
          try {
            odp = this.responseType === '' || this.responseType === 'text'
              ? this.responseText : '[' + this.responseType + ']';
          } catch (e) { odp = '[nieczytelna]'; }
          dodaj({
            zrodlo: 'xhr', method: s.method, url: s.url, naglowki: s.naglowki,
            body: typeof body === 'string' ? body : (body ? '[' + String(body) + ']' : ''),
            status: this.status, odpowiedz: odp
          });
        });
      }
      return origSend.apply(this, arguments);
    };

    console.log('[sniff] nagrywam „' + etykieta + '"'
      + (wszystkie ? ' — WSZYSTKO' : ' — tylko zapisy (POST/PUT/PATCH/DELETE)')
      + '. Zrób rzecz w ERP, potem: await savpolSniffCopy()');
  };

  window.savpolSniffStop = function () {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
    XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
    wlaczony = false;
    console.log('[sniff] zatrzymane, nagranych: ' + zapisy.length);
  };

  window.savpolSniffStan = function () {
    const s = '[sniff] ' + (wlaczony ? 'NAGRYWAM' : 'zatrzymane')
      + ' | przebieg: ' + (etykieta || '—')
      + ' | żądań: ' + zapisy.length
      + (kopiowane ? ' | to nagranie już kopiowałeś' : '');
    console.log(s);
    return s;
  };

  window.savpolSniffText = async function () {
    const linie = [];
    linie.push('Savpol ERP — nagranie żądań zapisu');
    linie.push('Przebieg: ' + (etykieta || '(bez nazwy)'));
    linie.push('Nagrywanie zaczęte: ' + (start ? new Date(start).toLocaleString() : '—'));
    linie.push('Zrzut zrobiony:     ' + new Date().toLocaleString());
    linie.push('URL: ' + location.href);
    linie.push('Żądań: ' + zapisy.length);
    linie.push('');
    // Każdy rekord osobno. Wcześniej jedno potknięcie w środku ucinało zrzut
    // po cichu — w pliku było 4 żądania z 11 i nic o tym nie mówiło.
    let potkniecia = 0;
    for (let i = 0; i < zapisy.length; i++) {
      const r = zapisy[i];
      linie.push('===== #' + i + '  [' + r.t + ']  ' + r.method + ' (' + r.zrodlo + ') → ' + r.status + ' =====');
      linie.push('URL: ' + r.url);
      try {
        linie.push('--- żądanie ---');
        linie.push(await przetworz(r.body, 'Input'));
        linie.push('--- odpowiedź ---');
        linie.push(await przetworz(r.odpowiedz, 'JSONResult'));
      } catch (e) {
        potkniecia++;
        linie.push('!!! nie udało się przetworzyć tego żądania: ' + (e && e.message));
      }
      linie.push('');
    }
    linie.push('— koniec zrzutu, żądań: ' + zapisy.length
      + (potkniecia ? ', nieprzetworzonych: ' + potkniecia : ''));
    return linie.join('\n');
  };

  // Wynik idzie do schowka sam — użytkownik nie zaznacza niczego w konsoli.
  // Kolejność prób jak w CLAUDE.md: copy() z DevTools działa zawsze i nie
  // wymaga focusu strony, reszta to zapas.
  window.savpolSniffCopy = async function () {
    // Nagranie B i C wyszły identyczne jak A właśnie tu: kopiowanie po cichu
    // oddawało poprzednią zawartość. Teraz to widać, zanim wkleisz do pliku.
    if (!zapisy.length) {
      console.warn('[sniff] NIC NIE NAGRANO. Najpierw savpolSniffStart("nazwa"), '
        + 'potem zrób rzecz w ERP, dopiero potem kopiuj.');
      return;
    }
    if (!wlaczony) {
      console.warn('[sniff] Nagrywanie jest ZATRZYMANE — kopiuję to, co zostało '
        + 'z przebiegu „' + etykieta + '". Jeśli chodziło o nową czynność, '
        + 'zrób savpolSniffStart("nazwa") i powtórz ją.');
    }
    if (kopiowane) {
      console.warn('[sniff] To nagranie („' + etykieta + '") już raz kopiowałeś. '
        + 'Jeśli to miał być kolejny przebieg — potrzebny savpolSniffStart.');
    }
    const txt = await window.savpolSniffText();
    kopiowane = true;
    try {
      if (typeof copy === 'function') {
        copy(txt);
        console.log('[sniff] skopiowano „' + etykieta + '", ' + txt.length + ' znaków');
        return;
      }
    } catch (e) { /* lecimy dalej */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(txt);
        console.log('[sniff] skopiowano „' + etykieta + '", ' + txt.length + ' znaków');
        return;
      } catch (e) { /* zapas niżej */ }
    }
    zapasowoDoSchowka(txt);
  };

  function zapasowoDoSchowka(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    console.log(ok ? '[sniff] skopiowano, ' + txt.length + ' znaków'
                   : '[sniff] NIE UDAŁO SIĘ skopiować — użyj: copy(await savpolSniffText())');
  }

  console.log('[sniff] wersja ' + WERSJA + ' — gotowe. '
    + 'savpolSniffStart("A - dodanie nazwy") → zrób rzecz w ERP → await savpolSniffCopy()');
})();
