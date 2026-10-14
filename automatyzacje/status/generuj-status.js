// Generuje samodzielną stronę HTML ze STANEM scraperów (dobicie danych + log
// aktywności pogrupowany po dniach) do automatyzacje/status/index.html.
//
// Uruchamiany automatycznie po każdym biegu (launcher/uruchom.bat) oraz ręcznie:
//   node status/generuj-status.js
//
// Strona jest samodzielna (żadnych plików zewnętrznych) — ten sam HTML można
// opublikować jako artefakt Claude albo serwować z własnego serwera.
// Ścieżki względne (repo de facto publiczne — bez C:\Users\...).

const fs = require('fs');
const path = require('path');

const AUTO = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'index.html');
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (b, n) => { const d = new Date(b); d.setUTCDate(d.getUTCDate() + n); return d; };
const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const short = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7);
// Lista dni → zwarte zakresy: ['2026-08-01','2026-08-02','2026-08-03','2026-08-07'] → '01.08–03.08, 07.08'.
const zakresy = dni => {
  const out = [];
  for (let i = 0; i < dni.length; i++) {
    let j = i;
    while (j + 1 < dni.length && ymd(addDays(new Date(dni[j] + 'T00:00:00Z'), 1)) === dni[j + 1]) j++;
    out.push(j > i ? short(dni[i]) + '–' + short(dni[j]) : short(dni[i]));
    i = j;
  }
  return out.join(', ');
};
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('pl-PL'));

// --- dni per typ dokumentowy ---
const scope = {
  wz: ['2026-07-25', ymd(addDays(today, -1))],
  mm: ['2026-07-24', ymd(addDays(today, -3))],
  pz: ['2026-07-25', ymd(addDays(today, -1))],
  sprzedaz: ['2026-07-01', ymd(addDays(today, -14))],
  // Zakup (FZ + FZ_KSEF): dzień = Wpływ (DocReceiptDate), pobierany 2 dni po wpływie
  // (dobij-wszystko.js: ZAKUP_MIN_AGE_DAYS=2); zakres od początku kolejki zaległości.
  zakup: ['2026-07-28', ymd(addDays(today, -2))]
};
const etykieta = { wz: 'WZ', mm: 'MM', pz: 'PZ', sprzedaz: 'Sprzedaż', zakup: 'Zakup' };
// Zakup: run-log ma oczekujace jako listę id (stan dnia: liczba) — faktury jeszcze
// niezaksięgowane. Nie są błędem: dzień i tak jest kompletny, przegląd 8 tyg. je dobierze.
const ileCzeka = v => Array.isArray(v) ? v.length : (v || 0);
const bars = [];

