// ==UserScript==
// @name         Savpol ERP -> Zamówienia bota Google (StoreBot)
// @namespace    savpol-erp-tools
// @version      2.0.3
// @description  W tle, co 5 minut, szuka otwartych zamówień ZOID złożonych przez Google StoreBot (John Smith, *@storebotmail.joonix.net), sam je anuluje i powiadamia (Windows + mail).
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-storebot.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-storebot.user.js
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-start
// ==/UserScript==

// Google StoreBot (crawler Zakupów Google) przechodzi checkout esavpol.pl i zostawia
// prawdziwe zamówienia ZOID. Robota nie wolno blokować (ryzyko odrzuceń w Merchant Center),
// więc trzeba je szybko anulować, zanim magazyn (Synaptic) zacznie kompletować.
// Anulowanie w ERP dociera do Synaptic. Ustalenia: esavpol_seo/SEO-NOTES.md,
// sekcja „Zamówienia John Smith = Google StoreBot”.
//
// JAK DZIAŁA (sprawdzone 2026-10-13 na sesji Lecha):
// - Nie loguje się i nie klika. Podsłuchuje zapytania, które ERP i tak wysyła
//   (koperta z danymi sesji), i wysyła własne zapytania tą samą drogą.
// - Lista: wymaga zestawów danych, które strona wysyła przy otwarciu okna
//   Sprzedaż → Zamówienia sprzedaży. Skrypt zapamiętuje je przy pierwszym otwarciu tego
//   okna (GM_setValue, trwale) i od tej pory działa z dowolnego widoku ERP, także po F5.
//   Sesję (LoginInfo) bierze z bieżącego zapytania strony — tylko w pamięci, bez hasła.
// - Anulowanie: to samo, co wysyła Więcej → Anuluj (ActionExecute, csDocsHeadersCanceled),
//   podpatrzone na koszyku bota 2027/ZOID/GLS1/000201. ERP nie pyta o powód.
//   Rekord wybrany = wiersz z naszej listy + __RowGuid__, wskazany po csDocsHeadersG.
//   Po wysłaniu skrypt czyta listę jeszcze raz i melduje sukces tylko przy statusie „Anulowany”.
// - Kilka kart ERP: sprawdza tylko jedna naraz (znacznik czasu w GM_setValue).
//
// Konsola (wynik diagnostyki idzie do schowka):
//   savpolStoreBotStatus()             — stan skryptu
//   savpolStoreBotSprawdzTeraz()       — sprawdzenie od razu
//   savpolStoreBotAuto(false|true)     — wyłącz/włącz samo anulowanie (domyślnie włączone)
//   savpolStoreBotPowiadomienia('url') — adres skryptu Google, który wysyła mail (docs/storebot-mail.gs)
//   savpolStoreBotTest()               — próbne powiadomienie (Windows + zewnętrzne), bez ruszania ERP

