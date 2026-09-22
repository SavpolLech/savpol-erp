// Wgrywa zescrapowane zdjęcia produktów (JSON z wynik/, pole "zdjecia") do
// bazy "worek", tabeli TESTOWEJ dbo.csPhotos_test — analogicznie do
// wgraj-do-worek.js (csItems_test). Kolumny 1:1 z realną dbo.csPhotos
// (csPhotosId, csCompaniesId, csSourceId, Ord, DoNotShow4Items,
// LocalFileName, RemoteFileName, RemoteIdent, csPhotosTypesG) + JEDNA
// dodatkowa kolumna spoza produkcyjnego schematu: UrlPhotoScraped — link
// gotowy do kliknięcia, żeby Michał mógł od razu zweryfikować zdjęcie bez
// dekodowania niczego. Nazwana tak, żeby nie było pomyłki z realną kolumną
// produkcyjną (której nie ma — PhotoUrl to pole liczone przez API, nie
// kolumna w bazie).
//
// Uruchomienie: node wgraj-zdjecia-do-worek.js [SKU...] [--realne]
// Bez argumentów bierze wszystkie pliki wynik/results-produkt_*.json.
// Flaga --realne: pisz do PRAWDZIWEJ dbo.csPhotos (bez _test). UWAGA: real
// csPhotos ma 2 kolumny NOT NULL bez wartości domyślnej, których API w
// ogóle nie zwraca — IsPrevGenerated i SkipPrevGenerate (flagi wewnętrzne
// dot. generowania miniaturek). Lech, 2026-09-22: ustawiamy obie na 0 jako
// najbezpieczniejsze założenie — NIE potwierdzone przez Michała, do
// zweryfikowania przy pierwszej okazji.

const path = require('path');
const fs = require('fs');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const sql = req('mssql');
const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const { fetchColumnsMeta, mssqlType, coerceValue } =
  require(path.join(__dirname, '..', 'wz', 'lib', 'schema'));

const REALNE = process.argv.includes('--realne');
const TEST_TABLE = REALNE ? 'csPhotos' : 'csPhotos_test';
const OUT_DIR = path.join(__dirname, 'wynik');

// Kolumny 1:1 z produkcyjną dbo.csPhotos (sprawdzone w INFORMATION_SCHEMA,
// 2026-09-14) — typy bierzemy z NIEJ, nie zgadujemy.
const REAL_COLUMNS = ['csPhotosId', 'csPhotosG', 'csCompaniesId', 'csSourceId', 'Ord',
  'DoNotShow4Items', 'LocalFileName', 'RemoteFileName', 'RemoteIdent', 'csPhotosTypesG', 'imageSourceType'];

// Kolumny NOT NULL bez wartości domyślnej w realnej csPhotos, których API
// nie zwraca w ogóle — patrz zastrzeżenie w nagłówku pliku. Dotyczy tylko
// --realne (w _test te kolumny w ogóle nie istnieją, bo _test ma tylko
// REAL_COLUMNS).
const FIXED_ONLY_REALNE = { IsPrevGenerated: 0, SkipPrevGenerate: 0 };

function loadResults(skuFilter) {
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('results-produkt_') && f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const dane = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    if (skuFilter && skuFilter.length && !skuFilter.includes(String(dane.sku))) continue;
    if (dane.zdjecia && dane.zdjecia.length) out.push(dane);
  }
  return out;
}