// --- szacunek nadrabiania ---
// Wpisy run-log sprowadzone do jednego kształtu: dzień, ile dok. w ERP (total),
// ile już w bazie (have), ile pobrano w tym biegu (got) i ile to trwało (sec).
function wpisyLogu(t) {
  const p = path.join(AUTO, t, 'run-log.jsonl');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const ln of fs.readFileSync(p, 'utf8').trim().split(String.fromCharCode(10))) {
    try {
      const o = JSON.parse(ln);
      if (t === 'zakup') { const cz = ileCzeka(o.oczekujace); out.push({ ts: o.ts, dzien: o.dzien, fz: (o.fz || 0) + (o.fzKsef || 0), czeka: cz, total: (o.fz || 0) + (o.fzKsef || 0) - cz, have: (o.juzWBazie || 0) + (o.wstawiono || 0), got: o.wstawiono || 0, sec: o.sekundy || 0, done: o.complete === true }); }
      else if (t === 'sprzedaz') out.push({ ts: o.ts, dzien: o.dzien, fa: o.fa, par: o.par || 0, total: o.fa + (o.par || 0), have: (o.juzWBazie || 0) + (o.wstawiono || 0), got: o.wstawiono || 0, sec: o.sekundy || 0, done: o.complete === true });
      // Wpisy zakresowe (wczesne backfille, filterDateTo ≠ filterDateFrom) liczą wiele dni naraz —
      // liczą się do tempa, ale nie przypisujemy ich licznika ERP żadnemu dniowi.
      else out.push({ ts: o.ts, dzien: (!o.filterDateTo || o.filterDateTo === o.filterDateFrom) ? o.filterDateFrom : null, pomin: (o.pominieteDoRealizacji || []).length, total: o.expectedTotal, have: o.docsLacznieDlaZakresu, got: o.docsZebraneWTejSesji || 0, sec: (o.czasTrwaniaMs || 0) / 1000, done: o.allPagesExhausted === true });
    } catch {}
  }
  return out;
}
// Okno codziennego biegu (lib-wspolne/catchup.js: <TYP>_CATCHUP_WINDOW, domyślnie 5;
// dobij-wszystko.js: minimalny wiek dnia). Starsze dni nadrabia tylko kolejka
// zaległości: automatyzacje/zaleglosci-kolejka.txt — jedno źródło dla orkiestratora
// i tej strony (linie typ:od..do; typy po kolei, następny dopiero po skończeniu
// poprzedniego, pon–pt do 18:00).
const OKNO = { wz: 5 + 1, mm: 5 + 3, pz: 5 + 1, sprzedaz: 21 + 14, zakup: 9 + 2 };
const kolejka = (() => {
  // Zmienna środowiskowa ma pierwszeństwo (podgląd: ZALEGLOSCI_KOLEJKA=wz:od..do,pz:od..do).
  let wpisy;
  if (process.env.ZALEGLOSCI_KOLEJKA) wpisy = process.env.ZALEGLOSCI_KOLEJKA.split(',');
  else {
    try { wpisy = fs.readFileSync(path.join(AUTO, 'zaleglosci-kolejka.txt'), 'utf8').split(/\r?\n/).filter(l => !/^\s*(#|$)/.test(l)); }
    catch { return []; }
  }
  return wpisy.map(x => /^(\w+):(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(x.trim())).filter(Boolean).map(m => ({ t: m[1].toLowerCase(), od: m[2], do: m[3] }));
})();
const weekend = d => new Date(d + 'T00:00:00Z').getUTCDay() % 6 === 0;
const dniRob = n => n === 1 ? '1 dzień roboczy' : n + (n < 5 ? ' dni robocze' : ' dni roboczych');
const poDniachRob = n => { let d = new Date(today), k = 0; while (k < n) { d = addDays(d, 1); if (d.getUTCDay() % 6) k++; } return ymd(d); };

// Ile dokumentów i godzin zostało, w podziale na dni, które nadrobi codzienny bieg,
// kolejka zaległości, albo nikt (poza oknem i poza kolejką).
function zaleglosc(t, niepelne, brak) {
  const wpisy = wpisyLogu(t);
  const ost = new Map();
  for (const w of wpisy) if (w.dzien && (!ost.has(w.dzien) || ost.get(w.dzien).ts < w.ts)) ost.set(w.dzien, w);
  // Nowy typ bez pełnego dnia (np. zakup na starcie): średnia z liczników ERP biegów niepełnych.
  let pelne = [...ost.values()].filter(w => w.done && w.total != null);
  if (!pelne.length) pelne = [...ost.values()].filter(w => w.total > 0);
  // Średnia osobno dla dni roboczych i weekendów (weekend to kilka dok., nie setki).
  const sr = arr => arr.length ? arr.reduce((a, w) => a + w.total, 0) / arr.length : 0;
  const srRob = sr(pelne.filter(w => !weekend(w.dzien))), srWkd = sr(pelne.filter(w => weekend(w.dzien)));
  const od = addDays(today, -21).toISOString();
  const tempoRuns = wpisy.filter(w => w.ts >= od && w.got >= 20);
  const sGot = tempoRuns.reduce((a, w) => a + w.got, 0), sSec = tempoRuns.reduce((a, w) => a + w.sec, 0);
  const sekNaDok = sGot ? sSec / sGot : 5;
  // Licznik ERP z ostatniego biegu, jeśli bieg go odczytał (> 0); inaczej średnia.
  const reszta = d => { const w = ost.get(d); return w && w.total > 0 && w.have != null ? Math.max(0, w.total - w.have) : (weekend(d) ? srWkd : srRob); };
  const wKolejce = kolejka.find(k => k.t === t);
  const r = { dok: 0, godz: 0, dokKolejka: 0, dniPoza: 0, poza: [] };
  for (const d of [...niepelne, ...brak]) {
    const n = reszta(d);
    r.dok += n;
    if (d >= ymd(addDays(today, -OKNO[t]))) continue;               // codzienny bieg
    if (wKolejce && d >= wKolejce.od && d <= wKolejce.do) r.dokKolejka += n;
    else { r.dniPoza++; r.poza.push(d); }
  }
  r.godz = r.dok * sekNaDok / 3600;
  r.godzKolejka = r.dokKolejka * sekNaDok / 3600;
  return r;
}

// Dzienna przepustowość kolejki: godziny pracy zaległości w dniu roboczym, mierzone
// na biegach sprzedaży z ostatniego tygodnia (jedyny typ, który już nadrabia);
// gdy brak danych — 6,5 h (pon–pt ok. 11:30–18:00).
const godzNaDzien = (() => {
  const odT = addDays(today, -7).toISOString(), perDzien = new Map();
  for (const w of wpisyLogu('sprzedaz')) if (w.ts >= odT && w.got) { const k = w.ts.slice(0, 10); if (!weekend(k)) perDzien.set(k, (perDzien.get(k) || 0) + w.sec / 3600); }
  const v = [...perDzien.values()].filter(h => h >= 1);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 6.5;
})();

const zal = {};
for (const t of Object.keys(scope)) {
  const dir = path.join(AUTO, t, 'state');
  const m = new Map(), czeka = new Map();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /\d{4}-\d{2}-\d{2}/.test(f))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s.dateFrom) m.set(s.dateFrom, !!s.complete);
      const ost = (s.runs || [])[(s.runs || []).length - 1];
      if (t === 'zakup' && s.dateFrom && ost && ileCzeka(ost.oczekujace)) czeka.set(s.dateFrom, ileCzeka(ost.oczekujace));
    } catch {}
  }
  let tot = 0, compl = 0, incompl = 0, miss = 0;
  const dniNiepelne = [], dniBrak = [];
  for (let d = new Date(scope[t][0] + 'T00:00:00Z'), e = new Date(scope[t][1] + 'T00:00:00Z'); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const v = m.get(ymd(d)); tot++;
    if (v === true) compl++; else if (v === false) { incompl++; dniNiepelne.push(ymd(d)); } else { miss++; dniBrak.push(ymd(d)); }
  }
  const pct = tot ? Math.round(compl / tot * 100) : 0;
  const nad = (incompl + miss) > 3;
  if (incompl + miss) zal[t] = zaleglosc(t, dniNiepelne, dniBrak);
  bars.push({ t, typ: etykieta[t], pct, compl, incompl, miss, tot, zakres: short(scope[t][0]) + ' – ' + short(scope[t][1]), status: nad ? 'nadrabia' : (incompl ? 'prawie komplet' : 'aktualny'), nad,
    niepelne: zakresy(dniNiepelne), brak: zakresy(dniBrak), est: null, czeka: czekaOpis(scope[t], czeka) });
}
// Ile faktur zakupu z zakresu czeka na zaksięgowanie (ostatni bieg dnia) — osobna linia
// pod paskiem, informacyjnie: to nie zaległość automatu.
function czekaOpis([od, doD], czeka) {
  const dni = [...czeka.keys()].filter(d => d >= od && d <= doD).sort();
  if (!dni.length) return null;
  const n = dni.reduce((a, d) => a + czeka.get(d), 0);
  return 'Czeka na zaksięgowanie w ERP: ' + n + ' faktur z ' + dni.length + (dni.length === 1 ? ' dnia' : ' dni') + ' (' + zakresy(dni) + ') — to nie błąd, przegląd 8 tygodni dobierze je po zaksięgowaniu.';
}
// Szacowana data „aktualny” = koniec zaległości danego typu w kolejce (godziny
// typów przed nim w kolejce + jego własne) / przepustowość dzienna. Od tej daty
// typ bierze już tylko nowe dni z codziennego okna.
let godzSkum = 0;
const koniecKolejki = {};
for (const k of kolejka) { if (!zal[k.t]) continue; godzSkum += zal[k.t].godzKolejka; koniecKolejki[k.t] = godzSkum; }
for (const b of bars) {
  const z = zal[b.t];
  if (!z) continue;
  // Linia 1: data (koniec zaległości wg kolejki). Linia 2 (pomarańczowa): dni, których
  // automat nie nadrobi wcale — do przyjrzenia się.
  let data = null;
  if (koniecKolejki[b.t] != null && z.dokKolejka > 0) data = poDniachRob(Math.max(1, Math.ceil(koniecKolejki[b.t] / godzNaDzien)));
  else if (z.dniPoza < b.incompl + b.miss) data = poDniachRob(1);
  const uwaga = z.dniPoza
    ? 'Poza automatem, do sprawdzenia: ' + zakresy(z.poza.sort()) + ' — ani codzienny bieg, ani kolejka zaległości tych dni nie obejmują.'
    : null;
  // Nadrabianie tylko pon–pt — dzień tygodnia przy dacie, żeby było widać, że weekend pominięty.
  const DT = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  b.est = { data: data ? short(data) + ' (' + DT[new Date(data + 'T00:00:00Z').getUTCDay()] + ')' : null, uwaga };
}

