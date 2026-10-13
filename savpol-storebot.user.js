// ==UserScript==
// @name         Savpol ERP -> Zamówienia bota Google (StoreBot)
// @namespace    savpol-erp-tools
// @version      1.0.0
// @description  W tle, co 5 minut, szuka otwartych zamówień ZOID złożonych przez Google StoreBot (John Smith, *@storebotmail.joonix.net) i ostrzega, że trzeba je anulować. Niczego w ERP nie zmienia.
// @homepageURL  https://github.com/SavpolLech/savpol-erp
// @updateURL    https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-storebot.user.js
// @downloadURL  https://raw.githubusercontent.com/SavpolLech/savpol-erp/main/savpol-storebot.user.js
// @match        https://erp.savpol.pl/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @run-at       document-start
// ==/UserScript==

// Google StoreBot (crawler Zakupów Google) przechodzi checkout esavpol.pl i zostawia
// prawdziwe zamówienia ZOID. Robota nie wolno blokować (ryzyko odrzuceń w Merchant Center),
// więc trzeba je szybko anulować, zanim magazyn (Synaptic) zacznie kompletować.
// Ustalenia: esavpol_seo/SEO-NOTES.md, sekcja „Zamówienia John Smith = Google StoreBot”.
//
// JAK DZIAŁA (sprawdzone 2026-10-13 na sesji Lecha):
// - Nie loguje się i nie klika. Podsłuchuje zapytania, które ERP i tak wysyła
//   (koperta z danymi sesji), i wysyła własne zapytanie o listę zamówień tą samą drogą.
// - Zapytanie o listę wymaga zestawów danych, które strona wysyła przy otwarciu okna
//   Sprzedaż → Zamówienia sprzedaży. Skrypt zapamiętuje je przy pierwszym otwarciu tego
//   okna (GM_setValue, trwale) i od tej pory działa z dowolnego widoku ERP, także po F5.
//   Sesję (LoginInfo) bierze z bieżącego zapytania strony — tylko w pamięci, bez hasła.
// - Kilka kart ERP: sprawdza tylko jedna naraz (znacznik czasu w GM_setValue).
//
// Wersja 1.x TYLKO OSTRZEGA (powiadomienie + czerwony pasek). Anulowanie dojdzie w 2.0.0.

