// Czy ERP wymaga hasła w payloadzie, czy wystarczy sesja? — wklej w konsolę.
//
// PO CO TO: ERP dokleja `LoginInfo` z loginem i hasłem otwartym tekstem do
// KAŻDEGO żądania. Jeśli serwer faktycznie to hasło sprawdza, skrypt musiałby
// je przechowywać — a to łamie zasadę, na której stoi cała integracja
// (skrypt nie trzyma żadnego sekretu). Wtedy droga przez API odpada i zapis
// opisów musi iść przez pola w DOM.
//
// Jeśli natomiast serwerowi wystarcza ciasteczko sesji i SessionId, to zapis
// przez API jest wykonalny i wolny od całej klasy błędów z myleniem zakładek.
//
// TEST JEST NA ODCZYCIE, NIE NA ZAPISIE. Powtarza żądanie, które strona
// wysłała sama, z wyczyszczonym hasłem, i patrzy tylko na odpowiedź. Niczego
// nie zmienia w ERP.
//
// Przy okazji sprawdza drugą rzecz: czy da się wysłać payload BEZ pakowania
// do ZIP-a (flaga `Compress`). Jeśli tak, implementacja robi się dużo prostsza.
//
// Jak używać:
//   1. Otwórz kartę produktu w ERP i wklej ten plik w konsolę.
//   2. savpolTestHasla()
//   3. Poklikaj po zakładkach karty, żeby ERP wysłał jakiekolwiek żądanie.
//   4. savpolTestKopiuj()  → wynik do schowka, wklej do rozmowy.
//
// Wynik NIE trafia do schowka sam z siebie. Test chodzi w tle, kiedy pracujesz
// w ERP i sam używasz schowka — samoczynne kopiowanie zniszczyłoby to, co masz
// przygotowane do wklejenia (albo zostałoby przez to nadpisane).