// --- karty: produkty, kontrahenci ---
const cards = [];
// Produkty: od 2026-10-09 krok PRODUKTY w orkiestratorze (brakujace-produkty.js)
// dociąga karty towarów z pozycji dokumentów, których nie ma w csItems.
// Stary sekwencyjny scraper SKU (sekwencja.json) porzucony.
try {
  const s = JSON.parse(fs.readFileSync(path.join(AUTO, 'produkty/state/brakujace-ostatnie.json'), 'utf8'));
  cards.push({ nm: 'Produkty', pill: s.ok === false ? 'błąd biegu' : 'codziennie', rows: [
    ['Brakujące karty', fmt(s.brakowalo)], ['Wzięte do biegu', fmt(s.wBiegu)],
    ['Ostatni bieg', s.ts ? short(s.ts.slice(0, 10)) : '—']] });
} catch {}
try {
  const s = JSON.parse(fs.readFileSync(path.join(AUTO, 'kontrahenci/state/kontrola-ostatnia.json'), 'utf8'));
  const b = s.roznicaBilansu;
  // Krok KONTRAHENCI w orkiestratorze: codziennie NOWI kontrahenci, w środę pełny przegląd
  // (przeglad.js --zapisz: UPDATE zmienionych + historia csCustomersZmiany).
  const rows = [['W bazie', fmt(s.wWorku)], ['W ERP', fmt(s.erpWszyscy)], ['Bilans', (b > 0 ? '+' : (b < 0 ? '−' : '')) + Math.abs(b || 0)], ['Ostatni bieg', s.ts ? short(s.ts.slice(0, 10)) : '—']];
  const pp = path.join(AUTO, 'kontrahenci/state/przeglad-ostatni.json');
  if (fs.existsSync(pp)) {
    try {
      const pr = JSON.parse(fs.readFileSync(pp, 'utf8'));
      const kiedy = String(pr.ts || pr.data || fs.statSync(pp).mtime.toISOString()).slice(0, 10);
      rows.push(['Przegląd zmian', short(kiedy) + (pr.pelny === false ? ' (niepełny)' : '')]);
      rows.push(['Zmienionych / nowych', fmt(pr.zmienionych) + ' / ' + fmt(pr.nowych)]);
    } catch {}
  } else rows.push(['Przegląd zmian', 'pierwszy w środę']);
  cards.push({ nm: 'Kontrahenci', pill: 'codziennie + śr. przegląd', rows });
} catch {}

