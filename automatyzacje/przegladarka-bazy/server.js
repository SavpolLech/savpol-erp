// Lokalna przeglądarka bazy "worek" (MSSQL) — namiastka phpMyAdmin do
// samodzielnego zaglądania w dane scraperów.
//
// TYLKO ODCZYT (zasada worka: tylko dopisujemy, a dopisują wyłącznie scrapery):
//   - przeglądanie tabel idzie przez zapytania budowane tutaj z białej listy
//     tabel/kolumn z INFORMATION_SCHEMA,
//   - pole SQL przyjmuje tylko SELECT/WITH, odrzuca słowa zmieniające dane,
//     a i tak wykonuje się w transakcji, która ZAWSZE kończy się ROLLBACK.
//
// Serwer słucha wyłącznie na 127.0.0.1 — nie jest widoczny w sieci.
// Dane logowania: lokalny przegladarka-bazy/.env, potem wspólny automatyzacje/.env.
//
// Uruchomienie: node server.js   (albo przegladarka-launcher.bat)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const sql = require('mssql');

const PORT = parseInt(process.env.PRZEGLADARKA_PORT || '3399', 10);
const DATABASE = process.env.DB_NAME || 'worek';
const MAX_ROWS_SQL = 5000;
const MAX_PAGE = 1000;
const TABLES_TTL_MS = 5 * 60 * 1000;

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('Brak DB_HOST/DB_USER/DB_PASSWORD — uzupełnij automatyzacje/.env');
  process.exit(1);
}

const poolPromise = new sql.ConnectionPool({
  server: DB_HOST,
  port: parseInt(DB_PORT || '1433', 10),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DATABASE,
  options: { encrypt: true, trustServerCertificate: true },
  connectionTimeout: 15000,
  requestTimeout: 30000 // ciężkie zapytanie przerywamy, zamiast mielić serwer ERP
}).connect();

// --- Metadane (biała lista tabel i kolumn) ---

let tablesCache = null;
async function listTables(fresh) {
  if (!fresh && tablesCache && Date.now() - tablesCache.at < TABLES_TTL_MS) return tablesCache.list;
  const list = await loadTables();
  tablesCache = { at: Date.now(), list };
  return list;
}

async function loadTables() {
  const pool = await poolPromise;
  const r = await pool.request().query(`
    SELECT t.TABLE_SCHEMA AS [schema], t.TABLE_NAME AS [name], t.TABLE_TYPE AS [type]
    FROM INFORMATION_SCHEMA.TABLES t
    ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
  `);
  let counts = {};
  try {
    const c = await pool.request().query(`
      SELECT s.name AS [schema], o.name AS [name], SUM(p.rows) AS [rows]
      FROM sys.partitions p
      JOIN sys.objects o ON o.object_id = p.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE p.index_id IN (0, 1) AND o.type = 'U'
      GROUP BY s.name, o.name
    `);
    for (const row of c.recordset) counts[row.schema + '.' + row.name] = Number(row.rows);
  } catch (_) { /* brak uprawnień do sys.partitions — liczniki pominięte */ }
  return r.recordset.map(t => ({
    schema: t.schema,
    name: t.name,
    view: t.type === 'VIEW',
    rows: counts[t.schema + '.' + t.name] ?? null
  }));
}

async function listColumns(schema, name) {
  const pool = await poolPromise;
  const r = await pool.request()
    .input('s', sql.NVarChar, schema)
    .input('n', sql.NVarChar, name)
    .query(`
      SELECT COLUMN_NAME AS [name], DATA_TYPE AS [type],
             CHARACTER_MAXIMUM_LENGTH AS [len], IS_NULLABLE AS [nullable],
             COLUMN_DEFAULT AS [def]
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @n
      ORDER BY ORDINAL_POSITION
    `);
  const pk = await pool.request()
    .input('full', sql.NVarChar, q(schema) + '.' + q(name))
    .query(`
      SELECT c.name
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID(@full) AND i.is_primary_key = 1
      ORDER BY ic.key_ordinal
    `).catch(() => ({ recordset: [] }));
  const pkNames = new Set(pk.recordset.map(x => x.name));
  return r.recordset.map(c => ({ ...c, pk: pkNames.has(c.name) }));
}

