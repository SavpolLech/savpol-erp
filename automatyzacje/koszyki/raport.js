// B-08: koszyki sklepu tygodniowo z wyniku zbierz.js → tabela Markdown na stdout (+ wynik/raport_<od>_<do>.md).
// Kandydat do raportu poniedziałkowego Z-04.
//
// Uruchomienie: node koszyki/raport.js [plik.json]  (domyślnie najnowszy wynik/zoid_*.json)
//
// Definicje (zgodne z docs/B-06_diagnoza_spadku.md w repo esavpol):
// - porzucony = status „W koszyku”, wartość netto > 0 i < 20 tys. zł (wyżej to śmieci z ilościami rzędu miliardów),
// - zamówienie = „Zamknięte”, anulowane = „Anulowany” (złożone, niezapłacone/wycofane),
// - konwersja = zamknięte / (porzucone + zamknięte + anulowane),
// - gość = klient 8714093787,
// - „doszli do danych” = porzucony koszyk z wpisanym e-mailem lub telefonem (pola kasy zapisują się do koszyka
//   przy każdej zmianie). Pole CheckoutStage w ERP jest puste — to jedyny sygnał etapu,
// - tydzień = od poniedziałku, wg daty dokumentu.

const path = require('path');
const fs = require('fs');

const DIR = path.join(__dirname, 'wynik');
const GOSC = '8714093787';
const plik = process.argv[2] || fs.readdirSync(DIR).filter(f => /^zoid_.*\.json$/.test(f)).sort().map(f => path.join(DIR, f)).pop();
if (!plik) { console.error('Brak wyniku — najpierw node koszyki/zbierz.js'); process.exit(1); }
const dane = JSON.parse(fs.readFileSync(plik, 'utf8'));

const poniedzialek = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - (t.getUTCDay() + 6) % 7); return t.toISOString().slice(0, 10); };
const mediana = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const zl = n => Math.round(n).toLocaleString('pl-PL');
const proc = (a, b) => b ? Math.round(a / b * 1000) / 10 + '%' : '–';

const tyg = {};
for (const r of dane.wiersze) {
  if (!(r.netto > 0 && r.netto < 20000)) continue;
  const k = poniedzialek(r.data);
  const t = tyg[k] || (tyg[k] = { porz: [], zamk: 0, zamkNetto: 0, anul: 0, goscPorz: 0, kontakt: 0, ponad30: 0, ponad150: 0, kurierPorz: 0 });
  if (r.status === 'W koszyku') {
    t.porz.push(r.netto);
    if (r.klient === GOSC) t.goscPorz++;
    if (r.email || r.telefon) t.kontakt++;
    if (r.kg > 30) t.ponad30++;
    if (r.kg > 150) t.ponad150++;
    if (/kurier/i.test(r.dostawa || '')) t.kurierPorz++;
  } else if (r.status === 'Zamknięte') { t.zamk++; t.zamkNetto += r.netto; }
  else if (/Anulow/.test(r.status)) t.anul++;
}

const naglowek = '| tydzień od | koszyki | zamówione | anulowane | konwersja | porzucone: wartość netto | mediana | goście | doszli do danych | >30 kg | >150 kg |';
const linie = [naglowek, '|' + naglowek.split('|').slice(1, -1).map(() => '---').join('|') + '|'];
for (const k of Object.keys(tyg).sort()) {
  const t = tyg[k], n = t.porz.length, wszystkie = n + t.zamk + t.anul;
  linie.push('| ' + [k, wszystkie, t.zamk + ' (' + zl(t.zamkNetto) + ' zł)', t.anul, proc(t.zamk, wszystkie),
    zl(t.porz.reduce((a, b) => a + b, 0)) + ' zł', zl(mediana(t.porz)) + ' zł', proc(t.goscPorz, n), proc(t.kontakt, n),
    t.ponad30, t.ponad150].join(' | ') + ' |');
}
const tekst = '# Koszyki esavpol tygodniowo (ZOID, ' + dane.od + ' – ' + dane.do + ', odczyt ' + dane.pobrano.slice(0, 16).replace('T', ' ') + ')\n\n' +
  linie.join('\n') + '\n\nKoszyki = porzucone + zamówione + anulowane (niepuste, < 20 tys. zł). Ostatni tydzień może być niepełny.\n';
const out = path.join(DIR, 'raport_' + dane.od + '_' + dane.do + '.md');
fs.writeFileSync(out, tekst);
console.log(tekst);
