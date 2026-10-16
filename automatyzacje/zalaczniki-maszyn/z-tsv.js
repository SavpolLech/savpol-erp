// Zapis wyniku zebranego w przeglądarce (sesja Lecha w Chrome, 16.10.2026) do state/zalaczniki.json —
// ten sam format i ta sama kontrola co w zbierz.js. Wejście: TSV sku, rodzaj, plik, dodano, base64(FileIdent).
//   node zalaczniki-maszyn/z-tsv.js <plik.tsv>
const fs = require('fs');
const path = require('path');
const { pushLogs } = require('../lib-wspolne/git-log-push');

const PREFIX = 'https://esavpol.pl/api/attachment/get/72203914-A31D-4B25-7735-F18BE44421C2/OpenFileIdent/';
const DOZWOLONE = [/^specyfikacja/i, /^instrukcja/i]; // jak w zbierz.js
const STATE_DIR = path.join(__dirname, 'state');
const WYNIK = path.join(STATE_DIR, 'zalaczniki.json');
const RUN_LOG = path.join(__dirname, 'run-log.jsonl');

(async () => {
  const wiersze = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
  const produkty = {};
  let zlych = 0;
  for (const [sku, rodzaj, nazwa, dodano, b64] of wiersze) {
    if (!DOZWOLONE.some(re => re.test(rodzaj))) continue;
    const url = PREFIX + b64 + '/' + encodeURIComponent(nazwa);
    let sprawdzono;
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-4' } });
      const t = Buffer.from(await r.arrayBuffer()).toString('latin1', 0, 5);
      sprawdzono = r.ok && t.startsWith('%PDF') ? 'ok' : 'HTTP ' + r.status + ' ' + JSON.stringify(t);
    } catch (e) { sprawdzono = 'błąd: ' + e.message; }
    if (sprawdzono !== 'ok') { zlych++; console.warn('[kontrola] ' + sku + ' ' + nazwa + ': ' + sprawdzono); }
    (produkty[sku] = produkty[sku] || []).push({ rodzaj, nazwa, dodano, url, sprawdzono });
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(WYNIK, JSON.stringify({ zbudowano: new Date().toISOString(),
    zrodlo: 'ERP przez sesję Lecha w Chrome: zakładka Załączniki + akcja csAttachmentsSaveToFileLastVersion', produkty }, null, 1));
  const n = Object.values(produkty).reduce((a, l) => a + l.length, 0);
  fs.appendFileSync(RUN_LOG, JSON.stringify({ ts: new Date().toISOString(), zrodlo: 'chrome', maszynZLinkami: Object.keys(produkty).length, linkow: n, zlychLinkow: zlych }) + '\n');
  console.log('linków: ' + n + ' (' + Object.keys(produkty).length + ' maszyn), złych: ' + zlych);
  pushLogs('zalaczniki-maszyn', n + ' linków PDF, ' + Object.keys(produkty).length + ' maszyn');
})();
