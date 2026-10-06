// Karta dokumentu sprzedaży (FA/PAR) z URL + podsłuch odpowiedzi API.
//
// Karta zwraca w jednym zapytaniu dwie tabele: nagłówek (DataSetSQLIdent
// csdocsheaders, 371 pól) i pozycje (csdocsitemspositions, 168 pól). To pokrywa
// wszystkie 273 kolumny csDocsHeaders i 120 kolumn csDocsItemsPositions
// (sprawdzone 2026-10-02, patrz mapowanie-pol.md).
//
//   const pobierz = podepnijKarte(page);   // raz na stronę
//   const w = await pobierz(id);           // { naglowek, pozycje } albo null

const path = require('path');
const W = require('./wspolne');
const { decodeJsonResult, extractCardRecord } = require(path.join(__dirname, '..', '..', 'produkty', 'lib', 'decode'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function podepnijKarte(page) {
  // csDocsHeadersId → { naglowek, pozycje }. Nagłówek i pozycje przychodzą
  // w tej samej odpowiedzi, ale nie zakładamy tego — składamy po id.
  const zlapane = new Map();
  let ostatnieId = null;
  const wpis = id => { if (!zlapane.has(id)) zlapane.set(id, { naglowek: null, pozycje: null }); return zlapane.get(id); };
  page.on('response', async r => {
    if (!/OperatrionInvoke/.test(r.url())) return;
    let body; try { body = await r.text(); } catch (e) { return; }
    const ret = ((decodeJsonResult(body) || {}).Result || {}).RefreshObjectReturnList;
    if (!ret) return;
    for (let i = 0; i < ret.length; i++) {
      const t = extractCardRecord({ Result: { RefreshObjectReturnList: [ret[i]] } });
      if (!t) continue;
      const ident = String(t.dataSetIdent || '').toLowerCase();
      if (ident === 'csdocsheaders' && t.records[0] && t.fieldNames.length > 250) {
        wpis(String(t.records[0].csDocsHeadersId)).naglowek = t.records[0];
      } else if (ident === 'csdocsitemspositions') {
        // Pusty dokument (0 pozycji) też jest odpowiedzią — wtedy nie znamy id
        // z wierszy; pusta lista trafia do dokumentu, na który czekamy.
        const id = t.records[0] ? String(t.records[0].csDocsHeadersId) : ostatnieId;
        if (id) wpis(id).pozycje = t.records;
      }
    }
  });

  return async function pobierz(id) {
    id = String(id);
    zlapane.delete(id);
    ostatnieId = id;
    for (let proba = 1; proba <= 2; proba++) {
      await page.goto(W.cardUrl(id), { waitUntil: 'domcontentloaded' });
      for (let i = 0; i < 80; i++) {
        const z = zlapane.get(id);
        if (z && z.naglowek && z.pozycje) { zlapane.delete(id); return z; }
        await sleep(250);
      }
    }
    return null;
  };
}

module.exports = { podepnijKarte };
