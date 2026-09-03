// Podgląd żądań zapisu w ERP — do wklejenia w konsolę przeglądarki.
//
// Po co: zanim skrypt zacznie zapisywać opisy przez API ERP, trzeba wiedzieć,
// JAK ten zapis wygląda naprawdę — który endpoint, jakie pola, co jest
// tożsamością rekordu, a co stałą sesji. Klikanie po zakładce Network i ręczne
// przeklejanie jest wolne i gubi nagłówki.
//
// Jak używać:
//   1. Otwórz kartę produktu w ERP i wklej ten plik w konsolę.
//   2. savpolSniffStart()
//   3. Zrób ZAPIS BEZ ŻADNEJ ZMIANY (samo „Zapisz").
//   4. Zmień JEDNO pole i zapisz.
//   5. To samo na INNYM produkcie — bez tego nie odróżnisz identyfikatora
//      rekordu od przypadkowej liczby, która akurat była stała.
//   6. savpolSniffCopy()  → komplet ląduje w schowku, wklej do rozmowy.
//
// UWAGA — TEN ERP WYSYŁA HASŁO PRZY KAŻDYM ŻĄDANIU. W polu `Input` (base64
// z nieskompresowanego ZIP-a) siedzi `LoginInfo` z `UserName` i `Password`
// otwartym tekstem. Dlatego snippet ROZPAKOWUJE payload i USUWA z niego dane
// logowania, zanim cokolwiek trafi do schowka. Przy okazji zrzut staje się
// czytelny — bez tego jest to ściana base64.
//
// Mimo to: zrzut nadal zawiera treść dokumentów i identyfikatory sesji.
// Repo savpol-erp jest PUBLICZNE — nie commituj tu wyniku.

(function () {
  'use strict';

  const MUTUJACE = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const LIMIT_TRESCI = 20000;   // dłuższe ciała ucinamy, żeby schowek nie puchł
  const zapisy = [];
  let start = null;

  // Wycina dane logowania. Wzorzec jest celowo szeroki (Password, Pwd, Haslo,
  // token, SID) i działa na tekście, a nie na sparsowanym JSON-ie — payload
  // bywa uszkodzony albo ucięty, a wtedy JSON.parse pada i hasło by przeszło.
  const WRAZLIWE = /("(?:Password|Pwd|Haslo|Hasło|Token|AccessToken|ApiKey)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

  function odchudz(s) {
    return String(s).replace(WRAZLIWE, '$1"[USUNIĘTE]"');
  }

  // Payload ERP to base64 ZIP-a zapisanego BEZ KOMPRESJI (metoda „stored"),
  // więc JSON leży w środku otwartym tekstem — wystarczy odciąć nagłówki ZIP-a.
  // Rozpakowujemy do PODGLĄDU, nie do wysyłki, więc nie musimy dbać o CRC.
  function rozpakuj(txt) {
    const m = /"Input"\s*:\s*"([A-Za-z0-9+/=]{200,})"/.exec(txt);
    if (!m) return null;
    let surowy;
    try { surowy = atob(m[1]); } catch (e) { return null; }
    const od = surowy.indexOf('{');
    const doo = surowy.lastIndexOf('}');
    if (od < 0 || doo <= od) return null;
    return surowy.slice(od, doo + 1);
  }

  function skroc(txt) {
    if (txt == null) return '';
    let s = odchudz(txt);
    const rozp = rozpakuj(s);
    if (rozp) s = '[payload rozpakowany z base64/ZIP]\n' + odchudz(rozp);
    return s.length > LIMIT_TRESCI
      ? s.slice(0, LIMIT_TRESCI) + '\n…[ucięte, całość ' + s.length + ' znaków]'
      : s;
  }

  function dodaj(rec) {
    rec.t = ((Date.now() - start) / 1000).toFixed(1) + 's';
    zapisy.push(rec);
    console.log('[sniff] ' + rec.method + ' ' + rec.url.replace(location.origin, '')
      + ' → ' + rec.status);
  }

  const origFetch = window.fetch;
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  let wlaczony = false;

  window.savpolSniffStart = function (wszystkie) {
    if (wlaczony) { console.log('[sniff] już działa'); return; }
    wlaczony = true;
    start = Date.now();
    zapisy.length = 0;
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
            body: skroc(typeof body === 'string' ? body : (body ? '[' + String(body) + ']' : '')),
            status: res.status, odpowiedz: skroc(txt)
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
          try { odp = this.responseType === '' || this.responseType === 'text' ? this.responseText : '[' + this.responseType + ']'; } catch (e) { odp = '[nieczytelna]'; }
          dodaj({
            zrodlo: 'xhr', method: s.method, url: s.url, naglowki: s.naglowki,
            body: skroc(typeof body === 'string' ? body : (body ? '[' + String(body) + ']' : '')),
            status: this.status, odpowiedz: skroc(odp)
          });
        });
      }
      return origSend.apply(this, arguments);
    };

    console.log('[sniff] nagrywam' + (wszystkie ? ' WSZYSTKO' : ' tylko zapisy (POST/PUT/PATCH/DELETE)')
      + '. Zrób zapis w ERP, potem: savpolSniffCopy()');
  };

  window.savpolSniffStop = function () {
    window.fetch = origFetch;
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
    XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
    wlaczony = false;
    console.log('[sniff] zatrzymane, nagranych: ' + zapisy.length);
  };

  window.savpolSniffText = function () {
    const linie = [];
    linie.push('Savpol ERP — nagranie żądań zapisu');
    linie.push('URL: ' + location.href);
    linie.push('Data: ' + new Date().toISOString());
    linie.push('Żądań: ' + zapisy.length);
    linie.push('');
    zapisy.forEach((r, i) => {
      linie.push('===== #' + i + '  [' + r.t + ']  ' + r.method + ' (' + r.zrodlo + ') → ' + r.status + ' =====');
      linie.push('URL: ' + r.url);
      const nag = Object.keys(r.naglowki);
      if (nag.length) linie.push('Nagłówki: ' + nag.map(k => k + ': ' + r.naglowki[k]).join(' | '));
      linie.push('--- ciało żądania ---');
      linie.push(r.body || '(puste)');
      linie.push('--- odpowiedź ---');
      linie.push(r.odpowiedz || '(pusta)');
      linie.push('');
    });
    return linie.join('\n');
  };

  // Wynik idzie do schowka sam — użytkownik nie zaznacza niczego w konsoli.
  // Kolejność prób jak w CLAUDE.md: copy() z DevTools działa zawsze i nie
  // wymaga focusu strony, reszta to zapas.
  window.savpolSniffCopy = function () {
    const txt = window.savpolSniffText();
    try {
      if (typeof copy === 'function') { copy(txt); console.log('[sniff] skopiowano, ' + txt.length + ' znaków'); return; }
    } catch (e) { /* lecimy dalej */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt)
        .then(() => console.log('[sniff] skopiowano, ' + txt.length + ' znaków'))
        .catch(() => zapasowoDoSchowka(txt));
      return;
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
                   : '[sniff] NIE UDAŁO SIĘ skopiować — użyj: copy(savpolSniffText())');
  }

  console.log('[sniff] gotowe. savpolSniffStart() → zapisz w ERP → savpolSniffCopy()');
})();
