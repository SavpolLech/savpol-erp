// Kontrola kompletności: czy w worku jest DOKŁADNIE tyle kontrahentów, ile
// jest w ERP. Uruchamiać po lista-nowych.js → scrape.js → wgraj-do-worek.js.
// Nie wchodzi na ERP — porównuje to, co lista-nowych.js zmierzyło w ERP
// (liczniki z pagera), z tym, co faktycznie leży w wynik/ i w bazie.
//
// Sprawdzenia (każde FAIL = kod wyjścia 2):
//  1. lista z ERP pełna: każde wyszukiwanie zebrało tyle wierszy, ile podał
//     licznik ERP; luki w numeracji sprawdzone pełnym symbolem,
//  2. każdy kontrahent z listy ma kartę w wynik/ z tym samym id i symbolem,
//  3. każdy kontrahent z listy jest w tabeli docelowej (zapytanie do bazy,
//     nie licznik ze skryptu wgrywającego),
//  4. każdy kontrahent z dokumentów WZ/MM/PZ w worku jest w tabeli docelowej,
//  5. bilans: kontrahenci firmy w tabeli docelowej (+ worek przed ładowaniem,
//     gdy celem jest _test) = licznik "Wszyscy" w ERP. Różnica oznacza
//     kontrahentów, których nie da się znaleźć po symbolu (np. bez symbolu)
//     albo usuniętych w ERP — wypisujemy ją, nie zgadujemy.
//
// Wynik: wpis w run-log.jsonl + state/kontrola-ostatnia.json (same liczby
// i id, bez nazw), commit + push przez lib-wspolne/git-log-push.js.
//
// Uruchomienie: node kontrola.js [--realne] [--bez-push]
// Bez --realne sprawdza csCustomers_test (tryb próbki).

const path = require('path');
const fs = require('fs');
const W = require('./lib/wspolne');
const { pushLogs } = require(path.join(__dirname, '..', 'lib-wspolne', 'git-log-push'));

const REALNE = process.argv.includes('--realne');
const TABELA = REALNE ? W.PROD_TABLE : W.PROD_TABLE + '_test';
const RUN_LOG = path.join(__dirname, 'run-log.jsonl');
const STATE = path.join(__dirname, 'state', 'kontrola-ostatnia.json');

async function obecneWTabeli(pool, tabela, ids) {
  const jest = new Set();
  for (let i = 0; i < ids.length; i += 1000) {
    const paczka = ids.slice(i, i + 1000).filter(x => /^\d+$/.test(x));
    if (!paczka.length) continue;
    const rs = await pool.request().query('SELECT CAST(csCustomersId AS varchar(30)) AS id FROM dbo.' + tabela +
      ' WHERE csCustomersId IN (' + paczka.join(',') + ')');
    rs.recordset.forEach(r => jest.add(r.id));
  }
  return jest;
}

