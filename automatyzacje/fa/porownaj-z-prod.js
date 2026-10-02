// Kalibracja: porównuje faktury w dbo.csDocsHeaders_test / csDocsItemsPositions_test
// (ze scrapera) z produkcyjnymi csDocsHeaders / csDocsItemsPositions kolumna po
// kolumnie — ta sama metoda co próbka kontrahentów.
//
// Uruchomienie: node porownaj-z-prod.js [id...]
// Bez id: wszystkie FA z dbo.csDocsHeaders_test. Różnica w lastModifiedDate /
// updCount z ERP późniejszym niż w produkcji = faktura zmieniona w ERP po kopii
// bazy (np. zaksięgowana, zapłacona), nie błąd scrapera.

const W = require('./lib/wspolne');

function norm(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '');
  if (Buffer.isBuffer(v)) return 'bin:' + v.toString('base64').slice(0, 20) + '…(' + v.length + ' B)';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}
const skrot = s => s === null ? null : (s.length > 80 ? s.slice(0, 60) + '…(' + s.length + ' zn.)' : s);

function porownaj(t, p, kolumny, etykieta, perKolumna) {
  const roznice = kolumny.filter(k => norm(t[k]) !== norm(p[k]));
  roznice.forEach(k => {
    console.log('    ' + etykieta + k + ': prod=' + JSON.stringify(skrot(norm(p[k]))) + '  ERP=' + JSON.stringify(skrot(norm(t[k]))));
    perKolumna.set(k, (perKolumna.get(k) || 0) + 1);
  });
  return roznice.length;
}

async function main() {
  const filtr = process.argv.slice(2).filter(a => /^\d+$/.test(a));
  const pool = await W.polacz();
  try {
    const q = async s => (await pool.request().query(s)).recordset;
    const where = filtr.length ? 'csDocsHeadersId IN (' + filtr.map(Number).join(',') + ')' : 'csDocsTypesId = ' + W.FA_DOC_TYPE_ID;
    const test = await q('SELECT * FROM dbo.csDocsHeaders_test WHERE ' + where);
    if (!test.length) throw new Error('Brak faktur w dbo.csDocsHeaders_test (dla podanych id).');
    const lista = test.map(r => Number(r.csDocsHeadersId)).join(',');
    const prod = new Map((await q('SELECT * FROM dbo.csDocsHeaders WHERE csDocsHeadersId IN (' + lista + ')')).map(r => [String(r.csDocsHeadersId), r]));
    const grupuj = rows => rows.reduce((m, r) => { const k = String(r.csDocsHeadersId); (m.get(k) || m.set(k, []).get(k)).push(r); return m; }, new Map());
    const pozT = grupuj(await q('SELECT * FROM dbo.csDocsItemsPositions_test WHERE csDocsHeadersId IN (' + lista + ')'));
    const pozP = grupuj(await q('SELECT * FROM dbo.csDocsItemsPositions WHERE csDocsHeadersId IN (' + lista + ')'));

    const kolN = Object.keys(test[0]);
    const perKolumna = new Map();
    let porownane = 0, pozycji = 0, kolP = 0;
    for (const t of test) {
      const id = String(t.csDocsHeadersId);
      const p = prod.get(id);
      if (!p) { console.log('[' + t.DocNumber + '] brak w produkcji (nowsza niż kopia bazy), pomijam.'); continue; }
      porownane++;
      console.log('[' + t.DocNumber + '] lastModifiedDate prod ' + norm(p.lastModifiedDate) + ', ERP ' + norm(t.lastModifiedDate));
      const rN = porownaj(t, p, kolN, '', perKolumna);
      const pt = new Map((pozT.get(id) || []).map(r => [String(r.csDocsItemsPositionsId), r]));
      const pp = new Map((pozP.get(id) || []).map(r => [String(r.csDocsItemsPositionsId), r]));
      let rP = 0;
      for (const [pid, r] of pt) {
        const q2 = pp.get(pid);
        if (!q2) { console.log('    pozycja ' + pid + ': brak w produkcji'); rP++; continue; }
        kolP = Object.keys(r).length;
        pozycji++;
        rP += porownaj(r, q2, Object.keys(r), 'poz.' + pid + '.', perKolumna);
      }
      for (const pid of pp.keys()) if (!pt.has(pid)) { console.log('    pozycja ' + pid + ': brak w ERP'); rP++; }
      console.log('    → nagłówek: zgodnych ' + (kolN.length - rN) + '/' + kolN.length + '; pozycje: ' + pt.size + ' ERP / ' + pp.size + ' prod, różnic ' + rP);
    }
    console.log('\n[podsumowanie] Porównano ' + porownane + ' faktur (' + kolN.length + ' kolumn) i ' + pozycji + ' pozycji (' + kolP + ' kolumn).');
    if (perKolumna.size) console.log('[podsumowanie] Kolumny z różnicami: ' +
      Array.from(perKolumna).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(', '));
    else console.log('[podsumowanie] Wszystkie kolumny zgodne 1:1.');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[porownaj] BŁĄD:', err.message); process.exit(1); });