const q = id => '[' + String(id).replace(/]/g, ']]') + ']';

async function resolveTable(full) {
  const tables = await listTables();
  const t = tables.find(x => x.schema + '.' + x.name === full);
  if (!t) throw new Error('Nieznana tabela: ' + full);
  return t;
}

// --- Wiersze tabeli: stronicowanie, sortowanie, filtr per kolumna ---

async function tableRows(params) {
  const t = await resolveTable(params.get('t') || '');
  const cols = await listColumns(t.schema, t.name);
  const colTypes = new Map(cols.map(c => [c.name, c.type]));
  const size = Math.min(Math.max(parseInt(params.get('size') || '100', 10) || 100, 1), MAX_PAGE);
  const page = Math.max(parseInt(params.get('page') || '1', 10) || 1, 1);
  const sort = params.get('sort');
  const dir = params.get('dir') === 'desc' ? 'DESC' : 'ASC';

  let filters = {};
  try { filters = JSON.parse(params.get('f') || '{}'); } catch (_) {}

  const pool = await poolPromise;
  const build = () => {
    const req = pool.request();
    const where = [];
    let i = 0;
    for (const [col, raw] of Object.entries(filters)) {
      const val = String(raw ?? '').trim();
      if (!colTypes.has(col) || val === '') continue;
      const w = filterSql(q(col), colTypes.get(col), val, 'f' + i++, req);
      if (w) where.push(w);
    }
    return { req, where: where.length ? ' WHERE ' + where.join(' AND ') : '' };
  };

  const from = q(t.schema) + '.' + q(t.name);
  // Domyślnie od najnowszych, malejąco po identyfikatorze wiersza. W ERP to kolumna
  // <Tabela>Id (csDocsItemsPositions → csDocsItemsPositionsId; klucz klastrowy bywa
  // złożony i zaczyna się od csCompaniesId). Potem jednokolumnowy PK, potem pierwsza.
  const idName = t.name.replace(/_(test|changes)$/i, '').toLowerCase() + 'id';
  const pkCols = cols.filter(c => c.pk);
  const defCol = cols.find(c => c.name.toLowerCase() === idName) || (pkCols.length === 1 && pkCols[0]) || cols[0];
  const sortCol = sort && colTypes.has(sort) ? sort : defCol.name;
  const sortDir = sort && colTypes.has(sort) ? dir : 'DESC';
  const order = q(sortCol) + ' ' + sortDir;

  // Bez filtra liczba wierszy z sys.partitions (bez skanu). Z filtrem NIE liczymy
  // — COUNT po filtrze na tabeli z milionami wierszy to pełny skan produkcyjnego
  // ERP. Pobieramy size+1 wierszy i wiemy tylko, czy jest następna strona.
  const b = build();
  b.req.input('off', sql.Int, (page - 1) * size).input('size', sql.Int, size + 1);
  let rows;
  try {
    rows = (await b.req.query(
      'SELECT * FROM ' + from + b.where + ' ORDER BY ' + order +
      ' OFFSET @off ROWS FETCH NEXT @size ROWS ONLY'
    )).recordset;
  } catch (e) {
    if (e.code === 'ETIMEOUT') throw new Error('Zapytanie przerwane po 30 s — za ciężkie dla bazy. Zawęź filtr (np. dokładna wartość albo zakres dat) albo sortuj po kolumnie z indeksem (Id).');
    throw e;
  }
  const hasMore = rows.length > size;
  if (hasMore) rows.pop();
  const total = b.where ? null : t.rows;

  return { table: t, columns: cols, total, hasMore, page, size, sort: sortCol, dir: sortDir.toLowerCase(), rows: rows.map(clean) };
}

