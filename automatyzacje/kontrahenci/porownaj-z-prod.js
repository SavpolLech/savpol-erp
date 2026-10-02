// Kalibracja: porównuje dbo.csCustomers_test (ze scrapera) z produkcyjną
// dbo.csCustomers kolumna po kolumnie dla id obecnych w obu tabelach —
// ta sama metoda co próbka WZ (1 lipca), którą Michał sprawdzał 1:1.
//
// Uruchomienie: node porownaj-z-prod.js [id...]
// Wypisuje różnice per kolumna. Różnica przy LastChangeDate z ERP późniejszym
// niż w produkcji = kontrahent zmieniony w ERP po kopii bazy, nie błąd scrapera.

const W = require('./lib/wspolne');

function norm(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.000Z$|Z$/, '');
  if (Buffer.isBuffer(v)) return 'bin:' + v.toString('base64').slice(0, 20) + '…(' + v.length + ' B)';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

async function main() {
  const filtr = process.argv.slice(2).filter(a => /^\d+$/.test(a));
  const pool = await W.polacz();
  try {
    const where = filtr.length ? ' WHERE t.csCustomersId IN (' + filtr.map(Number).join(',') + ')' : '';
    const test = (await pool.request().query('SELECT t.* FROM dbo.csCustomers_test t' + where)).recordset;
    if (!test.length) throw new Error('Pusta dbo.csCustomers_test (dla podanych id).');
    const prod = new Map((await pool.request().query('SELECT * FROM dbo.csCustomers WHERE csCustomersId IN (' +
      test.map(r => Number(r.csCustomersId)).join(',') + ')')).recordset.map(r => [String(r.csCustomersId), r]));

    const kolumny = Object.keys(test[0]);
    const perKolumna = new Map();
    let porownane = 0;
    for (const t of test) {
      const p = prod.get(String(t.csCustomersId));
      if (!p) { console.log('[' + t.csCustomersId + '] ' + t.CustomerDesc + ' — brak w produkcji (nowy kontrahent), pomijam.'); continue; }
      porownane++;
      const roznice = kolumny.filter(k => norm(t[k]) !== norm(p[k]));
      console.log('[' + t.csCustomersId + '] ' + t.CustomerDesc + ' — zgodnych ' + (kolumny.length - roznice.length) + '/' + kolumny.length +
        ' | LastChangeDate prod ' + norm(p.LastChangeDate) + ', ERP ' + norm(t.LastChangeDate));
      roznice.forEach(k => {
        console.log('    ' + k + ': prod=' + JSON.stringify(norm(p[k])) + '  ERP=' + JSON.stringify(norm(t[k])));
        perKolumna.set(k, (perKolumna.get(k) || 0) + 1);
      });
    }
    console.log('\n[podsumowanie] Porównano ' + porownane + ' kontrahentów, ' + kolumny.length + ' kolumn.');
    if (perKolumna.size) console.log('[podsumowanie] Kolumny z różnicami: ' +
      Array.from(perKolumna).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(', '));
    else console.log('[podsumowanie] Wszystkie kolumny zgodne 1:1.');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[porownaj] BŁĄD:', err.message); process.exit(1); });
