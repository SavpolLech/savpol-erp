// Wspólne dla skryptów kontrahentów: zależności, .env, połączenie z bazą,
// konwersja wartości z API karty na typ kolumny.

const path = require('path');
const fs = require('fs');

// Zależności z lokalnego node_modules, a jak go nie ma — z ../wz (jak produkty/:
// bez drugiej instalacji Playwrighta i przeglądarki na tej samej maszynie).
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', '..', 'wz', 'node_modules', name)); }
}

const dotenv = req('dotenv');
const localEnv = path.join(__dirname, '..', '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '..', '.env') });

const sql = req('mssql');
const schema = require(path.join(__dirname, '..', '..', 'wz', 'lib', 'schema'));

const OUT_DIR = path.join(__dirname, '..', 'wynik');
const PROD_TABLE = 'csCustomers';
const COMPANY_ID = '213217693';

async function polacz() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_USER || !DB_PASSWORD) throw new Error('Brak DB_HOST/DB_USER/DB_PASSWORD w automatyzacje/.env');
  return sql.connect({
    server: DB_HOST, port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER, password: DB_PASSWORD, database: process.env.DB_NAME || 'worek',
    options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 15000
  });
}

// Wartość z karty (już odpakowana z {"Item": ...}) → wartość pod typ kolumny.
// Różnice względem wz/lib/schema.coerceValue:
//  - datetime zachowuje GODZINĘ (LastChangeDate, DeactivateDate, lastActivity
//    to znaczniki czasu, nie daty dokumentu). ERP podaje "RRRR-MM-DD GG:MM:SS"
//    bez strefy; traktujemy to jak UTC, bo tak mssql (useUTC) zapisuje i czyta
//    — wartość w bazie wychodzi 1:1 jak w ERP.
//  - varbinary (Logo) przychodzi jako base64 → Buffer.
//  - pusty tekst API oddaje jako null; w kolumnie tekstowej NOT NULL
//    (CustomerIdent) produkcja trzyma wtedy '' — i tak zapisujemy, inaczej
//    INSERT do prawdziwej csCustomers by padł. col.IS_NULLABLE bierzemy ze
//    schematu PRODUKCJI (tabela _test ma wszystko NULL).
function wartosc(raw, col) {
  if (raw === undefined || raw === null) {
    return col.IS_NULLABLE === 'NO' && /char$/.test(col.DATA_TYPE) ? '' : null;
  }
  const t = col.DATA_TYPE;
  if (t === 'varbinary' || t === 'binary' || t === 'image') {
    if (typeof raw !== 'string' || raw === '') return null;
    return Buffer.from(raw, 'base64');
  }
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') {
    const s = String(raw).trim();
    if (!s) return null;
    const d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
    return isNaN(d.getTime()) ? null : d;
  }
  if (t === 'nvarchar' || t === 'varchar' || t === 'nchar' || t === 'char') {
    // Bez trim(): w bazie bywają spacje na końcu i mają zostać 1:1.
    return raw === '' ? '' : String(raw);
  }
  return schema.coerceValue(raw, col);
}

function mssqlType(col) {
  if (col.DATA_TYPE === 'varbinary') return sql.VarBinary(col.CHARACTER_MAXIMUM_LENGTH === -1 ? sql.MAX : col.CHARACTER_MAXIMUM_LENGTH);
  return schema.mssqlType(col);
}

module.exports = { req, sql, schema, polacz, wartosc, mssqlType, OUT_DIR, PROD_TABLE, COMPANY_ID };
