// Finalne złożenie custom_label_3 według reguły Lecha (2026-09-17):
//   - kategoria (po dziedziczeniu w górę drzewa, jeśli liść ma puste pole)
//     ma storage = chłodnia/mroźnia  → WSZYSTKIE produkty w niej dziedziczą,
//     nadpisuje nawet własne ustawienie produktu.
//   - kategoria = sucha/antresola/brak → liczy się WŁASNA wartość produktu
//     (chłodnia/mroźnia), jeśli produkt ją ma.
//   "kruche" (isGentle) jest niezależne od kategorii — cecha fizyczna
//   produktu, zawsze liczona z danych produktu.
//
// Źródła:
//   1. wynik/etykiety-mws-scalone.csv — komplet (id, custom_label_3) dla
//      wszystkich 6156 zescrapowanych produktów (już scalone z logu +
//      starszych plików CSV przez scal-etykiety-mws.js — obejmuje WIĘCEJ niż
//      sam sesje-log.txt, bo część sesji była odpalana ręcznie, bez zapisu
//      do tego pliku). Etykieta z tego pliku to JUŻ wynik jednego kandydata
//      (kruche/chlodnia/mroznia/puste) — w > 99% przypadków produkt miał co
//      najwyżej JEDNĄ pasującą kategorię, więc to bezstratna rekonstrukcja
//      surowego isGentle/storage. Nieliczne przypadki "KILKA PASUJĄCYCH" były
//      już wcześniej wypisane do ręcznego sprawdzenia (SKU 0007698, 0032655,
//      0032668, 0011076, 0021584, 0005416, 0000589, 0026567, 0022366) — dla
//      nich bierzemy tu tylko TĘ JEDNĄ zapisaną etykietę, nie oba kandydaty.
//   2. feed GMC (product_type) — kategoria per produkt (id).
//   3. wynik/kategorie-mws.csv — typ lokalizacji MWS per kategoria
//      (sparsowany z zapisanej strony ERP, patrz parsuj-kategorie-mws.js).
//
// Uruchomienie: node scal-finalny-etykiety.js [plik-wyjsciowy.csv]

const fs = require('fs');
const path = require('path');
const { pobierzListeGmc } = require('./lib/gmc-feed');

const SCALONE_CSV = path.join(__dirname, 'wynik', 'etykiety-mws-scalone.csv');
const KATEGORIE_CSV = path.join(__dirname, 'wynik', 'kategorie-mws.csv');
const wyjscie = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, 'wynik', 'etykiety-finalne.csv');

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function wczytajLog() {
  const tresc = fs.readFileSync(SCALONE_CSV, 'utf8').replace(/^﻿/, '');
  const linie = tresc.split(/\r?\n/).filter(Boolean).slice(1);
  const mapa = new Map(); // id -> {isGentle, itemStorage}
  for (const l of linie) {
    const [id, , , label] = l.split(',');
    if (!id) continue;
    mapa.set(id, {
      isGentle: label === 'kruche',
      itemStorage: (label === 'chlodnia' || label === 'mroznia') ? label : null
    });
  }
  return mapa;
}

function wczytajKategorie() {
  const tresc = fs.readFileSync(KATEGORIE_CSV, 'utf8').replace(/^﻿/, '');
  const linie = tresc.split(/\r?\n/).filter(Boolean).slice(1);
  const mapa = new Map(); // klucz ścieżki (znormalizowany) -> storageRaw (albo '' gdy brak)
  for (const l of linie) {
    const [pelnaSciezka, , , storageRaw] = l.split(';');
    const klucz = normalizujSciezke(pelnaSciezka);
    mapa.set(klucz, storageRaw || '');
  }
  return mapa;
}

function normalizujSciezke(sciezka) {
  return sciezka.split(/[\\>]/).map(s => s.trim().toLowerCase()).filter(Boolean).join('');
}

// Zwraca typ lokalizacji kategorii PO dziedziczeniu w górę drzewa: jeśli
// liść (pełna ścieżka produktu) nie ma własnego wpisu albo ma pusty, próbuje
// coraz krótszych prefiksów ścieżki, aż znajdzie kategorię z ustawioną
// wartością (albo dojdzie do korzenia).
function efektywnyTypKategorii(sciezkaProduktu, mapaKategorii) {
  const segmenty = sciezkaProduktu.split(/[\\>]/).map(s => s.trim().toLowerCase()).filter(Boolean);
  for (let dlugosc = segmenty.length; dlugosc >= 1; dlugosc--) {
    const klucz = segmenty.slice(0, dlugosc).join('');
    if (mapaKategorii.has(klucz)) {
      const v = mapaKategorii.get(klucz);
      if (v) return v;
      // Ta kategoria istnieje, ale ma PUSTY typ — szukaj dalej w górę.
    }
  }
  return '';
}

