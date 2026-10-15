// TRIAGE rozbieżności ERP↔worek — tygodniowy przegląd dla człowieka.
//
// Scrapery dopisują każdą rozbieżność do automatyzacje/ROZBIEZNOSCI.md
// (lib-wspolne/powiadom.js). Większość to NORMA: dokument wszedł do worka,
// a ERP go potem sfinalizował/zaksięgował w znanym oknie modyfikacji
// (bufory w dobij-wszystko.js: MM ~3 dni, sprzedaż 14 dni, zakup 2 dni +
// przegląd 8 tyg.). Ten skrypt odsiewa te SPODZIEWANE i zostawia tylko
// NIESPODZIEWANE w automatyzacje/DO-SPRAWDZENIA.md.
//
// Bez ERP, bez locka, bez bazy — czyta wyłącznie plik w repo, więc nie
// koliduje z orkiestratorem. Nic nie zmienia w ROZBIEZNOSCI.md.
//
// Użycie:
//   node triage-rozbieznosci.js          — zapisz DO-SPRAWDZENIA.md + commit/push
//   node triage-rozbieznosci.js --dry    — tylko wypisz na ekran
//
// Reguły „spodziewane" poniżej (REGULY). Zmiana reguły = zmiana tutaj.

const fs = require('fs');
const path = require('path');
const { pushFile } = require('./lib-wspolne/git-log-push');

const REPO_ROOT = path.resolve(__dirname, '..');
const ZRODLO = path.join(__dirname, 'ROZBIEZNOSCI.md');
const WYJSCIE_REL = 'automatyzacje/DO-SPRAWDZENIA.md';
const WYJSCIE = path.join(REPO_ROOT, WYJSCIE_REL);

const STATUS_ZAKSIEGOWANE = '213217724';

// --- REGUŁY: co jest normalną finalizacją dokumentu ---
// Wspólne dla dokumentów (WZ/MM/PZ/ZAKUP/SPRZEDAZ): przy księgowaniu ERP
// ustawia status, daty, kwoty, ceny, stany i pracownika.
const POLA_NAGLOWKA = new Set([
  'DocDate', 'DocSaleDate', 'DocVATDate', 'csVATPeriodsId',
  'csEmployeesId', 'DocNumberExt', 'FStock', 'QStock'
]);
const POLA_POZYCJI = new Set(['FStock', 'QStock', 'createdDate']);
const KWOTA = /^d?[CF][GNT]Amount$/;               // CGAmount, dFNAmount…
const CENA = /^[CF](Unit)?(Net|Gross)?Price$/;     // CUnitPrice, FGrossPrice…

// Typy, które nie są dokumentami (słowniki z własnym trybem UPDATE od
// 10-06/10-12) — ich rozbieżności obsługuje tygodniowy UPDATE, nie triage.
const POMIN_TYPY = new Set(['PRODUKTY', 'KONTRAHENCI']);

const pusta = v => v === undefined || v === null || v === '' || v === 'NULL';

function klasyfikuj(w) {
  if (w.rodzaj === 'pozycja-nowa') return [true, 'nowa pozycja przed zaksięgowaniem'];
  if (w.rodzaj === 'pozycja-brak') return [false, 'pozycja zniknęła z ERP'];
  if (w.rodzaj === 'bez-szczegolow') return [false, 'brak szczegółów'];
  if (w.rodzaj === 'liczba-pozycji') {
    return Number(w.erp) >= Number(w.baza)
      ? [true, 'pozycji przybyło'] : [false, 'pozycji ubyło'];
  }
  // NULL vs 0/puste to nie zmiana (ta sama zasada co w scraperach).
  if ((pusta(w.baza) && (pusta(w.erp) || w.erp === '0')) ||
      (pusta(w.erp) && w.baza === '0')) return [true, 'NULL vs 0'];
  if (w.pole === 'csDocsHeadersStatusId') {
    return w.erp === STATUS_ZAKSIEGOWANE
      ? [true, 'zaksięgowanie'] : [false, 'status inny niż zaksięgowanie'];
  }
  if (KWOTA.test(w.pole)) return [true, 'kwota przeliczona przy finalizacji'];
  if (w.rodzaj === 'pozycja-pole') {
    if (CENA.test(w.pole) || POLA_POZYCJI.has(w.pole)) return [true, 'finalizacja pozycji'];
    return [false, 'pole pozycji spoza wzorca finalizacji'];
  }
  if (POLA_NAGLOWKA.has(w.pole)) return [true, 'finalizacja nagłówka'];
  return [false, 'pole nagłówka spoza wzorca finalizacji'];
}

// --- Parser ROZBIEZNOSCI.md ---
const RE_SEKCJA = /^## (\S+) · (\S+)(?: · (.+?))? · (\d+) dok\.$/;
const RE_WPIS = /^- \[([ xX])\] (.+?) \(id=([^)]+)\): (.*)$/;
const RE_WPIS_BEZ_ID = /^- \[([ xX])\] (.+?): (.*)$/;
const ZMIANA = /^(.+?) -> (.+?)(?: — .+)?$/;