// --- aktywność: ostatnie DNI, pogrupowane po lokalnej dacie biegu ---
const ILE_DNI = 10;
const since = addDays(today, -(ILE_DNI - 1)).getTime();
const localDate = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
const localTime = iso => new Date(iso).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const wpisy = [];
for (const t of Object.keys(scope)) {
  const p = path.join(AUTO, t, 'run-log.jsonl');
  if (!fs.existsSync(p)) continue;
  for (const ln of fs.readFileSync(p, 'utf8').trim().split('\n')) {
    try {
      const o = JSON.parse(ln);
      if (new Date(o.ts).getTime() < since) continue;
      wpisy.push({
        // Sprzedaż ma własny format logu: dzien, juzWBazie+wstawiono, fa+par, complete.
        ts: o.ts, typ: etykieta[t], dzien: o.filterDateFrom || o.filterDateTo || o.dzien || null,
        docs: o.docsLacznieDlaZakresu ?? o.docsZebraneWTejSesji ?? (o.wstawiono != null ? (o.juzWBazie || 0) + o.wstawiono : null),
        expected: o.expectedTotal ?? (o.fa != null ? o.fa + (o.par || 0) : (t === 'zakup' && o.fz != null ? o.fz + (o.fzKsef || 0) - ileCzeka(o.oczekujace) : null)),
        szczeg: o.fa != null ? rozbicieSprzedazy(o) : (t === 'zakup' ? rozbicieZakupu(o) : null),
        done: o.allPagesExhausted === true || o.complete === true, blad: o.blad ? String(o.blad).split('\n')[0].slice(0, 60) : null
      });
    } catch {}
  }
}
// Sprzedaż: pobieramy tylko FA i PAR; reszta listy ERP (korekty itd.) jest pomijana.
// Starsze wpisy logu nie mają rozbicia pominiętych — wtedy sama różnica.
function rozbicieSprzedazy(o) {
  const cz = ['FA ' + o.fa, 'PAR ' + (o.par || 0)];
  const pom = o.pominiete ? Object.entries(o.pominiete).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n).join(', ') : '';
  const reszta = o.erpRekordow != null ? o.erpRekordow - o.fa - (o.par || 0) : 0;
  if (pom) cz.push('pominięte: ' + pom);
  else if (reszta > 0) cz.push('pominięte inne typy: ' + reszta);
  return cz.join(' · ');
}
// Zakup: liczymy tylko zaksięgowane FZ/FZ_KSEF; niezaksięgowane osobno (nie błąd).
function rozbicieZakupu(o) {
  const cz = ['FZ ' + (o.fz || 0), 'FZ_KSEF ' + (o.fzKsef || 0)];
  const n = ileCzeka(o.oczekujace);
  if (n) cz.push('czeka na zaksięgowanie: ' + n);
  if (o.tryb === 'przeglad') cz.push('przegląd 8 tyg.');
  if (o.cel === 'test') cz.push('test (_test)');
  return cz.join(' · ');
}
const grupy = new Map();
for (const w of wpisy) { const d = localDate(w.ts); if (!grupy.has(d)) grupy.set(d, []); grupy.get(d).push(w); }
const dni = [...grupy.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([data, arr]) => {
  arr.sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    label: short(data), ok: arr.filter(w => w.done).length, err: arr.filter(w => w.blad).length, ile: arr.length,
    runs: arr.map(w => ({
      t: localTime(w.ts), typ: w.typ,
      opis: (w.dzien ? short(w.dzien) : '—') + (w.docs != null ? ' · ' + w.docs + (w.expected != null && w.expected !== w.docs ? '/' + w.expected : (w.done ? '/' + w.docs : '')) : ''),
      szczeg: w.szczeg,
      stan: w.done ? 'komplet' : (w.blad ? 'ponawianie' : 'w toku'),
      klasa: w.done ? 'st-ok' : (w.blad ? 'st-retry' : 'st-wip')
    }))
  };
});

