// Sonda: czy skrypt pobierze specyfikację PDF sam, przez API? — wklej w konsolę.
// WERSJA: 2026-09-03.5
//            Konsola wypisuje ja po wklejeniu — jesli tam widzisz
//            inny numer, w przegladarce siedzi starsza kopia.
//
// PO CO: chcemy, żeby skrypt sam ściągał specyfikację i wysyłał ją do apki,
// zamiast żebyś przeklejał PDF ręcznie. Zanim to trafi do skryptu na stałe,
// trzeba potwierdzić trzy rzeczy, których nie da się rozstrzygnąć z nagrań:
//
//   1. Czy da się WYWOŁAĆ API, powtarzając kopertę z żądania, które strona
//      wysłała sama (SID, SessionId, identyfikator widoku).
//   2. Czy odczyt listy załączników przechodzi z WŁASNYM QueryUID.
//   3. Czy złożony URL faktycznie oddaje plik.
//
// SONDA NICZEGO NIE ZAPISUJE. Czyta listę załączników, pyta o najnowszą wersję
// i pobiera plik do pamięci, żeby zmierzyć rozmiar. Nic nie ląduje na dysku
// ani w ERP.
//
// Jak używać:
//   1. Otwórz kartę produktu w ERP (dowolną zakładkę) i wklej ten plik.
//   2. savpolSondaSpec()
//   3. Wejdź na karcie produktu w zakładkę ZAŁĄCZNIKI. Sonda potrzebuje
//      kliknięcia, po którym ERP naprawdę czyta dane, a nie tylko przerysowuje
//      ekran — ta zakładka zawsze idzie po dane. Potem rusza sama.
//   4. savpolSondaKopiuj()  → wynik do schowka.
//
// Wynik ma wycięte hasło, ale ZOSTAWIA SID (bez niego nie widać, czy adres
// pliku był poprawny). Traktuj go jak dane sesji: nie wrzucaj do repo.

