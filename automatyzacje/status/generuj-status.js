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
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('pl-PL'));

// --- dni per typ dokumentowy ---
const scope = {
  wz: ['2026-07-25', ymd(addDays(today, -1))],
  mm: ['2026-07-24', ymd(addDays(today, -3))],
  pz: ['2026-07-25', ymd(addDays(today, -1))],
  sprzedaz: ['2026-07-01', ymd(addDays(today, -14))]
};
const etykieta = { wz: 'WZ', mm: 'MM', pz: 'PZ', sprzedaz: 'Sprzedaż' };
const bars = [];
for (const t of Object.keys(scope)) {
  const dir = path.join(AUTO, t, 'state');
  const m = new Map();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter(f => /\d{4}-\d{2}-\d{2}/.test(f))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (s.dateFrom) m.set(s.dateFrom, !!s.complete); } catch {}
  }
  let tot = 0, compl = 0, incompl = 0, miss = 0;
  for (let d = new Date(scope[t][0] + 'T00:00:00Z'), e = new Date(scope[t][1] + 'T00:00:00Z'); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const v = m.get(ymd(d)); tot++; if (v === true) compl++; else if (v === false) incompl++; else miss++;
  }
  const pct = tot ? Math.round(compl / tot * 100) : 0;
  const nad = (incompl + miss) > 3;
  bars.push({ typ: etykieta[t], pct, compl, incompl, miss, tot, zakres: short(scope[t][0]) + ' – ' + short(scope[t][1]), status: nad ? 'nadrabia' : (incompl ? 'prawie komplet' : 'aktualny'), nad });
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
  cards.push({ nm: 'Kontrahenci', pill: 'ręcznie', rows: [['W bazie', fmt(s.wWorku)], ['W ERP', fmt(s.erpWszyscy)], ['Bilans', (b > 0 ? '+' : (b < 0 ? '−' : '')) + Math.abs(b || 0)], ['Ostatni bieg', s.ts ? short(s.ts.slice(0, 10)) : '—']] });
} catch {}

// --- aktywność: ostatnie DNI, pogrupowane po lokalnej dacie biegu ---
const ILE_DNI = 10;
const since = addDays(today, -(ILE_DNI - 1)).getTime();
const localDate = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
const localTime = iso => new Date(iso).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const wpisy = [];
for (const t of ['wz', 'mm', 'pz', 'sprzedaz']) {
  const p = path.join(AUTO, t, 'run-log.jsonl');
  if (!fs.existsSync(p)) continue;
  for (const ln of fs.readFileSync(p, 'utf8').trim().split('\n')) {
    try {
      const o = JSON.parse(ln);
      if (new Date(o.ts).getTime() < since) continue;
      wpisy.push({
        ts: o.ts, typ: etykieta[t], dzien: o.filterDateFrom || o.filterDateTo || null,
        docs: o.docsLacznieDlaZakresu ?? o.docsZebraneWTejSesji ?? null, expected: o.expectedTotal ?? null,
        done: o.allPagesExhausted === true, blad: o.blad ? String(o.blad).split('\n')[0].slice(0, 60) : null
      });
    } catch {}
  }
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
      stan: w.done ? 'komplet' : (w.blad ? 'ponawianie' : 'w toku'),
      klasa: w.done ? 'st-ok' : (w.blad ? 'st-retry' : 'st-wip')
    }))
  };
});

const DANE = { generatedAt: new Date().toISOString(), bars, cards, dni };

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
   +'<span style="color:var(--ink-3)">'+esc(d.zakres)+'</span></div></div>';
}).join("");
document.getElementById("cards").innerHTML = DANE.cards.map(function(c){
  return '<div class="card"><div class="ct"><span class="cn">'+esc(c.nm)+'</span><span class="pill">'+esc(c.pill)+'</span></div>'
   + c.rows.map(function(r){return '<div class="kv"><span>'+esc(r[0])+'</span><b class="tnum">'+esc(r[1])+'</b></div>'}).join("") + '</div>';
}).join("");
document.getElementById("days").innerHTML = DANE.dni.map(function(g,i){
  var runs = g.runs.map(function(e){
    return '<div class="le"><span class="t tnum">'+esc(e.t)+'</span><span class="ty">'+esc(e.typ)+'</span>'
     +'<span class="d">'+esc(e.opis)+'</span><span class="st '+e.klasa+'">'+esc(e.stan)+'</span></div>';
  }).join("");
  var meta = g.ok+' dni gotowe'+(g.err? ' · '+g.err+' ponowień':'');
  return '<details class="day"'+(i===0?' open':'')+'><summary><span class="dl"><span class="chev">&#9656;</span>'+esc(g.label)+'</span>'
   +'<span class="daymeta tnum">'+meta+'</span></summary>'+runs+'</details>';
}).join("");
if(!DANE.dni.length) document.getElementById("days").innerHTML = '<div class="card" style="color:var(--ink-2);font-size:13px">Brak aktywności w ostatnich dniach.</div>';
document.getElementById("foot").textContent = "Odświeżane automatycznie po każdym biegu. Sprzedaż i produkty mają opóźnienie z założenia (faktury i karty dochodzą z datą wstecz).";
</script>`;

fs.writeFileSync(OUT, SZABLON.replace('/*__DANE__*/', JSON.stringify(DANE)), 'utf8');
console.log('[status] zapisano ' + path.relative(AUTO, OUT) + ' (' + bars.length + ' paskow, ' + dni.length + ' dni aktywnosci)');

// Commit + push strony (chyba że NO_PUSH=1 — np. przy ręcznym podglądzie).
if (process.env.NO_PUSH !== '1') {
  try {
    require('../lib-wspolne/git-log-push').pushFile('automatyzacje/status/index.html',
      'Status scraperów — ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
  } catch (e) { console.warn('[status] push pominięty: ' + (e && e.message)); }
}