(function () {
  'use strict';

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const ENDPOINT = '/api/CommS_WCF_JSON.svc/OperatrionInvoke'; // literówka dostawcy
  const DICT = 'csDocsHeaders4SalesOrders';
  const ZOID_TYP = '14210813631'; // „Zamówienie od odbiorcy - internet detal”
  const CO_ILE_MS = 5 * 60 * 1000;
  const DNI_WSTECZ = 7;
  // Statusy, w których zamówienie bota już nikomu nie przeszkadza.
  const ZAMKNIETE = ['W koszyku', 'Anulowany', 'Zamknięte', 'Zrealizowane'];
  const K_SZABLON = 'storebot_szablon';
  const K_OSTATNIE = 'storebot_ostatnie_sprawdzenie';
  const K_ZGLOSZONE = 'storebot_zgloszone';

  // Ten sam wzorzec co pole `test` w esavpol_analityka/skrypty/erp_zoid.js.
  const toBot = w => /@storebotmail\.joonix\.net/i.test(String(w.EMails || ''))
    || /^john\s+smith$/i.test(((w.Name || '') + ' ' + (w.Surname || '')).trim());

  const stan = { koperta: null, ostatniWynik: null, ostatniBlad: null, ostatnieSprawdzenie: null };

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

  // ---------- Podsłuch (bierny) ----------

  function zapamietaj(dict, j) {
    const oi = j && j.OperationInvokeInput;
    if (!j || !j.LoginInfo || !oi) return;
    stan.koperta = j;
    // Wzorzec listy: zapytanie strony o csDocsHeaders4SalesOrders z odświeżaną siatką.
    const lista = oi.RefreshInputObject && oi.RefreshInputObject.DataTableInitList;
    if (String(dict).toLowerCase() !== DICT.toLowerCase() || !lista) return;
    if (!Object.values(lista).some(t => t && t.Refresh && t.DataTableInit)) return;
    const pierwszy = !GM_getValue(K_SZABLON, null);
    GM_setValue(K_SZABLON, JSON.stringify({ dict, params: oi.Params, parentIdent: oi.RefreshInputObject.ParentIdent, lista }));
    if (pierwszy) { console.log('[StoreBot] Wzorzec listy zamówień zapamiętany.'); setTimeout(sprawdz, 3000); }
    rysujPasek();
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

  // ---------- Zapytanie o listę ----------

  async function pobierzZoid() {
    const sz = JSON.parse(GM_getValue(K_SZABLON, 'null'));
    if (!sz) throw new Error('brak wzorca — otwórz raz Sprzedaż → Zamówienia sprzedaży');
    if (!stan.koperta) throw new Error('brak sesji — ERP jeszcze nic nie wysłało');

    const p = JSON.parse(JSON.stringify(stan.koperta));
    p.LoginInfo.Password = ''; // serwer go nie sprawdza
    const oi = p.OperationInvokeInput;
    oi.OperationName = 'RefreshDataSetSQL_Synchronous';
    oi.Params = sz.params;
    oi.DelegateIdent = guid();
    // Losowy ParentUniqName: zapytanie nie wymaga otwartego okna listy.
    oi.RefreshInputObject = Object.assign({}, oi.RefreshInputObject || {},
      { ParentUniqName: guid(), ParentIdent: sz.parentIdent, DataTableInitList: sz.lista });

    const iso = d => d.toISOString().slice(0, 10) + ' 00:00:00';
    // Status 0 = „Wszystkie”; resztę odsiewamy niżej (102 „otwarte” gubi np. „Do realizacji”).
    const filtr = { WithoutCart: 0, RouteDateFrom: null, RouteDateTo: null, SearchText: 'zoid',
      csDocsHeadersStatusIdType: 0,
      DocDateFrom: iso(new Date(Date.now() - DNI_WSTECZ * 864e5)), DocDateTo: iso(new Date(Date.now() + 864e5)) };
    const l = oi.RefreshInputObject.DataTableInitList;
    Object.keys(l).forEach(k => {
      const t = l[k];
      if (!t || !t.DataTableInit) return;
      // SelectStmType 2 = wiersze (1 = sam licznik).
      if (t.Refresh) Object.assign(t, { QueryUID: guid(), PageSizeFromClient: 500, PageActual: 0, SelectStmType: 2 });
      const dt = t.DataTableInit.DataTable;
      const idx = n => dt.FieldDefs.findIndex(f => f.FieldName === n);
      if (idx('DocDateFrom') < 0 || dt.Rows.length !== 1) return;
      Object.entries(filtr).forEach(([n, v]) => {
        const i = idx(n); if (i < 0) return;
        const c = dt.Rows[0][i];
        dt.Rows[0][i] = (c && typeof c === 'object' && !Array.isArray(c)) ? { [Object.keys(c)[0] || 'Item']: v } : v;
      });
    });

    const odp = await fetch(location.origin + ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ DictIdent: sz.dict, Input: base64Utf8(JSON.stringify(p)), Compress: false })
    });
    const j = await odp.json();
    if (j.Error) throw new Error(String(j.Error).slice(0, 200));
    const wynik = JSON.parse(await dekoduj(j.JSONResult));
    const ret = (wynik.Result && wynik.Result.RefreshObjectReturnList || [])
      .find(x => String(x.DataSetSQLIdent).toLowerCase() === DICT.toLowerCase());
    const dt = ret && ret.DataTable;
    if (!dt) throw new Error('ERP zwrócił listę bez wierszy');
    return (dt.Rows || []).map(r => Object.fromEntries(dt.FieldDefs.map((f, i) => [f.FieldName, odpakuj(r[i])])));
  }

  async function sprawdz() {
    // Jedna karta naraz: inna sprawdzała przed chwilą → pomiń.
    const ostatnie = Number(GM_getValue(K_OSTATNIE, 0));
    if (Date.now() - ostatnie < CO_ILE_MS - 30000) return;
    if (!stan.koperta || !GM_getValue(K_SZABLON, null)) { rysujPasek(); return; }
    GM_setValue(K_OSTATNIE, Date.now());
    stan.ostatnieSprawdzenie = new Date();
    try {
      const wiersze = await pobierzZoid();
      const boty = wiersze
        .filter(w => String(w.csDocsTypesId) === ZOID_TYP && !ZAMKNIETE.includes(w.StatusValueTranslatedDesc) && toBot(w))
        .map(w => ({ id: String(w.csDocsHeadersId), nr: w.DocNumber, status: w.StatusValueTranslatedDesc,
          data: String(w.DocDate || '').slice(0, 10), netto: Number(w.CNAmount) || 0,
          dostawa: w.DeliveryMethodTranslatedDesc || '' }));
      stan.ostatniWynik = { wierszy: wiersze.length, boty };
      stan.ostatniBlad = null;
      const zgloszone = JSON.parse(GM_getValue(K_ZGLOSZONE, '[]'));
      const nowe = boty.filter(b => !zgloszone.includes(b.id));
      if (nowe.length) {
        GM_notification({
          title: 'ERP: zamówienie bota Google — anuluj',
          text: nowe.map(b => b.nr + ' (' + b.status + ')').join(', ') + '\nJohn Smith / StoreBot. Nie kompletować.',
          timeout: 0
        });
        GM_setValue(K_ZGLOSZONE, JSON.stringify(zgloszone.concat(nowe.map(b => b.id)).slice(-200)));
      }
    } catch (e) {
      stan.ostatniBlad = String(e && e.message || e);
      console.warn('[StoreBot] ' + stan.ostatniBlad);
    }
    rysujPasek();
  }

  // ---------- Widok: czerwony pasek (boty) albo mała plakietka (brak wzorca/błąd) ----------

  function rysujPasek() {
    if (!document.body) return;
    let el = document.getElementById('savpol-storebot');
    const boty = stan.ostatniWynik ? stan.ostatniWynik.boty : [];
    const bezWzorca = !GM_getValue(K_SZABLON, null);
    if (!boty.length && !bezWzorca && !stan.ostatniBlad) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'savpol-storebot';
      el.style.cssText = 'position:fixed;z-index:2147483647;right:12px;bottom:12px;max-width:420px;'
        + 'padding:10px 14px;border-radius:6px;font:13px/1.4 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)';
      document.body.appendChild(el);
    }
    if (boty.length) {
      el.style.background = '#c62828'; el.style.color = '#fff';
      el.innerHTML = '<b>Zamówienia bota Google — anulować, nie kompletować:</b><br>'
        + boty.map(b => escapeHtml(b.nr) + ' · ' + escapeHtml(b.status) + ' · ' + b.data + ' · ' + b.netto.toFixed(2) + ' zł netto').join('<br>')
        + '<br><small>John Smith / *@storebotmail.joonix.net. Pasek zniknie po anulowaniu (do 5 min).</small>';
    } else {
      el.style.background = '#fff3cd'; el.style.color = '#333';
      el.textContent = bezWzorca
        ? 'StoreBot: otwórz raz Sprzedaż → Zamówienia sprzedaży, żeby włączyć pilnowanie zamówień bota.'
        : 'StoreBot: sprawdzanie nie działa (' + stan.ostatniBlad + ').';
    }
  }
  const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Diagnostyka do konsoli (wynik idzie do schowka) ----------

  W.savpolStoreBotStatus = function () {
    const txt = ['StoreBot ' + (GM_info && GM_info.script && GM_info.script.version) + ' | ' + location.href + ' | ' + new Date().toISOString(),
      'wzorzec listy: ' + (GM_getValue(K_SZABLON, null) ? 'jest' : 'BRAK'),
      'sesja: ' + (stan.koperta ? 'jest' : 'BRAK'),
      'ostatnie sprawdzenie (ta karta): ' + (stan.ostatnieSprawdzenie ? stan.ostatnieSprawdzenie.toISOString() : '—'),
      'ostatnie sprawdzenie (dowolna karta): ' + new Date(Number(GM_getValue(K_OSTATNIE, 0))).toISOString(),
      'błąd: ' + (stan.ostatniBlad || '—'),
      'wynik: ' + JSON.stringify(stan.ostatniWynik)].join('\n');
    if (typeof W.copy === 'function') W.copy(txt);
    else if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
    return 'skopiowano, ' + txt.length + ' znaków';
  };
  W.savpolStoreBotSprawdzTeraz = () => { GM_setValue(K_OSTATNIE, 0); return sprawdz().then(() => stan.ostatniWynik || stan.ostatniBlad); };

  zainstalujPodsluch();
  // Pierwsze sprawdzenie chwilę po starcie (strona musi wysłać choć jedno zapytanie), potem co 5 min.
  setTimeout(sprawdz, 20000);
  setInterval(sprawdz, CO_ILE_MS);
})();