async function main() {
  const plikListy = path.join(W.OUT_DIR, 'lista-nowych.json');
  if (!fs.existsSync(plikListy)) throw new Error('Brak wynik/lista-nowych.json — uruchom najpierw lista-nowych.js');
  const L = JSON.parse(fs.readFileSync(plikListy, 'utf8'));
  const lista = L.kontrahenci;
  const ids = lista.map(k => k.csCustomersId);
  const wyniki = [];
  const sprawdz = (nazwa, ok, szczegoly) => {
    wyniki.push({ nazwa, ok, szczegoly });
    console.log((ok ? '  OK   ' : '  FAIL ') + nazwa + (szczegoly ? ' — ' + szczegoly : ''));
  };
  console.log('[kontrola] Lista z ' + L.pobrano + ', próg ' + L.prog + ', ' + lista.length + ' kontrahentów, tabela dbo.' + TABELA);

  // 1. Lista
  const k = L.kontrola || {};
  sprawdz('1. lista z ERP pełna (wszystkie strony wyszukiwań)', !!k.ok,
    k.ok ? k.wyszukiwan + ' wyszukiwań, licznik ERP = zebrane' : 'niepełne: ' + (k.niepelne || []).join(', '));
  const luki = k.luki || [];
  sprawdz('1b. luki w numeracji sprawdzone pełnym symbolem', luki.every(l => l.pelne !== false),
    luki.length + ' luk, brak w ERP: ' + luki.filter(l => !l.znaleziony).map(l => l.symbol).join(', ') +
    (luki.some(l => l.znaleziony) ? '; dopisane: ' + luki.filter(l => l.znaleziony).map(l => l.symbol).join(', ') : ''));

  // 2. Karty
  const bezKarty = [], zlaKarta = [];
  for (const kk of lista) {
    const f = path.join(W.OUT_DIR, 'kontrahent_' + kk.csCustomersId + '.json');
    if (!fs.existsSync(f)) { bezKarty.push(kk.csCustomersId); continue; }
    const r = JSON.parse(fs.readFileSync(f, 'utf8')).rekord;
    if (String(r.csCustomersId) !== kk.csCustomersId || String(r.CustomerIdent || '') !== kk.CustomerIdent) zlaKarta.push(kk.csCustomersId);
  }
  sprawdz('2. każdy z listy ma kartę (to samo id i symbol)', !bezKarty.length && !zlaKarta.length,
    (lista.length - bezKarty.length - zlaKarta.length) + '/' + lista.length +
    (bezKarty.length ? '; bez karty: ' + bezKarty.slice(0, 20).join(', ') : '') +
    (zlaKarta.length ? '; niezgodna karta: ' + zlaKarta.slice(0, 20).join(', ') : ''));

  const pool = await W.polacz();
  let stan;
  try {
    // 3. Baza: lista
    const wTabeli = await obecneWTabeli(pool, TABELA, ids);
    const brakWTabeli = ids.filter(i => !wTabeli.has(i));
    sprawdz('3. każdy z listy jest w dbo.' + TABELA, !brakWTabeli.length,
      wTabeli.size + '/' + ids.length + (brakWTabeli.length ? '; brak: ' + brakWTabeli.slice(0, 20).join(', ') : ''));

    // 4. Baza: kontrahenci z dokumentów
    const docIds = (await pool.request().query(`
      SELECT DISTINCT CAST(h.csCustomersId AS varchar(30)) AS id FROM dbo.csDocsHeaders h
      LEFT JOIN dbo.csCustomers c ON c.csCustomersId = h.csCustomersId
      WHERE h.csCustomersId IS NOT NULL AND c.csCustomersId IS NULL`)).recordset.map(r => r.id);
    // Po --realne lista powinna być pusta; w trybie próbki — wszyscy w _test.
    const docWCelu = REALNE ? new Set() : await obecneWTabeli(pool, TABELA, docIds);
    const docNieobslugiwane = docIds.filter(i => !docWCelu.has(i));
    sprawdz('4. kontrahenci z dokumentów WZ/MM/PZ obecni', !docNieobslugiwane.length,
      (REALNE ? 'brak w csCustomers: ' + docNieobslugiwane.length
        : (docIds.length - docNieobslugiwane.length) + '/' + docIds.length + ' w ' + TABELA) +
      (docNieobslugiwane.length ? '; brak: ' + docNieobslugiwane.slice(0, 20).join(', ') : ''));

    // 5. Bilans z licznikiem ERP
    const firma = Number(W.COMPANY_ID);
    const nProd = (await pool.request().query('SELECT COUNT(*) AS n FROM dbo.csCustomers WHERE csCompaniesId = ' + firma)).recordset[0].n;
    const nTest = REALNE ? 0 : (await pool.request().query(
      'SELECT COUNT(*) AS n FROM dbo.' + TABELA + ' t WHERE csCompaniesId = ' + firma +
      ' AND NOT EXISTS (SELECT 1 FROM dbo.csCustomers c WHERE c.csCustomersId = t.csCustomersId)')).recordset[0].n;
    const wWorku = nProd + nTest;
    const roznica = k.erpWszyscy === null || k.erpWszyscy === undefined ? null : k.erpWszyscy - wWorku;
    sprawdz('5. bilans: worek = licznik ERP "Wszyscy"', roznica === 0,
      'ERP ' + k.erpWszyscy + ', worek ' + wWorku + (REALNE ? '' : ' (' + nProd + ' produkcja + ' + nTest + ' nowych w _test)') +
      (roznica ? '; różnica ' + (roznica > 0 ? '+' : '') + roznica + ' — ' + (roznica > 0
        ? 'w ERP są kontrahenci nieznalezieni po symbolu (np. bez symbolu)'
        : 'w worku są kontrahenci, których ERP już nie liczy (usunięci?)') : ''));

    stan = {
      ts: new Date().toISOString(), tabela: TABELA, prog: L.prog, listaZ: L.pobrano,
      lista: lista.length, erpWszyscy: k.erpWszyscy, wWorku, roznicaBilansu: roznica,
      lukiBrakWErp: luki.filter(l => !l.znaleziony).map(l => l.symbol),
      bezKarty, brakWTabeli, docNieobslugiwane,
      ok: wyniki.every(w => w.ok),
      sprawdzenia: wyniki.map(w => ({ nazwa: w.nazwa, ok: w.ok }))
    };
  } finally {
    await pool.close();
  }

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(stan, null, 1) + '\n', 'utf8');
  fs.appendFileSync(RUN_LOG, JSON.stringify(Object.assign({ typ: 'kontrola' }, stan)) + '\n', 'utf8');
  console.log('[kontrola] ' + (stan.ok ? 'WSZYSTKO SIĘ ZGADZA' : 'NIEZGODNOŚCI: ' + wyniki.filter(w => !w.ok).map(w => w.nazwa.split('.')[0]).join(', ')));
  if (!process.argv.includes('--bez-push')) pushLogs('kontrahenci', 'kontrola ' + TABELA);
  if (!stan.ok) process.exitCode = 2;
}

main().catch(err => { console.error('[kontrola] BŁĄD:', err.message); process.exit(1); });