(function () {
  'use strict';

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke'; // literówka dostawcy
  const DICT = 'csDocsHeaders4SalesOrders';
  const ZOID_TYP = '14210813631'; // „Zamówienie od odbiorcy - internet detal”
  const CO_ILE_MS = 5 * 60 * 1000;
  // 3 dni obejmują weekend z wyłączonym komputerem; dłuższe okno zapytania ERP potrafi
  // przekroczyć limit czasu SQL („Przekroczono limit czasu semafora”, 14.10).
  const DNI_WSTECZ = 3;
  // Pojedynczy błąd ERP (timeout przy obciążeniu) nie jest powodem do alarmu: plakietka
  // dopiero po 3 nieudanych sprawdzeniach z rzędu (15 min), mail po 12 (godzina).
  const BLEDY_PLAKIETKA = 3;
  const BLEDY_MAIL = 12;
  const MAX_PROB = 3; // tyle razy próbujemy anulować jedno zamówienie, potem tylko alarm
  // Statusy, w których zamówienie bota już nikomu nie przeszkadza.
  const ZAMKNIETE = ['W koszyku', 'Anulowany', 'Zamknięte', 'Zrealizowane'];
  const K_SZABLON = 'storebot_szablon';
  const K_SZABLON_OK = 'storebot_szablon_ok'; // true = wzorzec dał już poprawną listę
  // Pola sterujące zapytaniem (odświeżenie jednego rekordu, TOP, WHERE…). W zapytaniu pełnej
  // listy są puste; wypełnione = strona odświeżała pojedyncze zamówienie po edycji (15.10:
  // „Must declare the scalar variable @__TOP__csDocsHeadersG_0”).
  const POLA_STERUJACE = ['__TOP__', '__PAGENEEDED__', '__FIELDS__', '__WHERE__', '__ORDERBY__', '__PARAMS__',
    '__OFFSET__', '__TOPWHERE__', '__ISREFRESHONERECORD__', '__ISCOUNT__', '__PAGEACTUAL__', '__ISSUM__', '__GROUPBY__'];
  const K_OSTATNIE = 'storebot_ostatnie_sprawdzenie';
  const K_PROBY = 'storebot_proby';         // { id: liczba prób anulowania }
  const K_ZGLOSZONE = 'storebot_zgloszone'; // id, o których już powiadomiliśmy (alarm „anuluj ręcznie”)
  const K_AUTO = 'storebot_auto';
  const K_URL = 'storebot_powiadomienia_url';
  const K_DZIENNIK = 'storebot_dziennik';   // ostatnie zdarzenia, do paska i diagnostyki

  // Ten sam wzorzec co pole `test` w esavpol_analityka/skrypty/erp_zoid.js.
  const toBot = w => /@storebotmail\.joonix\.net/i.test(String(w.EMails || ''))
    || /^john\s+smith$/i.test(((w.Name || '') + ' ' + (w.Surname || '')).trim());

  const stan = { koperta: null, kandydat: null, doAnulowaniaRecznie: [], ostatniBlad: null, bledyZRzedu: 0, zamkniety: null, ostatnieSprawdzenie: null, wierszy: null };

  // ---------- Kodowanie zapytań ERP ----------
  // Input = base64 z ZIP-a (jeden plik JSON) albo samego JSON-a (Compress:false).

  async function dekoduj(b64) {
    const b = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (b[0] !== 0x50 || b[1] !== 0x4b) return new TextDecoder().decode(b);
    const dv = new DataView(b.buffer);
    const metoda = dv.getUint16(8, true), nl = dv.getUint16(26, true), el = dv.getUint16(28, true), rozm = dv.getUint32(18, true);
    const dane = b.subarray(30 + nl + el, 30 + nl + el + rozm);
    if (metoda === 0) return new TextDecoder().decode(dane);
    const s = new Blob([dane]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(s).text();
  }
  const base64Utf8 = s => btoa(unescape(encodeURIComponent(s)));
  const guid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });
  const odpakuj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.values(v)[0] : v;

  async function wyslij(paczka) {
    const odp = await fetch(location.origin + ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ DictIdent: DICT, Input: base64Utf8(JSON.stringify(paczka)), Compress: false })
    });
    const j = await odp.json();
    if (j.Error) throw new Error(String(j.Error).slice(0, 200));
    return j.JSONResult ? JSON.parse(await dekoduj(j.JSONResult)) : null;
  }

  // Koperta z sesji strony: LoginInfo + pola sesji w OperationInvokeInput. Hasła nie wysyłamy.
  function nowaPaczka() {
    if (!stan.koperta) throw new Error('brak sesji — ERP jeszcze nic nie wysłało');
    const p = JSON.parse(JSON.stringify(stan.koperta));
    p.LoginInfo.Password = '';
    const oi = p.OperationInvokeInput;
    oi.DelegateIdent = guid();
    // Z koperty strony bierzemy tylko dane sesji. Resztę ostatniego zapytania strony
    // (np. parametry odświeżenia jednego zamówienia) czyścimy, żeby nie przeszła do naszego.
    ['OperationListPrev', 'TransIdent', 'RefreshQueryUID', 'DataSetSQLTypeObject', 'DataTableInitList', 'RefreshInputObject']
      .forEach(k => { if (k in oi) oi[k] = null; });
    return p;
  }

  // ---------- Podsłuch (bierny) ----------

  function zapamietaj(dict, j) {
    const oi = j && j.OperationInvokeInput;
    if (!j || !j.LoginInfo || !oi) return;
    stan.koperta = j;
    // Wzorzec listy: zapytanie strony o csDocsHeaders4SalesOrders z odświeżaną siatką.
    const lista = oi.RefreshInputObject && oi.RefreshInputObject.DataTableInitList;
    if (String(dict).toLowerCase() !== DICT.toLowerCase() || !lista) return;
    if (!Object.values(lista).some(t => t && t.Refresh && t.DataTableInit)) return;
    if (czyOdswiezenieRekordu(lista)) return;
    const wzorzec = JSON.stringify({ params: oi.Params, parentIdent: oi.RefreshInputObject.ParentIdent, lista });
    // Sprawdzonego wzorca nie nadpisujemy niesprawdzonym: nowy czeka jako kandydat
    // i wchodzi dopiero, gdy stary przestanie działać, a nowy da poprawną listę.
    if (GM_getValue(K_SZABLON_OK, false)) { stan.kandydat = wzorzec; return; }
    const pierwszy = !GM_getValue(K_SZABLON, null);
    GM_setValue(K_SZABLON, wzorzec);
    if (pierwszy) { console.log('[StoreBot] Wzorzec listy zamówień zapamiętany.'); setTimeout(sprawdz, 3000); }
    rysujPasek();
  }

  // Czy któraś tabela ma wypełnione pole sterujące (= odświeżenie pojedynczego rekordu)?
  function czyOdswiezenieRekordu(lista) {
    return Object.values(lista).some(t => {
      const dt = t && t.DataTableInit && t.DataTableInit.DataTable;
      if (!dt || !dt.Rows || !dt.Rows.length) return false;
      return dt.FieldDefs.some((f, i) => POLA_STERUJACE.includes(f.FieldName)
        && dt.Rows.some(r => { const v = odpakuj(r[i]); return v !== null && v !== undefined && v !== ''; }));
    });
  }

  function zainstalujPodsluch() {
    const P = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (!P || P.__savpolStoreBot) return;
    P.__savpolStoreBot = true;
    const send = P.send;
    P.send = function (body) {
      try {
        if (typeof body === 'string' && body.includes('"DictIdent"') && body.includes('"Input"')) {
          const zew = JSON.parse(body);
          dekoduj(zew.Input).then(t => zapamietaj(zew.DictIdent, JSON.parse(t))).catch(() => {});
        }
      } catch (e) { /* podsłuch nie może przeszkodzić stronie */ }
      return send.apply(this, arguments);
    };
  }

  // ---------- Lista ZOID ----------
  // Zwraca surową siatkę (FieldDefs + Rows) — potrzebna do anulowania — i wiersze jako obiekty.

  async function pobierzZoid(wzorzec = GM_getValue(K_SZABLON, null)) {
    const sz = JSON.parse(wzorzec || 'null');
    if (!sz) throw new Error('brak wzorca — otwórz raz Sprzedaż → Zamówienia sprzedaży');
    const p = nowaPaczka();
    const oi = p.OperationInvokeInput;
    oi.OperationName = 'RefreshDataSetSQL_Synchronous';
    oi.Params = sz.params;
    // Losowy ParentUniqName: zapytanie nie wymaga otwartego okna listy.
    // InputForDataSetSQL/RecordProps puste — sprawdzone 15.10, lista przychodzi bez nich.
    oi.RefreshInputObject = { ParentUniqName: guid(), ParentIdent: sz.parentIdent, DataTableInitList: sz.lista,
      InputForDataSetSQL: null, RecordProps: null };

    const iso = d => d.toISOString().slice(0, 10) + ' 00:00:00';
    // Status 0 = „Wszystkie”; resztę odsiewamy niżej (102 „otwarte” gubi np. „Do realizacji”).
    const filtr = { WithoutCart: 0, RouteDateFrom: null, RouteDateTo: null, SearchText: 'zoid',
      csDocsHeadersStatusIdType: 0,
      DocDateFrom: iso(new Date(Date.now() - DNI_WSTECZ * 864e5)), DocDateTo: iso(new Date(Date.now() + 864e5)) };
    const queryUID = guid();
    const l = oi.RefreshInputObject.DataTableInitList;
    Object.keys(l).forEach(k => {
      const t = l[k];
      if (!t || !t.DataTableInit) return;
      // SelectStmType 2 = wiersze (1 = sam licznik).
      if (t.Refresh) Object.assign(t, { QueryUID: queryUID, PageSizeFromClient: 500, PageActual: 0, SelectStmType: 2 });
      const dt = t.DataTableInit.DataTable;
      const idx = n => dt.FieldDefs.findIndex(f => f.FieldName === n);
      // Wzorzec zapamiętany przez 2.0.0–2.0.2 mógł mieć wypełnione pola sterujące — zerujemy.
      dt.FieldDefs.forEach((f, i) => {
        if (!POLA_STERUJACE.includes(f.FieldName)) return;
        dt.Rows.forEach(r => { const c = r[i]; r[i] = (c && typeof c === 'object' && !Array.isArray(c)) ? { [Object.keys(c)[0] || 'Item']: null } : null; });
      });
      if (idx('DocDateFrom') < 0 || dt.Rows.length !== 1) return;
      Object.entries(filtr).forEach(([n, v]) => {
        const i = idx(n); if (i < 0) return;
        const c = dt.Rows[0][i];
        dt.Rows[0][i] = (c && typeof c === 'object' && !Array.isArray(c)) ? { [Object.keys(c)[0] || 'Item']: v } : v;
      });
    });

    const wynik = await wyslij(p);
    const ret = (wynik && wynik.Result && wynik.Result.RefreshObjectReturnList || [])
      .find(x => String(x.DataSetSQLIdent).toLowerCase() === DICT.toLowerCase());
    const dt = ret && ret.DataTable;
    if (!dt) throw new Error('ERP zwrócił listę bez wierszy');
    const wiersze = (dt.Rows || []).map((r, i) => Object.assign(
      Object.fromEntries(dt.FieldDefs.map((f, k) => [f.FieldName, odpakuj(r[k])])), { __idx: i }));
    return { dt, wiersze, queryUID };
  }

  // ---------- Anulowanie (Więcej → Anuluj) ----------

  async function anuluj(lista, w) {
    const { dt, queryUID } = lista;
    const ix = n => dt.FieldDefs.findIndex(f => f.FieldName === n);
    const sel = '<csSelectedRows><row><csDocsHeadersG>' + w.csDocsHeadersG + '</csDocsHeadersG></row></csSelectedRows>';
    const wiersz = dt.Rows[w.__idx].slice();
    const ustaw = (n, v) => { const i = ix(n); if (i >= 0) wiersz[i] = { Item: v }; };
    ustaw('__IsSelected__', 1); ustaw('__SelectedValue__', sel); ustaw('__QueryUID__', queryUID);
    const aktywny = {
      DataSetSQLIdent: 'ActiveRecord', SortList: [], Refresh: false,
      DataTableInit: { DataTable: {
        FieldDefs: [{ FieldName: '__RowGuid__', FieldType: 'System.String', OriginalFieldType: 'System.String' }]
          .concat(dt.FieldDefs.map(f => Object.assign({}, f, { OriginalFieldType: f.OriginalFieldType || f.FieldType }))),
        Rows: [[{ Item: 'rowid_0' }].concat(wiersz)]
      } }
    };
    const p = nowaPaczka();
    const oi = p.OperationInvokeInput;
    oi.OperationName = 'ActionExecute';
    oi.RefreshInputObject = null;
    oi.DataTableInitList = { '0': aktywny, length: 1 };
    oi.Params = {
      DictIdent: DICT, ActionIdent: 'csDocsHeadersCanceled', DataSetTypeIdent: DICT,
      __StartField__: '__IsSelected__',
      ExceptionIdent: DICT + '_' + guid() + '_csDocsHeadersCanceled' + guid(),
      __SelectedRecords__: sel,
      __PageRecords__: '<csPageRecords><row></row></csPageRecords>',
      __SortList__: '<SortList><row><FieldName>DocDate</FieldName><DirectSort>0</DirectSort></row><row><FieldName>DocNumber</FieldName><DirectSort>0</DirectSort></row><row><FieldName>csDocsHeadersId</FieldName><DirectSort>0</DirectSort></row></SortList>',
      HasParams: '0', ActionExecuteType: 1, LoginProviderObject: null
    };
    await wyslij(p);
  }

  // ---------- Główna pętla ----------

  const opisZam = w => w.DocNumber + ' (' + (Number(w.CNAmount) || 0).toFixed(2) + ' zł netto, ' + String(w.DocDate || '').slice(0, 10) + ')';
  const doAnulowania = wiersze => wiersze.filter(w =>
    String(w.csDocsTypesId) === ZOID_TYP && !ZAMKNIETE.includes(w.StatusValueTranslatedDesc) && toBot(w));

  // Błąd przejściowy (serwer zajęty) nie świadczy o złym wzorcu.
  const bladPrzejsciowy = e => /limit czasu|timeout|transport|semafor|deadlock|zakleszcz|sieci|Failed to fetch/i.test(String(e && e.message || e));

  // Lista z zapamiętanego wzorca; gdy ten nie działa (błąd inny niż przejściowy), próbuje
  // kandydata podsłuchanego w tej sesji. Działający wzorzec zostaje zapamiętany jako sprawdzony.
  async function pobierzListeZWzorcem() {
    try {
      const lista = await pobierzZoid();
      GM_setValue(K_SZABLON_OK, true);
      return lista;
    } catch (e) {
      if (bladPrzejsciowy(e)) throw e;
      const kandydat = stan.kandydat;
      stan.kandydat = null;
      if (kandydat) {
        try {
          const lista = await pobierzZoid(kandydat);
          GM_setValue(K_SZABLON, kandydat);
          GM_setValue(K_SZABLON_OK, true);
          dziennik('wzorzec listy wymieniony po błędzie: ' + String(e.message || e).slice(0, 120));
          return lista;
        } catch (e2) { /* zostaje pierwotny błąd */ }
      }
      // Zły wzorzec: następne zapytanie strony o listę zamówień zastąpi go samo.
      GM_setValue(K_SZABLON_OK, false);
      throw e;
    }
  }

  async function sprawdz() {
    // Jedna karta naraz: inna sprawdzała przed chwilą → pomiń.
    const ostatnie = Number(GM_getValue(K_OSTATNIE, 0));
    if (Date.now() - ostatnie < CO_ILE_MS - 30000) return;
    if (!stan.koperta || !GM_getValue(K_SZABLON, null)) { rysujPasek(); return; }
    GM_setValue(K_OSTATNIE, Date.now());
    stan.ostatnieSprawdzenie = new Date();
    try {
      let lista = await pobierzListeZWzorcem();
      stan.wierszy = lista.wiersze.length;
      const boty = doAnulowania(lista.wiersze);
      if (boty.length && GM_getValue(K_AUTO, true)) {
        const proby = JSON.parse(GM_getValue(K_PROBY, '{}'));
        const anulowane = [];
        for (const w of boty) {
          const id = String(w.csDocsHeadersId);
          if ((proby[id] || 0) >= MAX_PROB) continue;
          proby[id] = (proby[id] || 0) + 1;
          GM_setValue(K_PROBY, JSON.stringify(proby));
          try {
            // Ostatnia kontrola tuż przed zapisem: tylko ZOID bota.
            if (!toBot(w) || String(w.csDocsTypesId) !== ZOID_TYP) continue;
            await anuluj(lista, w);
            anulowane.push(w);
          } catch (e) {
            dziennik('błąd anulowania ' + w.DocNumber + ': ' + (e && e.message || e));
          }
        }
        if (anulowane.length) {
          // Odczyt kontrolny: sukces tylko, gdy ERP pokazuje „Anulowany”.
          lista = await pobierzZoid();
          const teraz = Object.fromEntries(lista.wiersze.map(w => [String(w.csDocsHeadersId), w.StatusValueTranslatedDesc]));
          const ok = anulowane.filter(w => teraz[String(w.csDocsHeadersId)] === 'Anulowany');
          if (ok.length) {
            const tekst = 'Anulowano automatycznie zamówienie bota Google (John Smith / StoreBot): '
              + ok.map(opisZam).join('; ') + '. Nic nie trzeba robić.';
            dziennik(tekst);
            GM_notification({ title: 'ERP: anulowano zamówienie bota Google', text: ok.map(w => w.DocNumber).join(', '), timeout: 15000 });
            powiadomZewnetrznie('Anulowano zamówienie bota Google', tekst);
          }
        }
      }
      // Co zostało nieanulowane (auto wyłączone, błąd, limit prób) → alarm dla człowieka.
      const zostaly = doAnulowania(lista.wiersze);
      stan.doAnulowaniaRecznie = zostaly;
      const zgloszone = JSON.parse(GM_getValue(K_ZGLOSZONE, '[]'));
      const nowe = zostaly.filter(w => !zgloszone.includes(String(w.csDocsHeadersId)));
      if (nowe.length) {
        const tekst = 'Zamówienie bota Google do ANULOWANIA RĘCZNIE (nie kompletować): ' + nowe.map(opisZam).join('; ')
          + '. Skrypt nie zdołał go anulować sam.';
        dziennik(tekst);
        GM_notification({ title: 'ERP: zamówienie bota Google — anuluj ręcznie', text: nowe.map(w => w.DocNumber).join(', '), timeout: 0 });
        powiadomZewnetrznie('PILNE: zamówienie bota Google do anulowania', tekst);
        GM_setValue(K_ZGLOSZONE, JSON.stringify(zgloszone.concat(nowe.map(w => String(w.csDocsHeadersId))).slice(-200)));
      }
      stan.ostatniBlad = null;
      stan.bledyZRzedu = 0;
    } catch (e) {
      stan.ostatniBlad = String(e && e.message || e);
      stan.bledyZRzedu++;
      if (stan.bledyZRzedu === BLEDY_MAIL) {
        powiadomZewnetrznie('StoreBot nie sprawdza zamówień od godziny',
          'Skrypt StoreBot w ERP od godziny nie może pobrać listy zamówień. Ostatni błąd: ' + stan.ostatniBlad
          + '. Zamówienia bota nie są w tym czasie anulowane.');
      }
      console.warn('[StoreBot] ' + stan.ostatniBlad);
    }
    rysujPasek();
  }

  // ---------- Powiadomienie mailem ----------
  // POST do Google Apps Script (docs/storebot-mail.gs), który wysyła mail do Lecha.
  // Adres ustawia się z konsoli i siedzi tylko w Tampermonkey — repo jest publiczne.

  function powiadomZewnetrznie(tytul, tekst) {
    const url = GM_getValue(K_URL, '');
    if (!url) return;
    GM_xmlhttpRequest({
      // Tytuł idzie pierwszą linią treści; całość przez encodeURIComponent, bo Apps Script
      // gubił polskie znaki z surowego UTF-8 (docs/storebot-mail.gs dekoduje).
      method: 'POST', url, data: encodeURIComponent(tytul + '\n' + tekst),
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      onerror: () => dziennik('nie wysłano powiadomienia zewnętrznego'),
      onload: r => { if (r.status >= 400) dziennik('powiadomienie zewnętrzne: HTTP ' + r.status); }
    });
  }

  function dziennik(tekst) {
    const d = JSON.parse(GM_getValue(K_DZIENNIK, '[]'));
    d.push(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' ' + tekst);
    GM_setValue(K_DZIENNIK, JSON.stringify(d.slice(-30)));
    console.log('[StoreBot] ' + tekst);
  }

  // ---------- Widok ----------
  // Czerwony pasek: zamówienie bota czeka na ręczne anulowanie. Żółta plakietka: brak wzorca / błąd.
  // Udane anulowanie nie zostawia paska — zostaje powiadomienie i wpis w dzienniku.

  function rysujPasek() {
    if (!document.body) return;
    let el = document.getElementById('savpol-storebot');
    const boty = stan.doAnulowaniaRecznie;
    const bezWzorca = !GM_getValue(K_SZABLON, null);
    const awaria = stan.ostatniBlad && stan.bledyZRzedu >= BLEDY_PLAKIETKA;
    // Klucz tego, co pokazujemy. Zamknięty krzyżykiem komunikat wraca dopiero, gdy klucz się zmieni
    // (np. nowe zamówienie bota) albo po przeładowaniu strony.
    const klucz = boty.length ? 'boty:' + boty.map(w => w.csDocsHeadersId).join(',')
      : bezWzorca ? 'wzorzec' : awaria ? 'awaria' : null;
    if (!klucz || klucz === stan.zamkniety) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'savpol-storebot';
      el.style.cssText = 'position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:420px;'
        + 'padding:10px 30px 10px 14px;border-radius:6px;font:13px/1.4 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)';
      document.body.appendChild(el);
    }
    if (boty.length) {
      el.style.background = '#c62828'; el.style.color = '#fff';
      el.innerHTML = '<b>Zamówienia bota Google — anulować ręcznie, nie kompletować:</b><br>'
        + boty.map(w => escapeHtml(w.DocNumber) + ' · ' + escapeHtml(w.StatusValueTranslatedDesc) + ' · '
          + String(w.DocDate || '').slice(0, 10) + ' · ' + (Number(w.CNAmount) || 0).toFixed(2) + ' zł netto').join('<br>')
        + '<br><small>John Smith / *@storebotmail.joonix.net. Pasek zniknie po anulowaniu (do 5 min).</small>';
    } else {
      el.style.background = '#fff3cd'; el.style.color = '#333';
      el.textContent = bezWzorca
        ? 'StoreBot: otwórz raz Sprzedaż → Zamówienia sprzedaży, żeby włączyć pilnowanie zamówień bota.'
        : 'StoreBot: sprawdzanie nie działa (' + stan.ostatniBlad + ').';
    }
    const x = document.createElement('span');
    x.textContent = '×';
    x.title = 'Zamknij';
    x.style.cssText = 'position:absolute;top:4px;right:9px;cursor:pointer;font-size:18px;line-height:1;opacity:.8';
    x.onclick = () => { stan.zamkniety = klucz; el.remove(); };
    el.appendChild(x);
  }
  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Konsola ----------

  function doSchowka(txt) {
    try { if (typeof W.copy === 'function') { W.copy(txt); return; } } catch (e) { /* dalej */ }
    if (navigator.clipboard) { navigator.clipboard.writeText(txt).catch(() => {}); return; }
    const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }

  W.savpolStoreBotStatus = function () {
    const txt = ['StoreBot ' + GM_info.script.version + ' | ' + location.href + ' | ' + new Date().toISOString(),
      'wzorzec listy: ' + (GM_getValue(K_SZABLON, null) ? 'jest' : 'BRAK'),
      'sesja: ' + (stan.koperta ? 'jest' : 'BRAK'),
      'samo anulowanie: ' + (GM_getValue(K_AUTO, true) ? 'włączone' : 'WYŁĄCZONE'),
      'powiadomienia zewnętrzne: ' + (GM_getValue(K_URL, '') ? 'ustawione' : 'brak'),
      'ostatnie sprawdzenie (ta karta): ' + (stan.ostatnieSprawdzenie ? stan.ostatnieSprawdzenie.toISOString() : '—'),
      'ostatnie sprawdzenie (dowolna karta): ' + new Date(Number(GM_getValue(K_OSTATNIE, 0))).toISOString(),
      'ZOID na liście (' + DNI_WSTECZ + ' dni): ' + stan.wierszy,
      'do anulowania ręcznie: ' + stan.doAnulowaniaRecznie.map(w => w.DocNumber).join(', '),
      'błąd: ' + (stan.ostatniBlad || '—') + (stan.bledyZRzedu ? ' (' + stan.bledyZRzedu + ' z rzędu)' : ''),
      'dziennik:', ...JSON.parse(GM_getValue(K_DZIENNIK, '[]'))].join('\n');
    doSchowka(txt);
    return 'skopiowano, ' + txt.length + ' znaków';
  };
  W.savpolStoreBotSprawdzTeraz = () => { GM_setValue(K_OSTATNIE, 0); return sprawdz().then(() => stan.ostatniBlad || 'sprawdzone, ZOID: ' + stan.wierszy); };
  W.savpolStoreBotAuto = wl => { GM_setValue(K_AUTO, wl !== false); return 'samo anulowanie: ' + (wl !== false ? 'włączone' : 'wyłączone'); };
  W.savpolStoreBotPowiadomienia = url => { GM_setValue(K_URL, String(url || '')); return url ? 'zapisano adres powiadomień' : 'powiadomienia zewnętrzne wyłączone'; };
  W.savpolStoreBotTest = () => {
    GM_notification({ title: 'ERP StoreBot: test', text: 'Tak wygląda powiadomienie o zamówieniu bota.', timeout: 10000 });
    powiadomZewnetrznie('Test: StoreBot', 'Próbne powiadomienie ze skryptu StoreBot w ERP (' + new Date().toLocaleString('pl-PL') + '). Nic nie trzeba robić.');
    return 'wysłano próbne powiadomienie';
  };

  zainstalujPodsluch();
  // Pierwsze sprawdzenie chwilę po starcie (strona musi wysłać choć jedno zapytanie), potem co 5 min.
  setTimeout(sprawdz, 20000);
  setInterval(sprawdz, CO_ILE_MS);
})();
