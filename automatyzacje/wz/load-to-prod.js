// Załadunek WZ z tabel testowych do PRODUKCYJNYCH w bazie worek.
//
// Kopiuje wiersze csDocsHeaders_test -> csDocsHeaders oraz
// csDocsItemsPositions_test -> csDocsItemsPositions dla podanych zakresów dat,
// serwerowym INSERT ... SELECT (bez re-scrapowania — _test już ma kompletne,
// otypowane rekordy ze sztywnymi wartościami Michała).
//
// DLACZEGO to bezpieczne (zweryfikowane 2026-09-23 kwerendami):
//  - _test ma DOKŁADNIE te same 273 kolumny co produkcja (_test ⊆ prod),
//  - wszystkie 51 (nagłówek) / 10 (pozycje) kolumn NOT NULL bez defaultu są
//    wypełnione w _test (pola scrapowane ∪ fixed-values.js),
//  - produkcyjne tabele nie mają kolumn computed/identity ani triggerów,
//  - dedup po kluczu głównym (NOT EXISTS) — nie dubluje wierszy już w produkcji.
// Każdy zakres idzie w OSOBNEJ transakcji: nagłówki, potem pozycje (FK spełniony
// w tej samej transakcji). Błąd na jednym zakresie nie psuje pozostałych.
//
// Uruchomienie:
//   node load-to-prod.js                      # domyślne zakresy Michała
//   node load-to-prod.js 2026-09-01 2026-09-10  # jeden zakres (from to)
//   node load-to-prod.js --dry-run            # próbny przebieg z ROLLBACK

require('dotenv').config();
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const sql = require('mssql');

const H_TEST = 'csDocsHeaders_test', H_PROD = 'csDocsHeaders';
const P_TEST = 'csDocsItemsPositions_test', P_PROD = 'csDocsItemsPositions';

// Domyślne zakresy zgłoszone przez Michała (2026-09-23).
const DEFAULT_RANGES = [
  ['2026-07-25', '2026-08-02'],
  ['2026-09-01', '2026-09-10'],
  ['2026-09-17', '2026-09-22'],
];

async function columnList(pool, table) {
  const r = await pool.request().query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table}' ORDER BY ORDINAL_POSITION`);
  return r.recordset.map(x => '[' + x.COLUMN_NAME + ']').join(',');
}

async function dayCounts(pool, table, from, to) {
  const r = await pool.request().query(
    `SELECT CAST(DocDate AS date) d, COUNT(*) n FROM dbo.${table}
     WHERE CAST(DocDate AS date) BETWEEN '${from}' AND '${to}'
     GROUP BY CAST(DocDate AS date) ORDER BY d`);
  return r.recordset;
}

async function loadRange(pool, hcols, pcols, from, to, dryRun) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Nagłówki: te z zakresu w _test, których NIE ma jeszcze w produkcji.
    const h = await new sql.Request(tx).query(
      `INSERT INTO dbo.${H_PROD} (${hcols})
       SELECT ${hcols} FROM dbo.${H_TEST} t
       WHERE CAST(t.DocDate AS date) BETWEEN '${from}' AND '${to}'
         AND NOT EXISTS (SELECT 1 FROM dbo.${H_PROD} p WHERE p.csDocsHeadersId = t.csDocsHeadersId)`);
    // Pozycje: należące do dokumentów z zakresu, których PK nie ma w produkcji.
    const p = await new sql.Request(tx).query(
      `INSERT INTO dbo.${P_PROD} (${pcols})
       SELECT ${pcols} FROM dbo.${P_TEST} tp
       WHERE tp.csDocsHeadersId IN (
               SELECT th.csDocsHeadersId FROM dbo.${H_TEST} th
               WHERE CAST(th.DocDate AS date) BETWEEN '${from}' AND '${to}')
         AND NOT EXISTS (SELECT 1 FROM dbo.${P_PROD} pp WHERE pp.csDocsItemsPositionsId = tp.csDocsItemsPositionsId)`);
    if (dryRun) {
      await tx.rollback();
      console.log(`  [dry-run] ${from}..${to}: nagłówki +${h.rowsAffected[0]}, pozycje +${p.rowsAffected[0]} (ROLLBACK)`);
    } else {
      await tx.commit();
      console.log(`  ${from}..${to}: nagłówki +${h.rowsAffected[0]}, pozycje +${p.rowsAffected[0]} (COMMIT)`);
    }
    return { headers: h.rowsAffected[0], positions: p.rowsAffected[0] };
  } catch (e) {
    await tx.rollback();
    console.error(`  BŁĄD na ${from}..${to} — ROLLBACK: ${e.message}`);
    throw e;
  }
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dates = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const ranges = dates.length === 2 ? [[dates[0], dates[1]]] : DEFAULT_RANGES;

  const pool = await new sql.ConnectionPool({
    server: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '1433', 10),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 30000, requestTimeout: 120000
  }).connect();

  const hcols = await columnList(pool, H_TEST);
  const pcols = await columnList(pool, P_TEST);
  console.log((dryRun ? '[DRY-RUN] ' : '') + 'Załadunek WZ _test -> PRODUKCJA (' + process.env.DB_NAME + '), zakresy:',
    ranges.map(r => r.join('..')).join(', '));

  let sumH = 0, sumP = 0;
  for (const [from, to] of ranges) {
    const r = await loadRange(pool, hcols, pcols, from, to, dryRun);
    sumH += r.headers; sumP += r.positions;
  }
  console.log(`\nRAZEM: nagłówki +${sumH}, pozycje +${sumP}` + (dryRun ? ' (nic nie zapisano — dry-run)' : ''));

  if (!dryRun) {
    console.log('\nWeryfikacja — liczba wierszy w PRODUKCJI per dzień po załadunku:');
    for (const [from, to] of ranges) {
      const rows = await dayCounts(pool, H_PROD, from, to);
      console.log(`  ${from}..${to}: dni z danymi ${rows.length}`);
      rows.forEach(x => console.log('     ', x.d.toISOString().slice(0, 10), x.n));
    }
  }
  await pool.close();
})().catch(e => { console.error('BŁĄD KRYTYCZNY:', e.message); process.exit(1); });
