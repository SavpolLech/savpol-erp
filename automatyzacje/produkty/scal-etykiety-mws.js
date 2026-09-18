// Scala wyniki scrapowania etykiet MWS w JEDEN plik wyjściowy:
// id,custom_label_1,custom_label_2,custom_label_3 — nic poza tym
// (Lech, 2026-09-15; klucz poprawiony z SKU na id tego samego dnia).
//
// Źródłem jest sesje-log.txt, NIE same pliki etykiety-run-*.csv — te
// zmieniały nagłówek dwa razy w trakcie tego samego dnia (najpierw robocze
// id;ean;sku;...;custom_label_3=kruchy, potem SKU,...,custom_label_3, na
// koniec id,...,custom_label_3), a log konsoli ("[produkt] id=... SKU=...
// → custom_label_3=...") ma id i etykietę w KAŻDEJ z tych wersji jednolicie
// — więc jest pewniejszym źródłem niż próba rozpoznawania, który plik CSV
// jest w którym formacie.
//
// Uruchomienie: node scal-etykiety-mws.js [plik-wyjsciowy.csv] [--log=sciezka]

const fs = require('fs');
const path = require('path');
const { OUT_DIR } = require('./lib/state-etykiety');

const argi = process.argv.slice(2);
const logArg = argi.find(a => a.startsWith('--log='));
const sciezkaLogu = logArg ? logArg.slice('--log='.length) : path.join(__dirname, 'sesje-log.txt');
const plikWyjArg = argi.find(a => !a.startsWith('--'));
const wyjscie = plikWyjArg ? path.resolve(plikWyjArg) : path.join(OUT_DIR, '..', 'etykiety-mws-scalone.csv');

const WZORZEC = /\[produkt\] id=(\d+) SKU=\S+ → custom_label_3="([^"]*)"/;

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  if (!fs.existsSync(sciezkaLogu)) {
    console.error('[scal] Nie znaleziono logu: ' + sciezkaLogu);
    process.exit(1);
  }
  const linie = fs.readFileSync(sciezkaLogu, 'utf8').split(/\r?\n/);

  // Mapa id → etykieta. Gdy to samo id pojawi się kilka razy (np. produkt
  // był w dwóch przebiegach), bierzemy OSTATNIE wystąpienie — najświeższy
  // odczyt z ERP.
  const mapa = new Map();
  for (const linia of linie) {
    const m = linia.match(WZORZEC);
    if (!m) continue;
    mapa.set(m[1], m[2] === 'kruchy' ? 'kruche' : m[2]); // stara nazwa sprzed korekty
  }

  if (!mapa.size) {
    console.log('[scal] W logu ' + sciezkaLogu + ' nie znalazłem żadnej linii "[produkt] id=...". Nic do zapisania.');
    return;
  }

  // Fallback: pozycje z RĘCZNYCH testów sprzed uruchomienia orkiestracji
  // (etykiety-run-001/002.csv, stary roboczy format id;ean;sku;...;status) —
  // sesje-log.txt zaczyna się dopiero od startu orkiestracji (nadpisany, nie
  // dopisywany), więc tych 20 pozycji nie ma w logu. Dobieramy je z CSV,
  // TYLKO gdy id nie ma już w mapie z logu (log jest świeższy/pewniejszy).
  let doDobrania = 0;
  if (fs.existsSync(OUT_DIR)) {
    for (const plik of fs.readdirSync(OUT_DIR).filter(f => f.startsWith('etykiety-run-') && f.endsWith('.csv'))) {
      const tresc = fs.readFileSync(path.join(OUT_DIR, plik), 'utf8').replace(/^﻿/, '');
      const linie = tresc.split(/\r?\n/).filter(Boolean);
      if (!linie.length) continue;
      const delimiter = linie[0].includes(';') ? ';' : ',';
      const naglowek = linie[0].split(delimiter);
      const idxId = naglowek.findIndex(h => /^id$/i.test(h));
      const idxLabel3 = naglowek.findIndex(h => /^custom_label_3$/i.test(h));
      if (idxId === -1 || idxLabel3 === -1) continue; // nowszy format "SKU,..." bez id — pomijamy, log go już pokrył
      for (const l of linie.slice(1)) {
        const w = l.split(delimiter);
        const id = (w[idxId] || '').replace(/^"|"$/g, '').trim();
        if (!id || mapa.has(id)) continue;
        let label3 = (w[idxLabel3] || '').replace(/^"|"$/g, '').trim();
        if (label3 === 'kruchy') label3 = 'kruche';
        mapa.set(id, label3);
        doDobrania++;
      }
    }
  }
  if (doDobrania) console.log('[scal] Dodatkowo dobrano ' + doDobrania + ' id z plików CSV sprzed startu orkiestracji (spoza logu).');

  const naglowek = ['id', 'custom_label_1', 'custom_label_2', 'custom_label_3'];
  const linieWyj = [naglowek.join(',')].concat(
    Array.from(mapa.entries()).map(([id, label]) => [id, '', '', label].map(escCsv).join(','))
  );
  fs.writeFileSync(wyjscie, '﻿' + linieWyj.join('\n'), 'utf8');

  const zLabelka = Array.from(mapa.values()).filter(Boolean).length;
  console.log('[scal] Z logu ' + sciezkaLogu + ': ' + mapa.size + ' unikalnych id.');
  console.log('[scal] Z niepustą kategorią: ' + zLabelka + ', bez kategorii (sucha/niekrucha): ' + (mapa.size - zLabelka) + '.');
  console.log('[scal] Zapisano: ' + wyjscie);
}

main();