// --- lista kontrolna: ERP vs baza, dzień po dniu ---
// „W ERP” = licznik listy ERP z ostatniego biegu danego dnia (run-log), „w bazie” =
// COUNT nagłówków w dbo.csDocsHeaders po DocDate (status/liczniki-bazy.js).
// MM: ERP minus dokumenty „Do realizacji”, których scraper z założenia nie zapisuje.
async function listaKontrolna() {
  const TYPY_K = [['WZ', 'wz'], ['MM', 'mm'], ['PZ', 'pz'], ['FA', 'sprzedaz'], ['PAR', 'sprzedaz'], ['FZ', 'zakup']];
  // WZ/MM/PZ: ERP filtruje listę po swojej dacie, a dokument ma własny DocDate, więc
  // COUNT po DocDate nie zejdzie się 1:1. Test kompletności = czy numery zebrane dla
  // dnia-filtra (state/processedDocNumbers) są w bazie. FA/PAR: filtr = DocDate, COUNT wystarcza.
  const zebrane = {};
  for (const [kod, t] of TYPY_K.slice(0, 3)) {
    zebrane[kod] = new Map();
    const dir = path.join(AUTO, t, 'state');
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /^\w+_(\d{4}-\d{2}-\d{2})_\1\.json$/.test(f))) {
      try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); zebrane[kod].set(s.dateFrom, s.processedDocNumbers || []); } catch {}
    }
  }
  let baza = null, bladBazy = null;
  try {
    const numery = Object.fromEntries(Object.entries(zebrane).map(([k, m]) => [k, [...m.values()].flat()]));
    baza = await require('./liczniki-bazy').liczniki(Object.values(scope).map(s => s[0]).sort()[0], numery);
  } catch (e) { bladBazy = String(e && e.message || e).split('\n')[0].slice(0, 120); }
  const typy = TYPY_K.map(([kod, t]) => {
    const ost = new Map();
    for (const w of wpisyLogu(t)) if (w.dzien && (!ost.has(w.dzien) || ost.get(w.dzien).ts < w.ts)) ost.set(w.dzien, w);
    const erpDnia = d => {
      const w = ost.get(d);
      if (!w) return null;
      if (kod === 'FA') return w.fa;
      if (kod === 'PAR') return w.par;
      // FZ = FZ + FZ_KSEF zaksięgowane (bez czekających); bieg bez licznika → null.
      if (kod === 'FZ') return w.fz ? w.total : (w.done ? 0 : null);
      // Bieg bez kompletu i z licznikiem 0 = licznik nieodczytany (np. pagination_stuck).
      if (w.total == null || (!w.done && !w.total)) return null;
      return w.total - (w.pomin || 0);
    };
    const poNumerach = !!zebrane[kod];
    const wiersze = [];
    let zgodne = 0, rozne = 0, bezErp = 0;
    for (let d = new Date(scope[t][0] + 'T00:00:00Z'), e = new Date(scope[t][1] + 'T00:00:00Z'); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
      const dz = ymd(d), erp = erpDnia(dz);
      let wb = null;
      if (baza) {
        if (poNumerach) { const nr = zebrane[kod].get(dz); wb = nr ? nr.filter(n => baza.obecne[kod].has(n)).length : 0; }
        else wb = baza.dzien[kod + '|' + dz] || 0;
      }
      if (erp == null) bezErp++; else if (wb != null && wb === erp) zgodne++; else if (wb != null) rozne++;
      wiersze.push(kod === 'FZ' ? [dz, erp, wb, ost.get(dz) ? ost.get(dz).czeka : null] : [dz, erp, wb]);
    }
    wiersze.reverse();
    return { kod: kod === 'FZ' ? 'FZ + FZ_KSEF' : kod, czeka: kod === 'FZ', poNumerach, zgodne, rozne, bezErp, wiersze };
  });
  return { typy, baza: !!baza, bladBazy };
}

