// Wykrywanie rozbieżności ERP↔worek dla rekordów, które już są w bazie.
// Decyzja Lecha 2026-09-30: do worka TYLKO dopisujemy — istniejących rekordów
// nie zmieniamy; różnicę logujemy i zgłaszamy (lib-wspolne/powiadom.js).
// Reguły porównania jak w mm/scrape.js (valuesEqual/diffFields).

const path = require('path');
const fs = require('fs');
const { mssqlType, coerceValue } = require(path.join(__dirname, '..', '..', 'wz', 'lib', 'schema'));
const powiadom = require(path.join(__dirname, '..', '..', 'lib-wspolne', 'powiadom'));

const empty = (v) => v === null || v === undefined || v === '';

const LICZBOWE = new Set(['int', 'bigint', 'smallint', 'tinyint', 'bit', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney']);

function valuesEqual(oldVal, newVal, col) {
  if (empty(oldVal) && empty(newVal)) return true;
  // NULL w bazie vs 0 w ERP (flagi, wagi) to niewypełnione pole, nie zmiana danych.
  if (empty(oldVal) && LICZBOWE.has(col.DATA_TYPE) && Number(newVal) === 0) return true;
  if (empty(oldVal) || empty(newVal)) return false;
  switch (col.DATA_TYPE) {
    case 'date': case 'datetime': case 'datetime2': case 'smalldatetime': {
      const d = (v) => (v instanceof Date ? v : new Date(v));
      const a = d(oldVal), b = d(newVal);
      if (isNaN(a.getTime()) || isNaN(b.getTime())) return String(oldVal) === String(newVal);
      return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
    }
    case 'int': case 'bigint': case 'smallint': case 'tinyint': {
      const norm = (v) => (typeof v === 'number' ? String(Math.trunc(v)) : String(v).replace(/\s/g, '').trim());
      return norm(oldVal) === norm(newVal);
    }
    case 'decimal': case 'numeric': case 'float': case 'real': case 'money': case 'smallmoney': {
      const a = Number(oldVal), b = Number(newVal);
      if (isNaN(a) || isNaN(b)) return String(oldVal) === String(newVal);
      return Math.abs(a - b) < 1e-6;
    }
    case 'bit':
      return (Number(oldVal) ? 1 : 0) === (Number(newVal) ? 1 : 0);
    case 'uniqueidentifier':
      return String(oldVal).toLowerCase() === String(newVal).toLowerCase();
    default:
      return String(oldVal).trim() === String(newVal).trim();
  }
}

function fmtVal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// Porównuje rekordy (już obecne w bazie po kluczu idCol) z wierszami tabeli.
// wartosc(rekord, nazwaKolumny) zwraca surową wartość ze scrapu; opis(rekord)
// → { sku, csItemsId }. Zwraca [{ sku, csItemsId, id, zmiany:[{pole,baza,erp}] }].
async function porownajIstniejace(pool, { tabela, idCol, kolumny, rekordy, wartosc, opis }) {
  const idMeta = kolumny.find(c => c.COLUMN_NAME === idCol);
  const doPorownania = kolumny.filter(c => !c.IS_COMPUTED && c.COLUMN_NAME !== idCol);
  if (!idMeta || !rekordy.length) return [];

  const zBazy = new Map();
  const cols = [idMeta].concat(doPorownania).map(c => '[' + c.COLUMN_NAME + ']').join(', ');
  for (let i = 0; i < rekordy.length; i += 1000) {
    const paczka = rekordy.slice(i, i + 1000);
    const request = pool.request();
    const ph = paczka.map((r, j) => {
      request.input('r' + j, mssqlType(idMeta), coerceValue(wartosc(r, idCol), idMeta));
      return '@r' + j;
    });
    const rs = await request.query('SELECT ' + cols + ' FROM dbo.' + tabela + ' WHERE [' + idCol + '] IN (' + ph.join(', ') + ')');
    rs.recordset.forEach(w => zBazy.set(String(w[idCol]), w));
  }

  const wynik = [];
  for (const r of rekordy) {
    const id = String(coerceValue(wartosc(r, idCol), idMeta));
    const dbRow = zBazy.get(id);
    if (!dbRow) continue;
    const zmiany = [];
    for (const col of doPorownania) {
      const nowa = coerceValue(wartosc(r, col.COLUMN_NAME), col);
      if (empty(nowa)) continue; // puste z ERP to nie różnica
      if (!valuesEqual(dbRow[col.COLUMN_NAME], nowa, col)) {
        zmiany.push({ pole: tabela + '.' + col.COLUMN_NAME, baza: fmtVal(dbRow[col.COLUMN_NAME]), erp: fmtVal(nowa) });
      }
    }
    if (zmiany.length) wynik.push(Object.assign({ id, zmiany }, opis(r)));
  }
  return wynik;
}

// wgraj-*.js porównują za każdym razem WSZYSTKIE produkty z wynik/, a bazy
// nie zmieniamy — ta sama różnica wracałaby w każdym biegu. Pamiętamy więc
// zgłoszone (tabela.pole|csItemsId|wartość ERP); nowa wartość w ERP = nowe
// zgłoszenie. Plik w wynik/ (poza repo — zawiera dane produktów).
const ZGLOSZONE = path.join(__dirname, '..', 'wynik', 'rozbieznosci-zgloszone.json');
const kluczZmiany = (r, z) => [z.pole, r.csItemsId, z.erp].join('|');

function wczytajZgloszone() {
  try { return new Set(JSON.parse(fs.readFileSync(ZGLOSZONE, 'utf8'))); } catch (e) { return new Set(); }
}

// Zostawia tylko niezgłoszone wcześniej zmiany; loguje je, resztę liczy.
function tylkoNowe(prefix, rozb) {
  const znane = wczytajZgloszone();
  let pominiete = 0;
  const nowe = [];
  for (const r of rozb) {
    const zmiany = r.zmiany.filter(z => !znane.has(kluczZmiany(r, z)));
    pominiete += r.zmiany.length - zmiany.length;
    if (zmiany.length) nowe.push(Object.assign({}, r, { zmiany }));
  }
  for (const r of nowe) {
    for (const z of r.zmiany) {
      console.warn('[rozbieżność] ' + (r.sku || '?') + ' (csItemsId=' + r.csItemsId + '): ' + z.pole + ': ' +
        z.baza + ' -> ' + z.erp + ' — rekord w bazie NIE zmieniony, tylko zgłoszenie.');
    }
  }
  if (nowe.length) console.warn(prefix + ' NOWE rozbieżności ERP↔worek: ' + nowe.length + ' rekordów (baza bez zmian).');
  if (pominiete) console.log(prefix + ' ' + pominiete + ' rozbieżności zgłoszonych już wcześniej — pomijam.');
  return nowe;
}

function zapamietaj(rozb) {
  const znane = wczytajZgloszone();
  rozb.forEach(r => r.zmiany.forEach(z => znane.add(kluczZmiany(r, z))));
  fs.mkdirSync(path.dirname(ZGLOSZONE), { recursive: true });
  fs.writeFileSync(ZGLOSZONE, JSON.stringify(Array.from(znane), null, 0), 'utf8');
}

// Grupuje po produkcie do formatu powiadom.js (SKU w docNumber, csItemsId
// w csDocsHeadersId, pola w zmianyNaglowka) i wysyła jedno zgłoszenie na bieg.
async function zglos(label, rozb) {
  if (!rozb.length) return;
  zapamietaj(rozb);
  const perProdukt = new Map();
  for (const r of rozb) {
    const k = String(r.csItemsId);
    if (!perProdukt.has(k)) perProdukt.set(k, { docNumber: r.sku || null, csDocsHeadersId: k, zmianyNaglowka: [], zmianyPozycji: [] });
    perProdukt.get(k).zmianyNaglowka.push(...r.zmiany);
  }
  await powiadom('produkty', Array.from(perProdukt.values()), { label });
}

module.exports = { porownajIstniejace, tylkoNowe, zglos };
