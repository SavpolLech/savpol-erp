// Wgrywa zescrapowane faktury (JSON z wynik/) do bazy "worek", do tabel
// TESTOWYCH dbo.csDocsHeaders_test / dbo.csDocsItemsPositions_test (Michał:
// faktury ładujemy jak WZ/MM/PZ). Karta ERP pokrywa wszystkie kolumny obu
// tabel, więc próbkę da się porównać z produkcją 1:1 (porownaj-z-prod.js).
//
// Tylko dopisujemy: faktura (csDocsHeadersId) już obecna w tabeli nagłówków
// jest pomijana razem z pozycjami, istniejących wierszy nie zmieniamy
// (decyzja 2026-09-30, ROZBIEZNOSCI.md).
//
// Uruchomienie: node wgraj-do-worek.js [id...] [--realne]
// Bez id bierze wszystkie wynik/fa_*.json.
// --realne: pisz do PRAWDZIWYCH tabel — dopiero po akceptacji próbki przez Michała.

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');

const REALNE = process.argv.includes('--realne');
const SUF = REALNE ? '' : '_test';
const TAB_N = W.TAB_NAGLOWKI + SUF;
const TAB_P = W.TAB_POZYCJE + SUF;

function wczytajWyniki(filtr) {
  if (!fs.existsSync(W.OUT_DIR)) return [];
  return fs.readdirSync(W.OUT_DIR)
    .filter(f => /^fa_\d+\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(W.OUT_DIR, f), 'utf8')))
    .filter(d => !filtr.length || filtr.includes(String(d.csDocsHeadersId)));
}

async function kolumnyTabeli(pool, tabela) {
  const rs = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + tabela + "' ORDER BY ORDINAL_POSITION");
  const nazwy = rs.recordset.map(r => r.COLUMN_NAME);
  if (!nazwy.length) throw new Error('Brak dbo.' + tabela);
  const { found } = await W.schema.fetchColumnsMeta(pool, 'dbo', tabela, nazwy);
  return found.filter(c => !c.IS_COMPUTED);
}

async function wstaw(pool, tabela, kolumny, metaProd, rekord) {
  const request = pool.request();
  const cols = [], params = [];
  kolumny.forEach((c, i) => {
    request.input('p' + i, W.mssqlType(c), W.wartosc(rekord[c.COLUMN_NAME], metaProd(c)));
    cols.push('[' + c.COLUMN_NAME + ']');
    params.push('@p' + i);
  });
  await request.query('INSERT INTO dbo.' + tabela + ' (' + cols.join(', ') + ') VALUES (' + params.join(', ') + ')');
}

async function main() {
  const filtr = process.argv.slice(2).filter(a => /^\d+$/.test(a));
  const wyniki = wczytajWyniki(filtr);
  if (!wyniki.length) throw new Error('Brak wyników w ' + W.OUT_DIR + ' (uruchom najpierw scrape.js).');
  console.log('[wgraj] Faktur do wgrania: ' + wyniki.length + ' → dbo.' + TAB_N + ' / dbo.' + TAB_P);

  const pool = await W.polacz();
  try {
    const kolN = await kolumnyTabeli(pool, TAB_N);
    const kolP = await kolumnyTabeli(pool, TAB_P);
    // Typy i NOT NULL z produkcji — tabele _test mają luźniejsze ograniczenia.
    const prod = new Map();
    for (const t of [W.TAB_NAGLOWKI, W.TAB_POZYCJE]) (await kolumnyTabeli(pool, t)).forEach(c => prod.set(t + '.' + c.COLUMN_NAME, c));
    const metaN = c => prod.get(W.TAB_NAGLOWKI + '.' + c.COLUMN_NAME) || c;
    const metaP = c => prod.get(W.TAB_POZYCJE + '.' + c.COLUMN_NAME) || c;

    const brakN = kolN.filter(c => !(c.COLUMN_NAME in wyniki[0].naglowek)).map(c => c.COLUMN_NAME);
    if (brakN.length) console.warn('[wgraj] UWAGA: karta nie ma kolumn nagłówka (zostaną NULL): ' + brakN.join(', '));

    const ids = wyniki.map(w => String(w.csDocsHeadersId));
    const obecne = new Set();
    for (let i = 0; i < ids.length; i += 1000) {
      const rs = await pool.request().query('SELECT CAST(csDocsHeadersId AS varchar(30)) AS id FROM dbo.' + TAB_N +
        ' WHERE csDocsHeadersId IN (' + ids.slice(i, i + 1000).map(Number).join(',') + ')');
      rs.recordset.forEach(r => obecne.add(r.id));
    }
    const nowe = wyniki.filter(w => !obecne.has(String(w.csDocsHeadersId)));
    if (obecne.size) console.log('[wgraj] Pomijam ' + obecne.size + ' faktur już obecnych w dbo.' + TAB_N + ' (tylko dopisujemy).');

    let fa = 0, poz = 0;
    for (const w of nowe) {
      // Nagłówek i pozycje razem albo wcale — bez faktur z połową pozycji.
      const tx = new W.sql.Transaction(pool);
      await tx.begin();
      try {
        await wstaw(tx, TAB_N, kolN, metaN, w.naglowek);
        for (const p of w.pozycje) await wstaw(tx, TAB_P, kolP, metaP, p);
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw new Error(w.naglowek.DocNumber + ': ' + e.message);
      }
      fa++; poz += w.pozycje.length;
    }
    console.log('[wgraj] SUKCES: wstawiono ' + fa + ' faktur i ' + poz + ' pozycji.');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj] BŁĄD:', err.message); process.exit(1); });