// Składnia filtra (świadomie tak, żeby SQL Server mógł użyć indeksu):
//   WZ        tekst: zaczyna się od „WZ”; liczba/data/guid: równe
//   *abc*     gwiazdka = dowolny ciąg („zawiera” — wolne na dużych tabelach)
//   =WZ/1     dokładnie
//   >=2026-09-01   <10   >   <=   !=   porównania (daty, liczby)
//   NULL  !NULL
const TEXT_TYPES = new Set(['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext']);
function filterSql(col, type, val, p, req) {
  if (val.toUpperCase() === 'NULL') return col + ' IS NULL';
  if (val.toUpperCase() === '!NULL') return col + ' IS NOT NULL';
  const isText = TEXT_TYPES.has(type);
  const op = val.match(/^(>=|<=|!=|<>|>|<|=)\s*(.*)$/);
  if (op) {
    req.input(p, sql.NVarChar, op[2]);
    return col + ' ' + (op[1] === '!=' ? '<>' : op[1]) + ' @' + p;
  }
  if (val.includes('*')) {
    req.input(p, sql.NVarChar, val.replace(/[\[%_]/g, '[$&]').replace(/\*/g, '%'));
    return (isText ? col : 'CAST(' + col + ' AS NVARCHAR(4000))') + ' LIKE @' + p;
  }
  if (isText) {
    req.input(p, sql.NVarChar, val.replace(/[\[%_]/g, '[$&]') + '%');
    return col + ' LIKE @' + p;
  }
  req.input(p, sql.NVarChar, val);
  return col + ' = @' + p;
}

// --- Dowolny SELECT z pola SQL ---

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|SHUTDOWN|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|KILL|RECONFIGURE|USE|WAITFOR|SP_\w+|XP_\w+)\b/i;

function checkReadOnly(text) {
  const stripped = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, "''")
    .replace(/\[(?:[^\]]|\]\])*\]/g, '[x]')
    .trim();
  if (!/^(SELECT|WITH)\b/i.test(stripped)) throw new Error('Dozwolone tylko zapytania SELECT (lub WITH ... SELECT).');
  const m = stripped.match(FORBIDDEN);
  if (m) throw new Error('Zapytanie zawiera niedozwolone słowo: ' + m[1].toUpperCase() + ' — przeglądarka jest tylko do odczytu.');
}

async function runSql(text) {
  checkReadOnly(text);
  const pool = await poolPromise;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const started = Date.now();
  try {
    const r = await new sql.Request(tx).query(text);
    const sets = (r.recordsets || []).map(rs => ({
      columns: rs.columns ? Object.keys(rs.columns) : (rs[0] ? Object.keys(rs[0]) : []),
      total: rs.length,
      rows: rs.slice(0, MAX_ROWS_SQL).map(clean)
    }));
    return { sets, ms: Date.now() - started, limit: MAX_ROWS_SQL };
  } finally {
    await tx.rollback().catch(() => {});
  }
}

function clean(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) out[k] = '0x' + v.subarray(0, 32).toString('hex') + (v.length > 32 ? '… (' + v.length + ' B)' : '');
    else if (v instanceof Date) out[k] = v.toISOString().replace('T', ' ').replace('Z', '').replace(/\.000$/, '');
    else if (typeof v === 'bigint') out[k] = v.toString();
    else out[k] = v;
  }
  return out;
}

// --- HTTP ---

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/info') {
      return send(res, 200, { database: DATABASE, host: DB_HOST });
    }
    if (url.pathname === '/api/tabele') {
      return send(res, 200, await listTables(url.searchParams.has('odswiez')));
    }
    if (url.pathname === '/api/wiersze') {
      return send(res, 200, await tableRows(url.searchParams));
    }
    if (url.pathname === '/api/sql' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { q: text } = JSON.parse(body || '{}');
      return send(res, 200, await runSql(String(text || '')));
    }
    send(res, 404, { error: 'Nie ma takiej ścieżki' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const link = 'http://localhost:' + PORT;
  console.log('Przeglądarka bazy "' + DATABASE + '" (tylko odczyt): ' + link);
  console.log('Zamknij to okno, żeby wyłączyć.');
  if (process.platform === 'win32' && !process.env.NO_BROWSER) exec('start "" ' + link);
});

poolPromise.catch(e => console.error('[db] Nie udało się połączyć: ' + e.message));