async function main() {
  const skuFilter = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const produkty = loadResults(skuFilter);
  const wszystkieZdjecia = [];
  produkty.forEach(p => p.zdjecia.forEach(z => wszystkieZdjecia.push(z)));
  if (!wszystkieZdjecia.length) throw new Error('Brak zdjęć do wgrania w ' + OUT_DIR + ' (uruchom najpierw scrape.js).');
  console.log('[wgraj-zdjecia] Znaleziono ' + wszystkieZdjecia.length + ' zdjęć z ' + produkty.length + ' produktów.');

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const database = process.env.DB_NAME || 'worek';
  const pool = await sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database,
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });

  try {
    const { found, missing } = await fetchColumnsMeta(pool, 'dbo', 'csPhotos', REAL_COLUMNS);
    if (missing.length) console.warn('[wgraj-zdjecia] Nie znalazłem w dbo.csPhotos: ' + missing.join(', '));
    const columnsMeta = found.filter(c => !c.IS_COMPUTED);

    const istnieje = await pool.request().query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='" + TEST_TABLE + "'"
    );
    if (istnieje.recordset[0].n === 0) {
      const lines = columnsMeta.map(c => {
        const t = c.DATA_TYPE === 'nvarchar' ? 'nvarchar(' + (c.CHARACTER_MAXIMUM_LENGTH === -1 ? 'MAX' : c.CHARACTER_MAXIMUM_LENGTH) + ')' : c.DATA_TYPE;
        return '  [' + c.COLUMN_NAME + '] ' + t + ' NULL';
      });
      lines.push('  [UrlPhotoScraped] nvarchar(500) NULL'); // POZA schematem produkcyjnym — patrz nagłówek pliku.
      await pool.request().query('CREATE TABLE dbo.' + TEST_TABLE + ' (\n' + lines.join(',\n') + '\n);');
      console.log('[wgraj-zdjecia] Utworzono dbo.' + TEST_TABLE + ' (' + columnsMeta.length + ' realnych kolumn + UrlPhotoScraped).');
    } else {
      console.log('[wgraj-zdjecia] Tabela dbo.' + TEST_TABLE + ' już istnieje — wstawiam do niej.');
    }

    let fixedColumnsMeta = [];
    if (REALNE) {
      const fixedNames = Object.keys(FIXED_ONLY_REALNE);
      const fx = await fetchColumnsMeta(pool, 'dbo', 'csPhotos', fixedNames);
      if (fx.missing.length) console.warn('[wgraj-zdjecia] Nie znalazłem: ' + fx.missing.join(', '));
      fixedColumnsMeta = fx.found.filter(c => !c.IS_COMPUTED);
    }

    // Dedup po csPhotosId, tak jak w wgraj-do-worek.js.
    const idCol = columnsMeta.find(c => c.COLUMN_NAME === 'csPhotosId');
    let existing = new Set();
    if (idCol) {
      const ids = wszystkieZdjecia.map(z => coerceValue(z.csPhotosId, idCol)).filter(v => v !== null);
      if (ids.length) {
        const req2 = pool.request();
        const placeholders = ids.map((id, i) => { req2.input('id' + i, mssqlType(idCol), id); return '@id' + i; });
        const exist = await req2.query(
          'SELECT [csPhotosId] AS id FROM dbo.' + TEST_TABLE + ' WHERE [csPhotosId] IN (' + placeholders.join(', ') + ')'
        );
        existing = new Set(exist.recordset.map(r => String(r.id)));
      }
    }
    const nowe = wszystkieZdjecia.filter(z => !existing.has(String(z.csPhotosId)));
    if (existing.size) console.log('[wgraj-zdjecia] Pominięto ' + existing.size + ' już obecnych (ten sam csPhotosId).');

    // Dane zescrapowane PRZED 2026-09-22 nie mają csPhotosG/imageSourceType
    // (dodane do scrape.js tego dnia) — csPhotosG odzyskujemy z urlPhoto,
    // bo GUID w URL-u (Download/csPhotos_Photo_<GUID>_1.png) to dokładnie
    // ten sam identyfikator (potwierdzone: sprawdzone 1:1 na produkcie
    // 0000031 we wcześniejszej sesji). imageSourceType — brak sposobu na
    // odzyskanie, ale w KAŻDYM dotąd zaobserwowanym rekordzie było 0, więc
    // to bezpieczny fallback, nie zgadywanie z powietrza.
    function uzupelnijBrakujace(z) {
      if (!z.csPhotosG && z.urlPhoto) {
        const m = z.urlPhoto.match(/csPhotos_Photo_([0-9A-Fa-f-]{36})_/);
        if (m) z.csPhotosG = m[1];
      }
      if (z.imageSourceType === undefined || z.imageSourceType === null) z.imageSourceType = 0;
      return z;
    }
    nowe.forEach(uzupelnijBrakujace);

    let wstawione = 0;
    for (const z of nowe) {
      const request = pool.request();
      const colNames = [];
      const paramNames = [];
      columnsMeta.forEach((col, i) => {
        const paramName = 'p' + i;
        // z.<pole> nazwane jest z małej litery (patrz pickPhotoRecords w scrape.js).
        const klucz = col.COLUMN_NAME.charAt(0).toLowerCase() + col.COLUMN_NAME.slice(1);
        const value = coerceValue(z[klucz], col);
        request.input(paramName, mssqlType(col), value);
        colNames.push('[' + col.COLUMN_NAME + ']');
        paramNames.push('@' + paramName);
      });
      fixedColumnsMeta.forEach((col, i) => {
        const paramName = 'fx' + i;
        request.input(paramName, mssqlType(col), FIXED_ONLY_REALNE[col.COLUMN_NAME]);
        colNames.push('[' + col.COLUMN_NAME + ']');
        paramNames.push('@' + paramName);
      });
      if (!REALNE) {
        // UrlPhotoScraped jest tylko w _test (poza schematem produkcyjnym) —
        // realna csPhotos nie ma tej kolumny, patrz nagłówek pliku.
        request.input('pUrl', sql.NVarChar(500), z.urlPhoto || null);
        colNames.push('[UrlPhotoScraped]');
        paramNames.push('@pUrl');
      }
      await request.query('INSERT INTO dbo.' + TEST_TABLE + ' (' + colNames.join(', ') + ') VALUES (' + paramNames.join(', ') + ')');
      wstawione++;
    }
    console.log('[wgraj-zdjecia] SUKCES: wstawiono ' + wstawione + ' zdjęć do dbo.' + TEST_TABLE + ' w bazie "' + database + '".');
  } finally {
    await pool.close();
  }
}

main().catch(err => { console.error('[wgraj-zdjecia] BŁĄD:', err.message); process.exit(1); });
