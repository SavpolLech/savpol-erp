// Dekodowanie odpowiedzi ERP z karty produktu (DictIdent: csItemsOneBro).
//
// TA SAMA logika co diagnostyka/podsluch-danych-produktu.js, tylko po stronie
// Node zamiast w przeglądarce. ERP pakuje treść odpowiedzi w pole `JSONResult`
// jako base64(ZIP z jednym plikiem, kompresja deflate-raw). Rozpakowujemy to
// tutaj i wyciągamy rekord produktu z DataTable (FieldDefs + wiersze).
//
// Dlaczego robimy to w Node, a nie czytamy DOM jak scraper WZ: dane karty
// produktu NIE są w widocznych komórkach siatki (jak przy WZ), tylko wracają
// jednym zapytaniem API (RefreshDataSetSQL_Synchronous). Podsłuchujemy więc
// odpowiedź sieciową i dekodujemy ją — dokładnie to, co robi sonda z
// diagnostyka/, przeniesione do sterowanego przebiegu.

const zlib = require('zlib');

// base64(ZIP+deflate-raw) → obiekt JS (albo null, jeśli to nie ten format).
function decodeJsonResult(responseText) {
  let zewnetrzny;
  try { zewnetrzny = JSON.parse(responseText); } catch (e) { return null; }

  const b64 = zewnetrzny.JSONResult || zewnetrzny.Input;
  if (!b64 || typeof b64 !== 'string') return null;

  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return null; }
  if (buf.length < 30) return null;

  // Nagłówek lokalnego pliku ZIP (PK\x03\x04).
  if (buf.readUInt32LE(0) !== 0x04034b50) return null;
  const nazwaLen = buf.readUInt16LE(26);
  const dodatkoweLen = buf.readUInt16LE(28);
  const startDanych = 30 + nazwaLen + dodatkoweLen;
  const skompresowane = buf.subarray(startDanych);

  // Pole "compressed size" w nagłówku ZIP tej aplikacji bywa nierzetelne, więc
  // podajemy WSZYSTKO po nagłówku (razem z doklejonym katalogiem centralnym
  // ZIP). Z_SYNC_FLUSH każe zlib oddać to, co rozpakował, i nie wywalać się na
  // śmieciach po prawdziwych danych — odpowiednik "junk after end" łapanego w
  // wersji przeglądarkowej (podsluch-danych-produktu.js).
  let tekst;
  try {
    const rozkompresowane = zlib.inflateRawSync(skompresowane, {
      finishFlush: zlib.constants.Z_SYNC_FLUSH
    });
    tekst = rozkompresowane.toString('utf8');
  } catch (e) { return null; }

  try { return JSON.parse(tekst); } catch (e) { return null; }
}

// Z obiektu odpowiedzi wyciąga DataTable karty: nazwy pól + wiersze zmapowane
// na obiekty {nazwaPola: wartość}. Zwraca null, jeśli to nie odpowiedź typu
// RefreshDataSetSQL_Synchronous z DataTable.
function extractCardRecord(decoded) {
  const refresh = decoded
    && decoded.Result
    && decoded.Result.RefreshObjectReturnList
    && decoded.Result.RefreshObjectReturnList[0];
  if (!refresh || !refresh.DataTable || !refresh.DataTable.FieldDefs) return null;

  const dt = refresh.DataTable;
  const nazwyPol = dt.FieldDefs.map(f => f.FieldName);
  const wiersze = dt.Records || dt.Rows || dt.Data || dt.records || dt.rows || dt.data;

  // W odpowiedzi z Playwrighta każda komórka bywa opakowana jako obiekt z
  // jednym kluczem, np. {"Item": "0000031"} zamiast surowej wartości "0000031"
  // (klucz opakowania = nazwa encji wiersza, ta sama dla wszystkich pól).
  // Rozpakowujemy to do skalarów. Wariant array-owy (jak łapała sonda w
  // przeglądarce) zostaje mapowany po kolejności FieldDefs.
  function odpakuj(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const klucze = Object.keys(v);
      if (klucze.length === 1) return v[klucze[0]];
    }
    return v;
  }

  const records = (wiersze || []).map(w => {
    if (Array.isArray(w)) {
      return nazwyPol.reduce((acc, n, i) => { acc[n] = odpakuj(w[i]); return acc; }, {});
    }
    const rec = {};
    Object.keys(w).forEach(k => { rec[k] = odpakuj(w[k]); });
    return rec;
  });

  return {
    dataSetIdent: refresh.DataSetSQLIdent || null,
    fieldNames: nazwyPol,
    records: records
  };
}

module.exports = { decodeJsonResult, extractCardRecord };
