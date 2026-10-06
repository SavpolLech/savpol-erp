// Zapis dokumentów sprzedaży (nagłówek + pozycje z karty) do bazy "worek".
//
// Tylko dopisujemy: dokument (csDocsHeadersId) już obecny w tabeli nagłówków
// jest pomijany razem z pozycjami, istniejących wierszy nie zmieniamy
// (decyzja 2026-09-30, ROZBIEZNOSCI.md). Nagłówek i pozycje w jednej
// transakcji — bez dokumentów z połową pozycji.
//
//   const z = await przygotujZapis(pool, realne);
//   const obecne = await z.obecneId(ids);
//   await z.wstaw({ naglowek, pozycje });

const W = require('./wspolne');

async function kolumnyTabeli(pool, tabela) {
  const rs = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + tabela + "' ORDER BY ORDINAL_POSITION");
  const nazwy = rs.recordset.map(r => r.COLUMN_NAME);
  if (!nazwy.length) throw new Error('Brak dbo.' + tabela);
  const { found } = await W.schema.fetchColumnsMeta(pool, 'dbo', tabela, nazwy);
  return found.filter(c => !c.IS_COMPUTED);
}

async function wstawWiersz(request, tabela, kolumny, meta, rekord) {
  const cols = [], params = [];
  kolumny.forEach((c, i) => {
    request.input('p' + i, W.mssqlType(c), W.wartosc(rekord[c.COLUMN_NAME], meta(c)));
    cols.push('[' + c.COLUMN_NAME + ']');
    params.push('@p' + i);
  });
  await request.query('INSERT INTO dbo.' + tabela + ' (' + cols.join(', ') + ') VALUES (' + params.join(', ') + ')');
}

// realne: true → prawdziwe csDocsHeaders / csDocsItemsPositions, false → *_test.
async function przygotujZapis(pool, realne) {
  const SUF = realne ? '' : '_test';
  const TAB_N = W.TAB_NAGLOWKI + SUF;
  const TAB_P = W.TAB_POZYCJE + SUF;
  const kolN = await kolumnyTabeli(pool, TAB_N);
  const kolP = await kolumnyTabeli(pool, TAB_P);
  // Typy i NOT NULL z produkcji — tabele _test mają luźniejsze ograniczenia.
  const prod = new Map();
  for (const t of [W.TAB_NAGLOWKI, W.TAB_POZYCJE]) (await kolumnyTabeli(pool, t)).forEach(c => prod.set(t + '.' + c.COLUMN_NAME, c));
  const metaN = c => prod.get(W.TAB_NAGLOWKI + '.' + c.COLUMN_NAME) || c;
  const metaP = c => prod.get(W.TAB_POZYCJE + '.' + c.COLUMN_NAME) || c;
  let sprawdzoneKolumny = false;

  async function obecneId(ids) {
    const obecne = new Set();
    ids = ids.map(String).filter(id => /^\d+$/.test(id));
    for (let i = 0; i < ids.length; i += 1000) {
      const rs = await pool.request().query('SELECT CAST(csDocsHeadersId AS varchar(30)) AS id FROM dbo.' + TAB_N +
        ' WHERE csDocsHeadersId IN (' + ids.slice(i, i + 1000).join(',') + ')');
      rs.recordset.forEach(r => obecne.add(r.id));
    }
    return obecne;
  }

  async function wstaw(w) {
    if (!sprawdzoneKolumny) {
      const brak = kolN.filter(c => !(c.COLUMN_NAME in w.naglowek)).map(c => c.COLUMN_NAME);
      if (brak.length) console.warn('[zapis] UWAGA: karta nie ma kolumn nagłówka (zostaną NULL): ' + brak.join(', '));
      sprawdzoneKolumny = true;
    }
    const tx = new W.sql.Transaction(pool);
    await tx.begin();
    try {
      await wstawWiersz(tx.request(), TAB_N, kolN, metaN, w.naglowek);
      for (const p of w.pozycje) await wstawWiersz(tx.request(), TAB_P, kolP, metaP, p);
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (e2) { /* transakcja już zamknięta */ }
      throw new Error(w.naglowek.DocNumber + ': ' + e.message);
    }
  }

  return { TAB_N, TAB_P, obecneId, wstaw };
}

module.exports = { przygotujZapis };