(function () {
  'use strict';

  const WERSJA = '2026-09-03.5';

  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke';
  const TYP_SPECYFIKACJI = '1b5d6bfc-8585-4056-c57d-1a89ab4b3fd0';
  const WRAZLIWE = /("(?:Password|Pwd|Haslo|Hasło)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;
  const odchudz = s => String(s).replace(WRAZLIWE, '$1"[USUNIĘTE]"');

  let linie = [];
  const log = (t) => { linie.push(t); console.log('[sonda] ' + t); };
  const naglowek = (t) => { linie.push(''); linie.push('=== ' + t + ' ==='); };

  // Funkcja kopiująca istnieje OD RAZU, nie dopiero po udanym przebiegu.
  // Wcześniej powstawała na końcu, więc gdy sonda nie ruszyła, użytkownik
  // dostawał „savpolSondaKopiuj is not defined" i nie miał czego przysłać —
  // czyli akurat w sytuacji, w której wynik jest najbardziej potrzebny.
  window.savpolSondaWynik = '(sonda jeszcze nie ruszyła)';
  window.savpolSondaKopiuj = function () {
    const s = window.savpolSondaWynik;
    try { if (typeof copy === 'function') { copy(s); return '(skopiowano ' + s.length + ' znaków)'; } } catch (e) { /* niżej */ }
    if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {});
    return '(skopiowano ' + s.length + ' znaków)';
  };

  function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function rozpakujB64(b64) {
    let s;
    try { s = atob(b64); } catch (e) { return null; }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    return (a < 0 || b <= a) ? null : s.slice(a, b + 1);
  }

  // Odpowiedzi ERP to base64 ZIP-a spakowanego deflate, w dodatku zapisanego
  // strumieniowo (rozmiary 0xFFFFFFFF). Rozpakowujemy przez DecompressionStream,
  // wycinając nagłówek ZIP-a ręcznie — biblioteki nie mamy i nie chcemy.
  async function rozpakujOdpowiedz(b64) {
    const sur = atob(b64);
    const bajty = Uint8Array.from(sur, c => c.charCodeAt(0));
    if (bajty[0] !== 0x50 || bajty[1] !== 0x4b) return null;
    const metoda = bajty[8] | (bajty[9] << 8);
    const start = 30 + (bajty[26] | (bajty[27] << 8)) + (bajty[28] | (bajty[29] << 8));
    const dane = bajty.slice(start);
    if (metoda === 0) return new TextDecoder().decode(dane);
    if (typeof DecompressionStream !== 'function') return null;
    const st = new Blob([dane]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(st).text();
  }

  function wyslij(body) {
    return new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.open('POST', location.origin + ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
      x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      x.onloadend = () => resolve({ status: x.status, tekst: x.responseText || '' });
      x.onerror = () => resolve({ status: 0, tekst: '' });
      x.send(body);
    });
  }

  // Wysyłamy bez ZIP-a: Compress:false + base64 samego JSON-a. Sprawdzone
  // wcześniej (test-czy-haslo-potrzebne.js), działa i nie wymaga pakowania.
  async function wywolaj(koperta, operacja) {
    const paczka = JSON.parse(JSON.stringify(koperta));
    paczka.OperationInvokeInput = Object.assign(
      {}, paczka.OperationInvokeInput, operacja);
    // Hasła nie wysyłamy — serwer go nie sprawdza, a nie ma powodu, żeby
    // krążyło po sieci częściej, niż musi.
    if (paczka.LoginInfo) paczka.LoginInfo.Password = '';
    const odp = await wyslij(JSON.stringify({
      DictIdent: 'csItemsOneBro', Input: btoa(JSON.stringify(paczka)), Compress: false
    }));
    let blad = null;
    try {
      const j = JSON.parse(odp.tekst);
      blad = j.Error || null;
      if (!blad && j.JSONResult) {
        return { ok: true, tresc: await rozpakujOdpowiedz(j.JSONResult) };
      }
    } catch (e) { blad = 'nieczytelna odpowiedź'; }
    return { ok: false, blad: blad || ('HTTP ' + odp.status), surowa: odp.tekst.slice(0, 300) };
  }

  // Siatki wracają jako FieldDefs + Rows (tablica {Item:...}), więc zamieniamy
  // je na zwykłe obiekty, żeby dalej pracować po nazwach kolumn.
  function naObiekty(dt) {
    if (!dt || !dt.FieldDefs || !dt.Rows) return [];
    const nazwy = dt.FieldDefs.map(f => f.FieldName);
    return dt.Rows.map(r => {
      const o = {};
      r.forEach((k, i) => { o[nazwy[i]] = k && 'Item' in k ? k.Item : k; });
      return o;
    });
  }

  function znajdzSiatke(obj, ident, glebokosc) {
    if (!obj || typeof obj !== 'object' || (glebokosc || 0) > 12) return null;
    if (obj.DataSetSQLIdent === ident && obj.DataTable) return obj.DataTable;
    for (const k of Object.keys(obj)) {
      const w = znajdzSiatke(obj[k], ident, (glebokosc || 0) + 1);
      if (w) return w;
    }
    return null;
  }

  // ERP nie czyta siatki „w próżni" — żądanie musi nieść ze sobą STAN zestawów
  // powiązanych. Odkrywaliśmy to warstwami, bo serwer wypuszcza po jednym
  // brakującym naraz:
  //
  //   1. „Brakujący: cssuplangmasterdata (IsMasterData: True)"  — słownik języka
  //   2. „Brakujący: csitems (IsMasterData: False)"             — sam produkt
  //
  // Drugi przypadek jest logiczny: załączniki są dzieckiem produktu, więc bez
  // wiersza rodzica serwer nie wie, czyje załączniki czytać. Zamiast dokładać
  // je po jednym, zbieramy WSZYSTKIE zestawy, których stan strona przekazuje,
  // i odsyłamy komplet.
  //
  // Zbieramy z żywych żądań zamiast wpisywać na sztywno: ParentUniqName zmienia
  // się między sesjami, a wiersz csItems dotyczy akurat otwartego produktu —
  // twarde wartości byłyby złe i przestarzałe.
  const kontekst = {};

  function zbierzKontekst(koperta) {
    const lista = koperta && koperta.OperationInvokeInput
      && koperta.OperationInvokeInput.RefreshInputObject
      && koperta.OperationInvokeInput.RefreshInputObject.DataTableInitList;
    if (!lista) return 0;
    let n = 0;
    Object.keys(lista).forEach(k => {
      const w = lista[k];
      if (!w || typeof w !== 'object' || !w.DataTableInit) return;
      const id = String(w.DataSetSQLIdent || '');
      if (!id) return;
      if (!kontekst[id]) n++;
      kontekst[id] = w;   // nowszy stan wypiera starszy
    });
    return n;
  }

  async function przebieg(koperta) {
    const wej = koperta.OperationInvokeInput || {};
    const rodzic = (wej.RefreshInputObject && wej.RefreshInputObject.ParentUniqName) || null;

    naglowek('1. Koperta przechwycona');
    log('SID: ' + (wej.SID || '(brak)'));
    log('SessionId: ' + (wej.SessionId || '(brak)'));
    log('CompaniesId: ' + (wej.CompaniesId || '(brak)'));
    log('CPG: ' + ((koperta.LoginInfo && koperta.LoginInfo.CPG) || '(brak)'));
    log('ParentUniqName (widok): ' + (rodzic || '(brak — spróbuję bez niego)'));
    const nazwyKtx = Object.keys(kontekst);
    log('zebrany kontekst: ' + (nazwyKtx.length ? nazwyKtx.join(', ') : '(NIC)'));
    const produkt = kontekst.csItems && naObiekty(kontekst.csItems.DataTableInit.DataTable)[0];
    if (produkt) log('produkt w kontekście: ' + produkt.Item + ' (csItemsId=' + produkt.csItemsId + ')');

    naglowek('2. Odczyt listy załączników');
    // NIE WYSYŁAMY CAŁEGO ZEBRANEGO KONTEKSTU. Próba „damy serwerowi wszystko,
    // to na pewno nie zabraknie" skończyła się po jego stronie wyjątkiem
    // (Odwołanie do obiektu nie zostało ustawione…) — 32 zestawy, w tym masa
    // formularzy edycyjnych, to dla niego bełkot.
    //
    // Odtwarzamy dokładnie ten zestaw, który wysyła sama strona przy wejściu
    // na zakładkę Załączniki: dwie siatki do odczytu i dwa zestawy stanu.
    const POTRZEBNE = ['csSupLangMasterData', 'csItems'];
    const brakujace = POTRZEBNE.filter(id => !kontekst[id]);
    if (brakujace.length) {
      log('brak w kontekście: ' + brakujace.join(', ') + ' — przerywam.');
      return koniec();
    }

    const tablice = {};
    let i = 0;
    // Najpierw to, co ma wrócić z serwera…
    tablice[String(i++)] = {
      DataSetSQLIdent: 'csAttachments', SortList: [], DataTableInit: null,
      Refresh: true, PageSizeFromClient: 100, PageActual: 0,
      SelectStmType: 2, QueryUID: guid(), KeepPage: false
    };
    tablice[String(i++)] = {
      DataSetSQLIdent: 'csAttachmentsVersions',
      SortList: [
        { Alias: null, CaptionGuid: null, DefaultDirectSort: 2, DirectSort: 0, FieldName: 'ValidTo' },
        { Alias: null, CaptionGuid: null, DefaultDirectSort: 2, DirectSort: 0, FieldName: 'VersionId' }
      ],
      DataTableInit: null, Refresh: true, PageSizeFromClient: 21, PageActual: 0,
      SelectStmType: 2, QueryUID: guid(), KeepPage: false
    };
    // …potem stan, który serwer musi znać, żeby wiedzieć czyje i w jakim języku.
    POTRZEBNE.forEach(id => { tablice[String(i++)] = kontekst[id]; });
    tablice.length = i;
    log('wysyłam zestawy: csAttachments, csAttachmentsVersions, ' + POTRZEBNE.join(', '));

    const lista = await wywolaj(koperta, {
      OperationName: 'RefreshDataSetSQL_Synchronous',
      Params: { DictIdent: 'csItemsOneBro', LoginProviderObject: null },
      DelegateIdent: guid(),
      RefreshInputObject: {
        ParentUniqName: rodzic, ParentIdent: 'csItemsOneBro',
        DataTableInitList: tablice
      }
    });
    if (!lista.ok) {
      log('NIE UDAŁO SIĘ: ' + lista.blad);
      log(lista.surowa || '');
      // Serwer sam nazywa brakujący element — wyłuskujemy to zamiast kazać
      // człowiekowi czytać zlepiony komunikat z \r\n w środku.
      const brak = /Brakuj\S*:\s*([a-z0-9_]+)/i.exec(String(lista.blad || ''));
      if (brak) {
        log('→ serwer mówi, czego brakuje: ' + brak[1]);
        log('→ to nie jest problem z SID/SessionId — koperta przeszła.');
        log('→ dołóż ten zestaw do master data (kliknij zakładkę, która go używa,');
        log('   sonda zbierze go z żywego żądania) i powtórz.');
      } else {
        log('→ komunikat bez nazwy brakującego zestawu; patrz surowa odpowiedź.');
      }
      return koniec();
    }
    let dane;
    try { dane = JSON.parse(lista.tresc); } catch (e) { dane = null; }
    const siatka = znajdzSiatke(dane, 'csAttachments') || znajdzSiatke(dane, null);
    const wiersze = naObiekty(siatka);
    log('wierszy załączników: ' + wiersze.length);
    wiersze.forEach(w => log('  typ=' + (w.AttachmentTypeTranslatedDesc || w.csAttachmentsTypesG)
      + ' | plik=' + w.LocalFileName + ' | wersja=' + w.VersionId + ' | dodano=' + w.AddDate));

    naglowek('3. Wybór specyfikacji');
    const spec = wiersze
      .filter(w => String(w.csAttachmentsTypesG || '').toLowerCase() === TYP_SPECYFIKACJI)
      .sort((a, b) => String(b.AddDate || '').localeCompare(String(a.AddDate || '')));
    if (!spec.length) {
      log('brak załącznika typu „specyfikacja" — dla tego produktu to normalne,');
      log('skrypt ma wtedy powiedzieć wprost, że specyfikacji nie ma.');
      return koniec();
    }
    log('kandydatów: ' + spec.length + ', biorę najnowszy (' + spec[0].AddDate + ')');
    const w = spec[0];
    log('csAttachmentsId=' + w.csAttachmentsId + ' csAttachmentsG=' + w.csAttachmentsG);

    naglowek('4. Pytanie o najnowszą wersję');
    const akcja = await wywolaj(koperta, {
      OperationName: 'ActionExecute',
      Params: {
        DictIdent: 'csItemsOneBro',
        ActionIdent: 'csAttachmentsSaveToFileLastVersion',
        DataSetTypeIdent: 'csAttachments',
        __StartField__: 'FileDesc',
        __SelectedRecords__: '<csSelectedRows><row><csAttachmentsG>' + w.csAttachmentsG
          + '</csAttachmentsG></row></csSelectedRows>',
        __PageRecords__: '<csPageRecords><row></row></csPageRecords>',
        __SortList__: '<SortList></SortList>',
        HasParams: '0', ActionExecuteType: 0, LoginProviderObject: null
      },
      DelegateIdent: guid(),
      RefreshInputObject: null,
      DataTableInitList: {
        '0': {
          DataSetSQLIdent: 'ActiveRecord', SortList: [],
          DataTableInit: {
            DataTable: {
              FieldDefs: [{ Index: 0, FieldName: 'csAttachmentsId', FieldType: 'number', OriginalFieldType: 'System.Int64' }],
              Rows: [[{ Item: w.csAttachmentsId }]]
            }
          },
          Refresh: false
        },
        length: 1
      }
    });
    if (!akcja.ok) {
      log('NIE UDAŁO SIĘ: ' + akcja.blad);
      log(akcja.surowa || '');
      return koniec();
    }
    let info = null;
    try {
      const j = JSON.parse(akcja.tresc);
      info = j.OperationInvokeResult && j.OperationInvokeResult.RemoteFileInfoList
        && j.OperationInvokeResult.RemoteFileInfoList[0];
    } catch (e) { /* niżej */ }
    if (!info || !info.FileIdent) {
      log('odpowiedź bez FileIdent — sprawdź surową treść w savpolSondaOdp');
      window.savpolSondaOdp = akcja.tresc;
      return koniec();
    }
    log('FileIdent: ' + info.FileIdent);
    log('FileName:  ' + info.FileName);
    log('czy FileIdent = RemoteIdent wielkimi literami: '
      + (String(w.RemoteIdent || '').toUpperCase() === String(info.FileIdent).toUpperCase()
         ? 'tak' : 'NIE — dobrze, że nie poszliśmy na skróty'));

    naglowek('5. Pobranie pliku');
    const cpg = koperta.LoginInfo && koperta.LoginInfo.CPG;
    const url = location.origin + '/api/attachment/get/' + cpg + '/OpenFileIdent/'
      + btoa(info.FileIdent) + '/' + encodeURIComponent(info.FileName)
      + '?SID=' + wej.SID;
    log('URL: ' + url);
    try {
      const r = await fetch(url, { credentials: 'include' });
      const buf = await r.arrayBuffer();
      const naglowekPliku = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
      log('HTTP ' + r.status + ' | typ: ' + (r.headers.get('content-type') || '?')
        + ' | bajtów: ' + buf.byteLength);
      log('sygnatura: "' + naglowekPliku + '"' + (naglowekPliku.indexOf('%PDF') === 0
        ? '  → to PDF, komplet działa' : '  → NIE PDF, coś poszło nie tak'));
    } catch (e) {
      log('pobranie padło: ' + (e && e.message || e));
    }
    koniec();
  }

  function koniec() {
    naglowek('WNIOSEK');
    const t = linie.join('\n');
    if (t.indexOf('to PDF, komplet działa') >= 0) {
      linie.push('Cały łańcuch przechodzi — mogę to wbudować w skrypt.');
    } else {
      linie.push('Łańcuch przerwany, patrz wyżej. Wynik jest w savpolSondaWynik.');
    }
    window.savpolSondaWynik = odchudz(linie.join('\n'));
    console.log('%c[sonda] GOTOWE — po wynik: savpolSondaKopiuj()', 'font-weight:bold');
  }

  window.savpolSondaSpec = function () {
    const origSend = XMLHttpRequest.prototype.send;
    const origOpen = XMLHttpRequest.prototype.open;
    let ruszone = false;
    let kopertaZRodzicem = null;

    function odepnij() {
      XMLHttpRequest.prototype.send = origSend;
      XMLHttpRequest.prototype.open = origOpen;
    }

    // Nie startujemy z pierwszego lepszego żądania. Potrzebujemy koperty,
    // która MA ParentUniqName (czyli pochodzi z odczytu, nie z akcji), oraz
    // przynajmniej jednego zestawu master data. Jedno żądanie rzadko ma oba,
    // więc słuchamy dalej, aż komplet się uzbiera.
    function rozwaz(koperta) {
      zbierzKontekst(koperta);
      const rodzic = koperta.OperationInvokeInput
        && koperta.OperationInvokeInput.RefreshInputObject
        && koperta.OperationInvokeInput.RefreshInputObject.ParentUniqName;
      if (rodzic && !kopertaZRodzicem) kopertaZRodzicem = koperta;

      // Komunikat po ludzku, nie nazwami pól z ERP. „Koperta" i „csItems" nic
      // nie mówią osobie, która ma tylko kliknąć w zakładkę.
      console.log('[sonda] mam: dane sesji=' + (kopertaZRodzicem ? 'TAK' : 'nie')
        + ', dane produktu=' + (kontekst.csItems ? 'TAK' : 'nie')
        + '  (zebranych zestawów: ' + Object.keys(kontekst).length + ')');

      // Bez csItems serwer nie wie, czyich zalacznikow szukamy, wiec to
      // on jest warunkiem startu, nie sama liczba zebranych zestawow.
      if (!ruszone && kopertaZRodzicem && kontekst.csItems) {
        ruszone = true;
        odepnij();
        console.log('[sonda] mam komplet, ruszam…');
        setTimeout(() => przebieg(kopertaZRodzicem).catch(e => {
          linie.push('Sonda przerwana błędem: ' + (e && e.stack || e));
          koniec();
        }), 0);
      }
    }

    // Liczymy WSZYSTKIE żądania, nie tylko pasujące. Bez tego „nic nie
    // przechwyciłem" ma dwa zupełnie różne znaczenia: albo klikasz w miejsca,
    // które nie idą po dane, albo konsola jest podpięta do innej ramki niż ta,
    // w której ERP pracuje (aplikacja ma w sobie iframe). Licznik je rozdziela.
    let wszystkich = 0, pasujacych = 0;

    XMLHttpRequest.prototype.open = function (m, u) { this.__url = u; return origOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        wszystkich++;
        if (!ruszone && typeof body === 'string'
            && String(this.__url || '').indexOf(ENDPOINT) >= 0) {
          pasujacych++;
          const paczka = JSON.parse(body);
          const srodek = paczka && paczka.Input ? rozpakujB64(paczka.Input) : null;
          if (srodek) rozwaz(JSON.parse(srodek));
        }
      } catch (e) { /* jedno nieczytelne żądanie nie psuje nasłuchu */ }
      return origSend.apply(this, arguments);
    };

    // Sygnał życia po 12 s — żeby nie czekać półtorej minuty na wiadomość,
    // że nasłuch w ogóle nie ma czego słuchać.
    setTimeout(() => {
      if (ruszone) return;
      if (wszystkich === 0) {
        console.warn('%c[sonda] NIE WIDZĘ ŻADNYCH ŻĄDAŃ. To najpewniej nie wina '
          + 'klikania: konsola jest podpięta do innej ramki niż ERP. Nad konsolą '
          + 'jest lista wyboru ramki (domyślnie „top") — przełącz ją na ramkę '
          + 'aplikacji, wklej plik ponownie i uruchom savpolSondaSpec().',
          'font-weight:bold');
      } else {
        console.log('[sonda] żądań widzianych: ' + wszystkich + ', w tym do API ERP: '
          + pasujacych + '. Jeśli drugie jest zerem, kliknij zakładkę ZAŁĄCZNIKI.');
      }
    }, 12000);

    // Poczekalnia jest dłuższa (90 s), bo trzeba trafić w konkretne kliknięcie,
    // a nie w jakiekolwiek. Po czasie sonda NIE MILCZY: składa wynik tak samo
    // jak przy udanym przebiegu, żeby zawsze było co przysłać.
    setTimeout(() => {
      if (!ruszone) {
        odepnij();
        naglowek('NIE UDAŁO SIĘ ZEBRAĆ DANYCH STARTOWYCH');
        log('żądań widzianych w ogóle: ' + wszystkich + ', w tym do API ERP: ' + pasujacych);
        if (wszystkich === 0) {
          log('→ ZERO żądań. Konsola jest podpięta do innej ramki niż ERP.');
          log('  Przełącz wybór ramki nad konsolą i uruchom sondę ponownie.');
        }
        log('dane sesji (z żądania ERP): ' + (kopertaZRodzicem ? 'mam' : 'BRAK'));
        log('dane produktu: ' + (kontekst.csItems ? 'mam' : 'BRAK'));
        log('zebrane zestawy: ' + (Object.keys(kontekst).join(', ') || '(żadnego)'));
        log('');
        log('Sonda podsłuchuje ruch, który generuje sama strona — sama nie umie');
        log('się zalogować. Potrzebuje przy tym kliknięcia, po którym ERP CZYTA');
        log('dane produktu, a nie tylko przerysowuje ekran.');
        log('');
        log('Najpewniej zadziała: wejdź na karcie produktu w zakładkę ZAŁĄCZNIKI.');
        log('Ona zawsze idzie po dane i niesie komplet, którego brakuje.');
        koniec();
      }
    }, 90000);

    console.log('[sonda] słucham. Wejdź na karcie produktu w zakładkę ZAŁĄCZNIKI — to kliknięcie niesie komplet danych, których potrzebuję.');
  };

  console.log('[sonda] wersja ' + WERSJA + ' — gotowe. Uruchom: savpolSondaSpec()');
})();
