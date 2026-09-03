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
//   4. Wynik sam wyląduje w schowku — wklej do rozmowy.

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
    let zrobione = false;

    XMLHttpRequest.prototype.open = function (m, u) {
      this.__url = u;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (!zrobione && typeof body === 'string' && String(this.__url || '').indexOf(ENDPOINT) >= 0) {
        zrobione = true;
        XMLHttpRequest.prototype.send = origSend;
        XMLHttpRequest.prototype.open = origOpen;
        setTimeout(() => zbadaj(body), 0);
      }
      return origSend.apply(this, arguments);
    };

    console.log('[test] czekam na żądanie ERP — poklikaj po zakładkach karty produktu');
  };

  async function zbadaj(wzorzec) {
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
      doSchowka(linie.join('\n'));
      return;
    }

    const bezHasla = jsonSrodka.replace(/("Password"\s*:\s*)"(?:[^"\\]|\\.)*"/i, '$1""');
    const zmieniono = bezHasla !== jsonSrodka;
    linie.push('Hasło znalezione i wyczyszczone w kopii: ' + (zmieniono ? 'tak' : 'NIE (wzorzec go nie zawierał)'));

    // 1. Payload bez pakowania, z hasłem — sprawdza samą flagę Compress.
    naglowek('1. Compress:false, hasło zostawione');
    const a = await wyslij(JSON.stringify({
      DictIdent: paczka.DictIdent, Input: jsonSrodka, Compress: false
    }));
    linie.push(ocena(a));
    linie.push(odchudz(a.tekst));

    // 2. To samo, ale z pustym hasłem — właściwe pytanie testu.
    naglowek('2. Compress:false, hasło PUSTE');
    const b = await wyslij(JSON.stringify({
      DictIdent: paczka.DictIdent, Input: bezHasla, Compress: false
    }));
    linie.push(ocena(b));
    linie.push(odchudz(b.tekst));

    // 3. Oryginał w całości — punkt odniesienia. Gdyby padł, to znaczy że
    //    zepsuło się coś poza testem (wygasła sesja, zmienił się QueryUID)
    //    i wyników 1-2 nie wolno interpretować.
    naglowek('3. Oryginalny payload bez zmian (punkt odniesienia)');
    const c = await wyslij(wzorzec);
    linie.push(ocena(c));

    naglowek('WNIOSEK');
    if (ocena(c) !== 'PRZYJĘTE') {
      linie.push('Punkt odniesienia padł — test nierozstrzygający, powtórz.');
    } else if (ocena(b) === 'PRZYJĘTE') {
      linie.push('Hasło NIE jest wymagane — wystarcza sesja. Droga przez API otwarta.');
    } else if (ocena(a) === 'PRZYJĘTE') {
      linie.push('Hasło JEST wymagane (bez niego odmowa), ale ZIP nie jest.');
    } else {
      linie.push('Serwer odrzucił payload bez ZIP-a — flagi Compress nie da się pominąć.');
    }

    doSchowka(linie.join('\n'));
  }

  function doSchowka(txt) {
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

  console.log('[test] gotowe. Uruchom: savpolTestHasla()');
})();