function parsujReszte(r) {
  let m;
  if ((m = r.match(/^pozycja (\S+) — nowa w ERP/))) return { rodzaj: 'pozycja-nowa', pozycja: m[1] };
  if ((m = r.match(/^pozycja (\S+) — brak w ERP/))) return { rodzaj: 'pozycja-brak', pozycja: m[1] };
  if ((m = r.match(/^pozycja (\S+) — (\S+?): (.*)$/))) {
    const z = m[3].match(ZMIANA);
    return { rodzaj: 'pozycja-pole', pozycja: m[1], pole: m[2], baza: z && z[1], erp: z && z[2] };
  }
  if ((m = r.match(/^liczba pozycji: (.*)$/))) {
    const z = m[1].match(ZMIANA);
    return { rodzaj: 'liczba-pozycji', baza: z && z[1], erp: z && z[2] };
  }
  if (/rozbieżność bez szczegółów/.test(r)) return { rodzaj: 'bez-szczegolow' };
  if ((m = r.match(/^([^:]+?): (.*)$/))) {
    const z = m[2].match(ZMIANA);
    return { rodzaj: 'naglowek', pole: m[1], baza: z && z[1], erp: z && z[2] };
  }
  return { rodzaj: 'bez-szczegolow' };
}

function parsuj(tekst) {
  const wpisy = [];
  let sekcja = null;
  for (const linia of tekst.split(/\r?\n/)) {
    const s = linia.match(RE_SEKCJA);
    if (s) { sekcja = { kiedy: s[1], typ: s[2].toUpperCase(), label: s[3] || '' }; continue; }
    if (!sekcja) continue;
    let m = linia.match(RE_WPIS), dok, id, reszta, znak;
    if (m) [, znak, dok, id, reszta] = m;
    else if ((m = linia.match(RE_WPIS_BEZ_ID))) { [, znak, dok, reszta] = m; id = ''; }
    else continue;
    wpisy.push({ ...sekcja, odhaczone: znak !== ' ', dok, id, linia: reszta, ...parsujReszte(reszta) });
  }
  return wpisy;
}

// --- Raport ---
function raport(wpisy) {
  const otwarte = wpisy.filter(w => !w.odhaczone && !POMIN_TYPY.has(w.typ));
  const anomalie = [];
  let spodziewane = 0;
  for (const w of otwarte) {
    const [ok, powod] = klasyfikuj(w);
    if (ok) spodziewane++; else anomalie.push({ ...w, powod });
  }
  const pominiete = wpisy.filter(w => !w.odhaczone && POMIN_TYPY.has(w.typ)).length;
  const odhaczone = wpisy.filter(w => w.odhaczone).length;

  const out = [
    '# Rozbieżności ERP↔worek — DO SPRAWDZENIA', '',
    'Generuje `node automatyzacje/triage-rozbieznosci.js` z `ROZBIEZNOSCI.md`. ' +
    'Pokazuje tylko rozbieżności NIESPODZIEWANE — niepasujące do finalizacji ' +
    'dokumentu w ERP (zaksięgowanie, daty/kwoty/ceny/stany). Spodziewane są tylko liczone.', '',
    'Wygenerowano: ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', '',
    '## Podsumowanie', '',
    '- Do sprawdzenia: **' + anomalie.length + '**',
    '- Spodziewane (finalizacja, pominięte): ' + spodziewane,
    '- Słowniki PRODUKTY/KONTRAHENCI (tygodniowy UPDATE, pominięte): ' + pominiete,
    '- Już odhaczone w ROZBIEZNOSCI.md: ' + odhaczone, '',
    '## Do sprawdzenia', ''
  ];
  if (!anomalie.length) out.push('Brak — wszystkie otwarte rozbieżności pasują do wzorca finalizacji.');
  let klucz = null;
  for (const a of anomalie) {
    const k = a.typ + '|' + a.dok;
    if (k !== klucz) {
      klucz = k;
      out.push('', '### ' + a.typ + ' · ' + a.dok + (a.id ? ' (id=' + a.id + ')' : '') +
        ' — zgłoszone ' + a.kiedy.slice(0, 10));
    }
    out.push('- ' + a.linia + ' — *' + a.powod + '*');
  }
  return { tekst: out.join('\n') + '\n', anomalie: anomalie.length, spodziewane };
}

if (require.main === module) {
  const r = raport(parsuj(fs.readFileSync(ZRODLO, 'utf8')));
  if (process.argv.includes('--dry')) {
    process.stdout.write(r.tekst);
  } else {
    fs.writeFileSync(WYJSCIE, r.tekst, 'utf8');
    pushFile(WYJSCIE_REL, 'Triage rozbieżności: ' + r.anomalie + ' do sprawdzenia, ' +
      r.spodziewane + ' spodziewanych');
  }
  console.log('[triage] do sprawdzenia ' + r.anomalie + ', spodziewanych ' + r.spodziewane);
}

module.exports = { parsuj, klasyfikuj, raport };