(function () {
  'use strict';

  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke';
  const WRAZLIWE = /("(?:Password|Pwd|Haslo|Hasło|Token|AccessToken|ApiKey)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
  const odchudz = s => String(s).replace(WRAZLIWE, '$1"[USUNIĘTE]"');

  function rozpakuj(b64) {
    let surowy;
    try { surowy = atob(b64); } catch (e) { return null; }
    const od = surowy.indexOf('{');
    const doo = surowy.lastIndexOf('}');
    return (od < 0 || doo <= od) ? null : surowy.slice(od, doo + 1);
  }

  // `Compress:false` nie znaczy „przyjmij goły JSON" — serwer nadal dekoduje
  // Input z base64, tylko pomija rozpakowanie ZIP-a. Pierwsza wersja testu
  // wysyłała czysty tekst i dostawała „dane wejściowe nie są prawidłowym
  // ciągiem Base-64", czyli odpowiedź na pytanie, którego nie zadawaliśmy.
  //
  // btoa() przyjmuje znaki 0-255, a rozpakuj() oddaje dokładnie taki ciąg
  // bajtów (atob nie dotyka kodowania), więc obieg tam i z powrotem jest
  // wierny co do bajtu - także dla polskich znaków w treści.
  function zapakuj(json) {
    try { return btoa(json); } catch (e) { return null; }
  }

  function wyslij(body) {
    return new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.open('POST', location.origin + ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      x.onloadend = () => resolve({ status: x.status, tekst: (x.responseText || '').slice(0, 1500) });
      x.onerror = () => resolve({ status: 0, tekst: '(błąd sieci)' });
      x.send(body);
    });
  }

  // Odpowiedź „udana" to nie samo HTTP 200. ERP potrafi oddać 200 z wypełnionym
  // polem Error albo z ExceptionTransport — i to jest właśnie odmowa.
  function ocena(o) {
    if (o.status !== 200) return 'ODRZUCONE (HTTP ' + o.status + ')';
    const maBlad = /"Error"\s*:\s*(?!null)/.test(o.tekst)
                || /"ExceptionTransport"\s*:\s*(?!null)/.test(o.tekst)
                || /SSOUrl4Login"\s*:\s*"[^"]/.test(o.tekst);
    return maBlad ? 'ODRZUCONE (200, ale błąd w treści)' : 'PRZYJĘTE';
  }

  window.savpolTestHasla = function () {
    const origSend = XMLHttpRequest.prototype.send;
    const origOpen = XMLHttpRequest.prototype.open;
    const origFetch = window.fetch;
    let zrobione = false;

    function odepnij() {
      XMLHttpRequest.prototype.send = origSend;
      XMLHttpRequest.prototype.open = origOpen;
      window.fetch = origFetch;
    }

    function zlap(body, url) {
      if (zrobione || typeof body !== 'string') return;
      if (String(url || '').indexOf(ENDPOINT) < 0) return;
      zrobione = true;
      odepnij();
      console.log('[test] złapałem żądanie, badam…');
      setTimeout(() => zbadaj(body), 0);
    }

    XMLHttpRequest.prototype.open = function (m, u) {
      this.__url = u;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try { zlap(body, this.__url); } catch (e) { console.warn('[test] hook xhr:', e); }
      return origSend.apply(this, arguments);
    };
    // Dokładamy fetch: ERP używa XHR, ale to kosztuje trzy linijki, a gdyby
    // dostawca przeszedł na fetch, test milczałby bez wyjaśnienia.
    window.fetch = function (input, init) {
      try {
        const u = typeof input === 'string' ? input : (input && input.url);
        zlap(init && init.body, u);
      } catch (e) { /* nieistotne */ }
      return origFetch.apply(this, arguments);
    };

    // Cisza jest najgorszym wynikiem — po 30 s mówimy wprost, że nie było
    // czego złapać, zamiast zostawiać użytkownika z pustą konsolą.
    setTimeout(() => {
      if (!zrobione) {
        odepnij();
        console.warn('[test] przez 30 s nie poszło ŻADNE żądanie do ' + ENDPOINT
          + '. Odpal savpolTestHasla() jeszcze raz i kliknij w inną zakładkę karty '
          + 'produktu (samo najechanie myszą nie wystarczy).');
      }
    }, 30000);

    console.log('[test] czekam na żądanie ERP — poklikaj po zakładkach karty produktu');
  };

  async function zbadaj(wzorzec) {
    try {
      await zbadajWlasciwe(wzorzec);
    } catch (e) {
      // Bez tego wyjątek w środku async funkcji odrzucał promise po cichu:
      // konsola milczała, schowek zostawał pusty i nie było wiadomo dlaczego.
      const opis = 'Test przerwany błędem: ' + (e && e.stack || e);
      console.error('[test] ' + opis);
      odloz(opis);
    }
  }

  async function zbadajWlasciwe(wzorzec) {
    const linie = [];
    const naglowek = (t) => { linie.push(''); linie.push('=== ' + t + ' ==='); };

    linie.push('Savpol ERP — czy hasło w payloadzie jest wymagane');
    linie.push('URL: ' + location.href);
    linie.push('Data: ' + new Date().toISOString());

    let paczka;
    try { paczka = JSON.parse(wzorzec); } catch (e) { paczka = null; }
    const jsonSrodka = paczka && paczka.Input ? rozpakuj(paczka.Input) : null;

    if (!jsonSrodka) {
      linie.push('');
      linie.push('NIE UDAŁO SIĘ rozpakować payloadu — reszta testu bez sensu.');
      odloz(linie.join('\n'));
      return;
    }

    const bezHasla = jsonSrodka.replace(/("Password"\s*:\s*)"(?:[^"\\]|\\.)*"/i, '$1""');
    const zmieniono = bezHasla !== jsonSrodka;
    linie.push('Hasło znalezione i wyczyszczone w kopii: ' + (zmieniono ? 'tak' : 'NIE (wzorzec go nie zawierał)'));

    const b64Pelny = zapakuj(jsonSrodka);
    const b64BezHasla = zapakuj(bezHasla);
    if (!b64Pelny || !b64BezHasla) {
      linie.push('');
      linie.push('NIE UDAŁO SIĘ zakodować payloadu do base64 — reszta bez sensu.');
      odloz(linie.join('\n'));
      return;
    }

    // 1. Bez ZIP-a, ale w base64, z hasłem. Sprawdza samą flagę Compress:
    //    jeśli to przejdzie, implementacja nie musi umieć pakować ZIP-a.
    naglowek('1. Compress:false + base64, hasło zostawione');
    const a = await wyslij(JSON.stringify({
      DictIdent: paczka.DictIdent, Input: b64Pelny, Compress: false
    }));
    linie.push(ocena(a));
    linie.push(odchudz(a.tekst).slice(0, 400));

    // 2. To samo, ale z pustym hasłem — właściwe pytanie testu.
    naglowek('2. Compress:false + base64, hasło PUSTE');
    const b = await wyslij(JSON.stringify({
      DictIdent: paczka.DictIdent, Input: b64BezHasla, Compress: false
    }));
    linie.push(ocena(b));
    linie.push(odchudz(b.tekst).slice(0, 400));

    // 3. Gdyby serwer nie chciał rozmawiać bez ZIP-a, pytanie o hasło i tak
    //    zostaje otwarte — więc powtarzamy je na ORYGINALNEJ paczce, podmieniając
    //    hasło w środku. ZIP jest tu zapisany bez kompresji, a hasło ma stałą
    //    długość, więc podmiana znak w znak nie rusza rozmiarów ani CRC.
    let c2 = null;
    if (ocena(b) !== 'PRZYJĘTE') {
      const tejSamejDlugosci = jsonSrodka.replace(
        /("Password"\s*:\s*")([^"\\]*)(")/i,
        (m, p, tresc, k) => p + 'x'.repeat(tresc.length) + k);
      if (tejSamejDlugosci !== jsonSrodka) {
        naglowek('3. Oryginalny ZIP, hasło podmienione na błędne (ta sama długość)');
        const surowyZip = atob(paczka.Input);
        const podmieniony = surowyZip.replace(jsonSrodka, tejSamejDlugosci);
        c2 = await wyslij(JSON.stringify({
          DictIdent: paczka.DictIdent, Input: btoa(podmieniony), Compress: true
        }));
        linie.push(ocena(c2));
        linie.push(odchudz(c2.tekst).slice(0, 400));
      }
    }

    // 3. Oryginał w całości — punkt odniesienia. Gdyby padł, to znaczy że
    //    zepsuło się coś poza testem (wygasła sesja, zmienił się QueryUID)
    //    i wyników 1-2 nie wolno interpretować.
    naglowek('4. Oryginalny payload bez zmian (punkt odniesienia)');
    const c = await wyslij(wzorzec);
    linie.push(ocena(c));

    naglowek('WNIOSEK');
    if (ocena(c) !== 'PRZYJĘTE') {
      linie.push('Punkt odniesienia padł — test nierozstrzygający, powtórz.');
    } else if (ocena(b) === 'PRZYJĘTE') {
      linie.push('Hasło NIE jest wymagane, ZIP też nie. Droga przez API otwarta i prosta.');
    } else if (c2 && ocena(c2) === 'PRZYJĘTE') {
      linie.push('Hasło NIE jest sprawdzane (błędne przeszło) — wystarcza sesja,');
      linie.push('ale payload musi być spakowany do ZIP-a.');
    } else if (c2) {
      linie.push('Hasło JEST sprawdzane — błędne zostało odrzucone.');
      linie.push('Skrypt musiałby je przechowywać, więc droga przez API odpada.');
    } else if (ocena(a) === 'PRZYJĘTE') {
      linie.push('Hasło JEST wymagane (puste odrzucone), ale ZIP nie jest.');
    } else {
      linie.push('Serwer nie przyjął payloadu bez ZIP-a i nie dało się podmienić hasła.');
      linie.push('Test nierozstrzygający.');
    }

    odloz(linie.join('\n'));
  }

  // NIE KOPIUJEMY SAMI. Ten test trwa w tle, kiedy użytkownik pracuje w ERP
  // i sam używa schowka do przeklejania opisów — wynik wskoczyłby mu pod ręce
  // i zaraz zostałby nadpisany, albo odwrotnie: zniszczyłby to, co miał
  // przygotowane. Zdarzyło się dokładnie to. Zrzut na koniec pracy może
  // kopiować od razu (podglad-zapisu-erp.js), test w tle - nie.
  function odloz(txt) {
    window.savpolTestWynik = txt;
    window.savpolTestKopiuj = function () { doSchowka(txt); return '(' + txt.length + ' znaków)'; };
    console.log('%c[test] WYNIK GOTOWY (' + txt.length + ' znaków) — po niego: savpolTestKopiuj()',
      'font-weight:bold');
  }

  function doSchowka(txt) {
    // Wynik i tak najpierw ląduje w zmiennej: copy() z DevTools jest widoczne
    // tylko przy wywołaniu prosto z konsoli, a clipboard API odmawia, gdy
    // focus siedzi w DevTools. Bez tego wynik potrafił przepaść bez śladu.
    window.savpolTestWynik = txt;

    try {
      if (typeof copy === 'function') { copy(txt); console.log('[test] skopiowano, ' + txt.length + ' znaków'); return; }
    } catch (e) { /* lecimy dalej */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt)
        .then(() => console.log('[test] skopiowano, ' + txt.length + ' znaków'))
        .catch(() => zapasowo(txt));
      return;
    }
    zapasowo(txt);
  }

  function zapasowo(txt) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    console.log(ok ? '[test] skopiowano, ' + txt.length + ' znaków'
                   : '[test] NIE UDAŁO SIĘ skopiować — użyj: copy(savpolTestWynik)');
  }

  console.log('[test] gotowe. Uruchom: savpolTestHasla(). Wynik NIE trafi sam do schowka — po niego savpolTestKopiuj()');
})();