function ustalFinalnaEtykiete(itemInfo, storageKategoriiRaw) {
  const kategoriaChlodniowa = /chlodni/i.test(storageKategoriiRaw);
  const kategoriaMrozniowa = /mrozni/i.test(storageKategoriiRaw);

  let storageFinal;
  if (kategoriaChlodniowa) storageFinal = 'chlodnia';
  else if (kategoriaMrozniowa) storageFinal = 'mroznia';
  else storageFinal = itemInfo.itemStorage || ''; // kategoria sucha/antresola/brak → liczy się produkt

  const kandydaci = [];
  if (itemInfo.isGentle) kandydaci.push('kruche');
  if (storageFinal) kandydaci.push(storageFinal);

  if (kandydaci.length === 0) return { label: '', status: 'ok' };
  if (kandydaci.length === 1) return { label: kandydaci[0], status: 'ok' };
  return { label: kandydaci[0], status: 'KILKA (' + kandydaci.join(', ') + ') — sprawdź ręcznie' };
}

async function main() {
  console.log('[scal-finalny] Wczytuję log przebiegów...');
  const logMapa = wczytajLog();
  console.log('[scal-finalny] Log: ' + logMapa.size + ' produktów.');

  console.log('[scal-finalny] Wczytuję kategorie MWS...');
  const kategorieMapa = wczytajKategorie();
  console.log('[scal-finalny] Kategorie: ' + kategorieMapa.size + ' wpisów.');

  console.log('[scal-finalny] Pobieram feed GMC (kategoria per produkt)...');
  const { wpisy } = await pobierzListeGmc();
  const feedMapa = new Map(wpisy.map(w => [w.id, w.productType]));
  console.log('[scal-finalny] Feed: ' + feedMapa.size + ' produktów.');

  const wynikowe = [];
  const doSprawdzenia = [];
  const bezKategoriiWFeedzie = [];

  for (const [id, itemInfo] of logMapa) {
    const sciezkaProduktu = feedMapa.get(id);
    if (!sciezkaProduktu) {
      bezKategoriiWFeedzie.push(id);
      // Bez kategorii nie możemy zastosować reguły dziedziczenia — zostaje
      // czysto to, co wiemy z samego produktu.
      wynikowe.push({ id, label: itemInfo.itemStorage || (itemInfo.isGentle ? 'kruche' : '') });
      continue;
    }
    const storageKategoriiRaw = efektywnyTypKategorii(sciezkaProduktu, kategorieMapa);
    const wynik = ustalFinalnaEtykiete(itemInfo, storageKategoriiRaw);
    wynikowe.push({ id, label: wynik.label });
    if (wynik.status !== 'ok') doSprawdzenia.push({ id, status: wynik.status });
  }

  const naglowek = ['id', 'custom_label_1', 'custom_label_2', 'custom_label_3'];
  const linie = [naglowek.join(',')].concat(
    wynikowe.map(w => [w.id, '', '', w.label].map(escCsv).join(','))
  );
  fs.writeFileSync(wyjscie, '﻿' + linie.join('\n'), 'utf8');

  const zLabelka = wynikowe.filter(w => w.label).length;
  console.log('[scal-finalny] Zapisano ' + wynikowe.length + ' produktów → ' + wyjscie);
  console.log('[scal-finalny] Z niepustą etykietą: ' + zLabelka + ', bez: ' + (wynikowe.length - zLabelka));
  if (bezKategoriiWFeedzie.length) {
    console.log('[scal-finalny] UWAGA: ' + bezKategoriiWFeedzie.length + ' produktów bez kategorii w feedzie (zostały przy własnej wartości): ' + bezKategoriiWFeedzie.slice(0, 10).join(', ') + (bezKategoriiWFeedzie.length > 10 ? '...' : ''));
  }
  if (doSprawdzenia.length) {
    console.log('[scal-finalny] Do ręcznego sprawdzenia (' + doSprawdzenia.length + '):');
    doSprawdzenia.forEach(w => console.log('  id=' + w.id + ': ' + w.status));
  }
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