(async () => {
const kontrola = await listaKontrolna();
const DANE = { generatedAt: new Date().toISOString(), bars, cards, dni, kontrola };

const SZABLON = `<title>Status scraperów ERP</title>
<style>
  :root{
    --bg:#f7f6f2;--surface:#fff;--ink:#1b1b19;--ink-2:#5c5b55;--ink-3:#8a897f;
    --line:#e4e2d9;--ok:#1d9e75;--warn:#ef9f27;--miss:rgba(138,137,127,.28);
    --accent:#185fa5;--bg-ok:#e1f5ee;--bg-warn:#faeeda;--bg-accent:#e6f1fb;--warn-ink:#9a6410;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#16160f;--surface:#1f1f1b;--ink:#f0efe6;--ink-2:#bdbcb1;--ink-3:#8a897f;
    --line:#32322c;--miss:rgba(138,137,127,.30);--accent:#85b7eb;
    --bg-ok:#0f3a2d;--bg-warn:#3a2c10;--bg-accent:#123049;--warn-ink:#f0c879;color-scheme:dark;}}
  :root[data-theme="dark"]{
    --bg:#16160f;--surface:#1f1f1b;--ink:#f0efe6;--ink-2:#bdbcb1;--ink-3:#8a897f;
    --line:#32322c;--miss:rgba(138,137,127,.30);--accent:#85b7eb;
    --bg-ok:#0f3a2d;--bg-warn:#3a2c10;--bg-accent:#123049;--warn-ink:#f0c879;color-scheme:dark;}
  *{box-sizing:border-box}
  body{background:var(--bg);color:var(--ink);font-family:var(--font);line-height:1.5;margin:0}
  .wrap{max-width:760px;margin:0 auto;padding-block:2rem;padding-left:16px;padding-right:16px}
  h1{font-size:22px;font-weight:500;margin:0 0 2px}
  h2{font-size:16px;font-weight:500;margin:2rem 0 .75rem}
  .sub{color:var(--ink-2);font-size:13px;margin:0}
  .tnum{font-variant-numeric:tabular-nums}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin:1rem 0 .5rem;font-size:12px;color:var(--ink-2)}
  .legend span{display:flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
  .bars{display:flex;flex-direction:column;gap:1.05rem}
  .row-top{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:8px}
  .row-name{display:flex;align-items:center;gap:9px;min-width:0}
  .nm{font-size:16px;font-weight:500}
  .badge{font-size:12px;padding:2px 10px;border-radius:999px;white-space:nowrap}
  .b-ok{background:var(--bg-ok);color:var(--ok)}
  .b-warn{background:var(--bg-warn);color:var(--warn-ink)}
  .pct{font-size:24px;font-weight:500}
  .track{display:flex;width:100%;height:16px;border-radius:6px;overflow:hidden;background:var(--miss)}
  .track>i{display:block}
  .row-foot{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:13px;color:var(--ink-2)}
  details.which{margin-top:4px;font-size:13px;color:var(--ink-2)}
  details.which summary{display:inline-flex;padding:2px 0;font-size:12px;color:var(--accent)}
  details.which[open] summary .chev{transform:rotate(90deg)}
  .which p{margin:4px 0 0;line-height:1.45}
  .which b{font-weight:500;color:var(--ink)}
  .est{margin-top:4px;font-size:12px;color:var(--ink-2)}
  .est b{font-weight:500;color:var(--ink)}
  .est .k{display:block;color:var(--ink-3)}
  .est .k.r{color:var(--warn-ink)}
  .ktab{max-height:420px;overflow:auto;border-top:.5px solid var(--line)}
  .ktab table{width:100%;border-collapse:collapse;font-size:13px}
  .ktab th{position:sticky;top:0;background:var(--surface);text-align:right;font-weight:500;color:var(--ink-2);padding:6px 14px;border-bottom:.5px solid var(--line)}
  .ktab td{text-align:right;padding:4px 14px;border-bottom:.5px solid var(--line)}
  .ktab th:first-child,.ktab td:first-child{text-align:left}
  .kr-roz td{background:var(--bg-warn);color:var(--warn-ink)}
  .kr-brak td{color:var(--ink-3)}
  .roz{font-weight:500;color:var(--warn-ink)}
  .kopiuj{font:inherit;font-size:12px;padding:5px 12px;margin-bottom:10px;border-radius:8px;border:.5px solid var(--line);background:var(--surface);color:var(--accent);cursor:pointer}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .card{background:var(--surface);border:.5px solid var(--line);border-radius:12px;padding:1rem 1.1rem}
  .ct{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
  .cn{font-size:15px;font-weight:500}
  .pill{font-size:11px;padding:2px 9px;border-radius:999px;background:var(--bg-accent);color:var(--accent)}
  .kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:var(--ink-2)}
  .kv b{font-weight:500;color:var(--ink)}
  .days{display:flex;flex-direction:column;gap:8px}
  details.day{background:var(--surface);border:.5px solid var(--line);border-radius:12px;overflow:hidden}
  summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;font-size:14px}
  summary::-webkit-details-marker{display:none}
  summary .dl{display:flex;align-items:center;gap:8px;font-weight:500}
  summary .chev{color:var(--ink-3);transition:transform .15s}
  details[open] summary .chev{transform:rotate(90deg)}
  .daymeta{font-size:12px;color:var(--ink-2)}
  .le{display:grid;grid-template-columns:48px 44px 1fr auto;gap:10px;align-items:center;padding:8px 14px;font-size:13px;border-top:.5px solid var(--line)}
  .le .t{color:var(--ink-3);font-size:12px}
  .le .ty{font-weight:500}
  .le .d{color:var(--ink-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .le .d small{display:block;white-space:normal;font-size:12px;color:var(--ink-3)}
  .st{font-size:12px;padding:1px 9px;border-radius:999px;white-space:nowrap}
  .st-ok{background:var(--bg-ok);color:var(--ok)}
  .st-retry{background:var(--bg-warn);color:var(--warn-ink)}
  .st-wip{background:var(--bg-accent);color:var(--accent)}
  .foot{margin-top:1.5rem;font-size:12px;color:var(--ink-3)}
</style>
<div class="wrap">
  <h1>Status scraperów ERP</h1>
  <p class="sub">Dobicie pełnych danych w bazie worek · stan na <span id="gen" class="tnum">—</span></p>
  <div class="legend">
    <span><i class="sw" style="background:var(--ok)"></i>dni kompletne</span>
    <span><i class="sw" style="background:var(--warn)"></i>niepełne</span>
    <span><i class="sw" style="background:var(--miss)"></i>jeszcze brak</span>
  </div>
  <div class="bars" id="bars"></div>
  <h2>Pozostałe scrapery</h2>
  <div class="cards" id="cards"></div>
  <h2>Lista kontrolna: ERP vs baza</h2>
  <div class="days" id="kontrola"></div>
  <h2>Aktywność dzień po dniu</h2>
  <div class="days" id="days"></div>
  <p class="foot" id="foot"></p>
</div>
<script>
var DANE = /*__DANE__*/;
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
function fmtGen(iso){try{return new Date(iso).toLocaleString("pl-PL",{timeZone:"Europe/Warsaw",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}catch(e){return iso.replace("T"," ").slice(0,16)}}
document.getElementById("gen").textContent = fmtGen(DANE.generatedAt);
function w(x){return Math.max(0,x).toFixed(2)}
document.getElementById("bars").innerHTML = DANE.bars.map(function(d){
  var bc = d.nad ? "b-warn" : "b-ok";
  return '<div><div class="row-top"><div class="row-name"><span class="nm">'+esc(d.typ)+'</span><span class="badge '+bc+'">'+esc(d.status)+'</span></div>'
   +'<span class="pct tnum">'+d.pct+'%</span></div>'
   +'<div class="track" role="img" aria-label="'+esc(d.typ)+': '+d.pct+' procent dni kompletnych">'
   +'<i style="width:'+w(d.compl/d.tot*100)+'%;background:var(--ok)"></i>'
   +'<i style="width:'+w(d.incompl/d.tot*100)+'%;background:var(--warn)"></i></div>'
   +'<div class="row-foot"><span class="tnum">'+d.compl+' gotowe · '+d.incompl+' niepełne · '+d.miss+' brak <span style="color:var(--ink-3)">(z '+d.tot+' dni)</span></span>'
   +'<span style="color:var(--ink-3)">'+esc(d.zakres)+'</span></div>'
   +(d.est ? '<div class="est tnum">Szacowane nadrobienie wszystkich zaległości: <b>'+(d.est.data ? esc(d.est.data) : 'brak daty — poza automatem')+'</b>'
     +(d.est.uwaga ? '<span class="k r">'+esc(d.est.uwaga)+'</span>' : '')+'</div>' : '')
   +(d.czeka ? '<div class="est tnum"><span class="k">'+esc(d.czeka)+'</span></div>' : '')
   +((d.niepelne||d.brak) ? '<details class="which"><summary><span class="chev">›</span>&nbsp;które dni</summary>'
     +(d.niepelne ? '<p class="tnum"><b>Niepełne:</b> '+esc(d.niepelne)+'</p>' : '')
     +(d.brak ? '<p class="tnum"><b>Brak:</b> '+esc(d.brak)+'</p>' : '')+'</details>' : '')
   +'</div>';
}).join("");
document.getElementById("cards").innerHTML = DANE.cards.map(function(c){
  return '<div class="card"><div class="ct"><span class="cn">'+esc(c.nm)+'</span><span class="pill">'+esc(c.pill)+'</span></div>'
   + c.rows.map(function(r){return '<div class="kv"><span>'+esc(r[0])+'</span><b class="tnum">'+esc(r[1])+'</b></div>'}).join("") + '</div>';
}).join("");
document.getElementById("days").innerHTML = DANE.dni.map(function(g,i){
  var runs = g.runs.map(function(e){
    return '<div class="le"><span class="t tnum">'+esc(e.t)+'</span><span class="ty">'+esc(e.typ)+'</span>'
     +'<span class="d">'+esc(e.opis)+(e.szczeg ? '<small class="tnum">'+esc(e.szczeg)+'</small>' : '')+'</span><span class="st '+e.klasa+'">'+esc(e.stan)+'</span></div>';
  }).join("");
  var meta = g.ok+' dni gotowe'+(g.err? ' · '+g.err+' ponowień':'');
  return '<details class="day"'+(i===0?' open':'')+'><summary><span class="dl"><span class="chev">&#9656;</span>'+esc(g.label)+'</span>'
   +'<span class="daymeta tnum">'+meta+'</span></summary>'+runs+'</details>';
}).join("");
if(!DANE.dni.length) document.getElementById("days").innerHTML = '<div class="card" style="color:var(--ink-2);font-size:13px">Brak aktywności w ostatnich dniach.</div>';
(function(){
  var K = DANE.kontrola, el = document.getElementById("kontrola");
  if (!K) { el.innerHTML = ""; return; }
  function n(v){ return v == null ? "—" : Number(v).toLocaleString("pl-PL"); }
  var intro = '<p class="sub" style="margin-bottom:.75rem">„W ERP” to licznik listy dokumentów w ERP z ostatniego jednodniowego biegu. „W bazie”: dla WZ, MM i PZ — ile dokumentów zebranych z listy ERP tego dnia faktycznie jest w bazie worek (sprawdzane po numerze); dla FA i PAR — liczba nagłówków w bazie z tą datą dokumentu.'
    + (K.baza ? '' : ' <b>Baza niedostępna przy tym odświeżeniu' + (K.bladBazy ? ' (' + esc(K.bladBazy) + ')' : '') + ' — kolumna „w bazie” pusta.</b>')
    + ' FA w bazie więcej niż w ERP = dokument skasowany w ERP po zapisie (do bazy tylko dopisujemy).'
    + ' FZ + FZ_KSEF: dzień = data wpływu (DocReceiptDate), „w ERP” = tylko zaksięgowane; „czeka” = jeszcze niezaksięgowane — to nie błąd, przegląd 8 tygodni dobierze je później.</p>'
    + '<button type="button" class="kopiuj" id="kopiujK">Kopiuj całą listę (do Excela)</button>';
  el.innerHTML = intro + K.typy.map(function(t){
    var meta = t.zgodne + ' zgodnych' + (t.rozne ? ' · <b class="roz">' + t.rozne + ' z różnicą</b>' : '') + (t.bezErp ? ' · ' + t.bezErp + ' bez licznika ERP' : '');
    var rows = t.wiersze.map(function(w){
      var r = (w[1] != null && w[2] != null) ? w[2] - w[1] : null;
      var cls = r ? ' class="kr-roz"' : (w[1] == null ? ' class="kr-brak"' : '');
      return '<tr' + cls + '><td>' + esc(w[0].slice(8,10) + '.' + w[0].slice(5,7)) + '</td><td>' + n(w[1]) + '</td><td>' + n(w[2]) + '</td><td>' + (r == null ? '' : (r > 0 ? '+' : (r < 0 ? '−' : '')) + Math.abs(r)) + '</td>' + (t.czeka ? '<td>' + (w[3] ? n(w[3]) : '') + '</td>' : '') + '</tr>';
    }).join("");
    return '<details class="day"><summary><span class="dl"><span class="chev">›</span>' + esc(t.kod) + '</span><span class="daymeta tnum">' + meta + '</span></summary>'
      + '<div class="ktab"><table class="tnum"><thead><tr><th>Dzień</th><th>W ERP</th><th>W bazie</th><th>Różnica</th>' + (t.czeka ? '<th>Czeka</th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div></details>';
  }).join("");
  document.getElementById("kopiujK").onclick = function(){
    var T = String.fromCharCode(9), N = String.fromCharCode(10);
    var txt = "Lista kontrolna ERP vs baza — stan na " + fmtGen(DANE.generatedAt) + N + "Typ" + T + "Dzień" + T + "W ERP" + T + "W bazie" + T + "Różnica" + T + "Czeka na zaksięgowanie" + N;
    K.typy.forEach(function(t){ t.wiersze.forEach(function(w){
      var r = (w[1] != null && w[2] != null) ? w[2] - w[1] : "";
      txt += t.kod + T + w[0] + T + (w[1] == null ? "" : w[1]) + T + (w[2] == null ? "" : w[2]) + T + r + T + (w[3] ? w[3] : "") + N;
    }); });
    var b = this;
    function ok(){ b.textContent = "Skopiowano"; setTimeout(function(){ b.textContent = "Kopiuj całą listę (do Excela)"; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fallback); else fallback();
    function fallback(){ var a = document.createElement("textarea"); a.value = txt; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); ok(); } catch(e) {} document.body.removeChild(a); }
  };
})();
document.getElementById("foot").textContent = "Odświeżane automatycznie po każdym biegu. Sprzedaż, zakup i produkty mają opóźnienie z założenia (faktury i karty dochodzą z datą wstecz; faktury zakupu dopiero po zaksięgowaniu).";
</script>`;

fs.writeFileSync(OUT, SZABLON.replace('/*__DANE__*/', JSON.stringify(DANE)), 'utf8');
console.log('[status] zapisano ' + path.relative(AUTO, OUT) + ' (' + bars.length + ' paskow, ' + dni.length + ' dni aktywnosci, baza: ' + (kontrola.baza ? 'tak' : 'NIE') + ')');

// Commit + push strony (chyba że NO_PUSH=1 — np. przy ręcznym podglądzie).
if (process.env.NO_PUSH !== '1') {
  try {
    require('../lib-wspolne/git-log-push').pushFile('automatyzacje/status/index.html',
      'Status scraperów — ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  } catch (e) { console.warn('[status] push pominięty: ' + (e && e.message)); }
}
})();
