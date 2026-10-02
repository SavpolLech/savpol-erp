// Wgrywa zescrapowanych kontrahentów (JSON z wynik/) do bazy "worek", tabeli
// TESTOWEJ dbo.csCustomers_test — jak produkty/wgraj-do-worek.js. Tabela ma
// WSZYSTKIE kolumny dbo.csCustomers z tymi samymi typami (karta ERP pokrywa
// 168/168), więc próbkę da się porównać z produkcją 1:1 (porownaj-z-prod.js).
//
// Tylko dopisujemy: id już obecne w tabeli docelowej są pomijane, istniejących
// wierszy nie zmieniamy (decyzja 2026-09-30, ROZBIEZNOSCI.md).
//
// Uruchomienie: node wgraj-do-worek.js [id...] [--realne]
// Bez id bierze wszystkie wynik/kontrahent_*.json.
// --realne: pisz do PRAWDZIWEJ dbo.csCustomers — dopiero po akceptacji
// próbki przez Michała.

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');

const REALNE = process.argv.includes('--realne');
const TABELA = REALNE ? W.PROD_TABLE : W.PROD_TABLE + '_test';

function wczytajWyniki(filtr) {
  if (!fs.existsSync(W.OUT_DIR)) return [];
  return fs.readdirSync(W.OUT_DIR)
    .filter(f => /^kontrahent_\d+\.json$/.test(f))
    .map(f => JSON.parse(fs.readFileSync(path.join(W.OUT_DIR, f), 'utf8')))
    .filter(d => !filtr.length || filtr.includes(String(d.csCustomersId)));
}

async function kolumnyTabeli(pool, tabela) {
  const rs = await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + tabela + "' ORDER BY ORDINAL_POSITION");
  const nazwy = rs.recordset.map(r => r.COLUMN_NAME);
  if (!nazwy.length) return [];
  const { found } = await W.schema.fetchColumnsMeta(pool, 'dbo', tabela, nazwy);
  return found.filter(c => !c.IS_COMPUTED);
}

async function main() {
  const filtr = process.argv.slice(2).filter(a => /^\d+$/.test(a));
  const wyniki = wczytajWyniki(filtr);
  if (!wyniki.length) throw new Error('Brak wyników w ' + W.OUT_DIR + ' (uruchom najpierw scrape.js).');
  console.log('[wgraj] Kart do wgrania: ' + wyniki.length + ' → dbo.' + TABELA);

  const pool = await W.polacz();
  try {
    let kolumny = await kolumnyTabeli(pool, TABELA);
    if (!kolumny.length) {
      if (REALNE) throw new Error('Brak dbo.' + TABELA);
      // Tabela testowa z pełnym schematem produkcji (wszystkie kolumny NULL —
      // tabela robocza, bez kluczy; jak csItems_test).
      kolumny = await kolumnyTabeli(pool, W.PROD_TABLE);
      const ddl = W.schema.buildCreateTableSQL(TABELA, kolumny.map(c =>
        c.DATA_TYPE === 'varbinary' ? Object.assign({}, c, { DATA_TYPE: 'varbinary(' + (c.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : c.CHARACTER_MAXIMUM_LENGTH) + ')' }) : c));
      await pool.request().query(ddl);
      console.log('[wgraj] Utworzono dbo.' + TABELA + ' (' + kolumny.length + ' kolumn jak dbo.' + W.PROD_TABLE + ').');
    }

    // Typy i NOT NULL z produkcji — tabela _test ma wszystkie kolumny NULL.
    const prodMeta = new Map((await kolumnyTabeli(pool, W.PROD_TABLE)).map(c => [c.COLUMN_NAME, c]));
    const metaProd = c => prodMeta.get(c.COLUMN_NAME) || c;

    const brakWKarcie = kolumny.filter(c => !(c.COLUMN_NAME in wyniki[0].rekord)).map(c => c.COLUMN_NAME);
    if (brakWKarcie.length) console.warn('[wgraj] UWAGA: karta nie ma kolumn (zostaną NULL): ' + brakWKarcie.join(', '));

    const ids = wyniki.map(w => String(w.csCustomersId));
    const obecne = new Set();
    for (let i = 0; i < ids.length; i += 1000) {
      const rs = await pool.request().query('SELECT CAST(csCustomersId AS varchar(30)) AS id FROM dbo.' + TABELA +
        ' WHERE csCustomersId IN (' + ids.slice(i, i + 1000).map(Number).join(',') + ')');
      rs.recordset.forEach(r => obecne.add(r.id));
    }
    const nowe = wyniki.filter(w => !obecne.has(String(w.csCustomersId)));
    if (obecne.size) console.log('[wgraj] Pomijam ' + obecne.size + ' już obecnych w dbo.' + TABELA + ' (tylko dopisujemy).');

    let wstawione = 0;
    for (const w of nowe) {
      const request = pool.request();
      const cols = [], params = [];
      kolumny.forEach((c, i) => {
        request.input('p' + i, W.mssqlType(c), W.wartosc(w.rekord[c.COLUMN_NAME], metaProd(c)));
        cols.push('[' + c.COLUMN_NAME + ']');
        params.push('@p' + i);
      });
      await request.query('INSERT INTO dbo.' + TABELA + ' (' + cols.join(', ') + ') VALUES (' + params.join(', ') + ')');
      wstawione++;
    }
    console.log('[wgraj] SUKCES: wstawiono ' + wstawione + ' kontrahentów do dbo.' + TABELA + '.');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj] BŁĄD:', err.message); process.exit(1); });
