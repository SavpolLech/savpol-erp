// Parsuje zapisaną stronę "Grupowania produktów" (kategorie.html, zrzut z
// przeglądarki Lecha) i wyciąga pełną ścieżkę kategorii + jej "Typ lokalizacji
// MWS" (StorageLocationType / StorageLocationTypeDesc_PL) — dokładnie te same
// nazwy pól co w API karty produktu, więc wiemy, że to ten sam atrybut.
//
// Struktura DOM: każdy wiersz to <li class="row level-N ...">, którego
// bezpośrednie dzieci to <span data-datafield="X">wartość</span> (WSZYSTKIE
// pola, także ukryte kolumny — stąd łapiemy StorageLocationType nawet jeśli
// nie jest wyświetlana). Zagnieżdżenie <li> odzwierciedla hierarchię kategorii
// (poziom w klasie "level-N"), więc pełną ścieżkę budujemy stosem: przy nowym
// wierszu na poziomie N zdejmujemy ze stosu wszystko >= N, dokładamy siebie.
//
// Uruchomienie: node parsuj-kategorie-mws.js [sciezka-do-html]

const fs = require('fs');
const path = require('path');

const wejscie = process.argv[2] || path.join(require('os').homedir(), 'Downloads', 'kategorie.html');
const wyjscie = path.join(__dirname, 'wynik', 'kategorie-mws.csv');

function escCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function main() {
  const html = fs.readFileSync(wejscie, 'utf8');

  // Token = albo otwarcie <li class="row level-N ...">, albo jedno pole
  // <span ... data-datafield="X" ...>wartość</span>. Idziemy w kolejności
  // dokumentu (lastIndex regexu), więc pola między jednym <li> a następnym
  // należą do TEGO pierwszego wiersza (dzieci renderują się w zagnieżdżonym
  // <ul>, czyli już PO polach rodzica).
  const wzorzecLi = /<li class="row level-(\d+)[^"]*">/g;
  const wzorzecPole = /<span class="value[^"]*" data-datafield="([^"]+)"[^>]*>([^<]*)<\/span>/g;

  const znaczniki = [];
  let m;
  while ((m = wzorzecLi.exec(html))) znaczniki.push({ typ: 'li', poz: m.index, poziom: parseInt(m[1], 10) });
  while ((m = wzorzecPole.exec(html))) znaczniki.push({ typ: 'pole', poz: m.index, nazwa: m[1], wartosc: m[2] });
  znaczniki.sort((a, b) => a.poz - b.poz);

  const wiersze = []; // { poziom, nazwa, storageRaw, storagePl, catPath }
  const stos = []; // {poziom, nazwa} — do budowy pełnej ścieżki

  let biezacy = null;
  for (const t of znaczniki) {
    if (t.typ === 'li') {
      if (biezacy) wiersze.push(biezacy);
      biezacy = { poziom: t.poziom, nazwa: null, storageRaw: null, storagePl: null, catPath: null };
      while (stos.length && stos[stos.length - 1].poziom >= t.poziom) stos.pop();
      // nazwa dojdzie do stosu po odczytaniu pola ItemsGroupTranslatedDesc (niżej)
      stos.push({ poziom: t.poziom, nazwa: null, ref: biezacy });
    } else if (biezacy) {
      if (t.nazwa === 'ItemsGroupTranslatedDesc' && biezacy.nazwa === null) {
        biezacy.nazwa = t.wartosc;
        const naStosie = stos[stos.length - 1];
        if (naStosie && naStosie.ref === biezacy) naStosie.nazwa = t.wartosc;
      } else if (t.nazwa === 'StorageLocationType') {
        biezacy.storageRaw = t.wartosc || null;
      } else if (t.nazwa === 'StorageLocationTypeDesc_PL') {
        biezacy.storagePl = t.wartosc || null;
      } else if (t.nazwa === 'CatPath') {
        biezacy.catPath = t.wartosc || null;
      }
      if (t.nazwa === 'ItemsGroupTranslatedDesc') {
        // Pełna ścieżka = wszystko na stosie AŻ DO i włącznie z tym wierszem.
        biezacy.pelnaSciezka = stos.map(s => s.nazwa).join('\\');
      }
    }
  }
  if (biezacy) wiersze.push(biezacy);

  console.log('[parsuj] Znaleziono ' + wiersze.length + ' wierszy (kategorii) w pliku.');

  const naglowek = ['pelna_sciezka', 'nazwa', 'typ_lokalizacji_mws_pl', 'typ_lokalizacji_mws_raw'];
  const linie = [naglowek.join(';')].concat(
    wiersze
      .filter(w => w.nazwa) // pomiń puste/techniczne wiersze bez nazwy
      .map(w => [w.pelnaSciezka || w.nazwa, w.nazwa, w.storagePl || '', w.storageRaw || ''].map(escCsv).join(';'))
  );

  if (!fs.existsSync(path.join(__dirname, 'wynik'))) fs.mkdirSync(path.join(__dirname, 'wynik'));
  fs.writeFileSync(wyjscie, '﻿' + linie.join('\n'), 'utf8');

  const zTypem = wiersze.filter(w => w.storagePl).length;
  console.log('[parsuj] Kategorii z ustawionym typem lokalizacji MWS: ' + zTypem + '/' + wiersze.filter(w => w.nazwa).length);
  console.log('[parsuj] Zapisano: ' + wyjscie);

  // Podgląd kilku przykładów z ustawionym typem — do szybkiej weryfikacji.
  wiersze.filter(w => w.storagePl).slice(0, 15).forEach(w => {
    console.log('  ' + (w.pelnaSciezka || w.nazwa) + '  →  ' + w.storagePl + ' (' + w.storageRaw + ')');
  });
}

main();
