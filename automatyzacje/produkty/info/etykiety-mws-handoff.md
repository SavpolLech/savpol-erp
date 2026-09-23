# Etykiety MWS (chłodnia / mroźnia / kruche) — handoff

Cel: uzupełnić `custom_label_3` w suplementarnym feedzie GMC (obok już
istniejących `custom_label_1`/`custom_label_2`) wartością `chlodnia`,
`mroznia`, `kruche` albo pustą (produkt suchy i niekruchy) — jedna wartość
na produkt.

Feed GMC (źródło listy produktów i EAN/nazwy/marki, patrz niżej):
`https://esavpol.pl/download4External/GoogleFeedFiles/NG_GoogleMerchantCenterFeedFile_213217693_1234896834.xml`

## Skąd biorą się wartości

Dwa NIEZALEŻNE atrybuty w ERP, oba na karcie produktu (API `csitems`,
zwracane przez `automatyzacje/produkty/scrape.js`):

- **`isGentle`** — checkbox „Produkt delikatny" (Dane dodatkowe) → `kruche`.
  Zawsze liczony z samego produktu, **nigdy nie dziedziczy się po kategorii**.
- **`StorageLocationType`** — pole „Typ lokalizacji MWS" (zakładka „Atrybuty
  MWS", niedostępna w UI dla roli Lecha, ale API zwraca ją niezależnie od tego
  uprawnienia). Wartość jak `Chlodnia-pozostale`, `Mroznia`, `Suche`,
  `Antresola` itd. → dopasowanie regexem `/chlodni/i` / `/mrozni/i` na polu
  BEZ polskich znaków (nie na `StorageLocationTypeDesc_PL`, które ma „ł"/„ź" i
  nie złapie się prostym regexem — to był realny bug po drodze).

**Pułapka, którą już złapaliśmy:** pole produktu bywa PUSTE, mimo że produkt
faktycznie wymaga chłodzenia — bo **dziedziczy typ lokalizacji po kategorii**,
gdy własne pole nie jest ustawione. Sprawdzone na żywo w ERP (Grupowania
produktów → edycja kategorii → zakładka „Atrybuty MWS"): pole produktu puste,
a „Efektywne atrybuty MWS" pokazuje wartość odziedziczoną z kategorii.
Dlatego liczy się **dwa źródła równolegle**, nie tylko kartę produktu.

## Reguła łączenia (ustalona z Lechem, 2026-09-17)

1. Jeśli **kategoria** (po odziedziczeniu w górę drzewa, gdy liść ma puste
   pole) ma typ `chlodnia`/`mroznia` → **wszystkie produkty w niej
   dziedziczą tę wartość**, nadpisując nawet własne ustawienie produktu.
2. Jeśli kategoria jest `sucha`/`antresola`/bez wartości → liczy się
   **własna wartość produktu** (chłodnia/mroźnia), jeśli produkt ją ma.
3. `kruche` jest **zawsze niezależne** od powyższego — liczone tylko z
   `isGentle` produktu.
4. Gdy po zastosowaniu 1–3 wychodzą **dwa kandydaci naraz** (np. produkt
   kruchy w kategorii chłodniowej) — nie zgadujemy po cichu, pozycja trafia
   do listy „do ręcznego sprawdzenia" (patrz log przy uruchomieniu).

## Pliki i ich rola

| Plik | Rola |
|---|---|
| `lib/gmc-feed.js` | Pobiera i parsuje feed GMC → `{id, ean, title, productType, availability}` per produkt. `id` = `csItemsId` (to samo co GMC id / adres esavpol.pl), NIE SKU. |
| `scrape-etykiety-mws.js` | Główny scraper. Loguje się do ERP RAZ, potem dla każdego produktu z feedu (poza tymi z suplementarnego feedu, patrz `--suplementarny`) szuka go w katalogu PO EAN (bo feed nie ma SKU), czyta `isGentle`+`StorageLocationType` z karty, zapisuje wiersz **od razu** (nie na końcu sesji) do `wynik/etykiety-mws/etykiety-run-NNN.csv` i do stanu. Uruchomienie: `node scrape-etykiety-mws.js [ile] [--minuty=N] [--suplementarny="ścieżka"]`. |
| `state/etykiety-mws.json` | `processedIds`/`notFoundIds` — co już zrobione, żeby kolejne uruchomienie nie powtarzało tych samych produktów. Numeracja plików `etykiety-run-NNN.csv` trzyma się tu, nie liczy z listingu folderu. |
| `sesje-etykiety-mws.sh` | Orkiestracja: kolejne sesje po losowe 10–15 min z przerwami 1–2 min, aż do zadanego budżetu czasu (`./sesje-etykiety-mws.sh <minuty>`). |
| `sesje-log.txt` | Log konsoli ze WSZYSTKICH sesji — **jedyne pełne źródło** linii `[produkt] id=X SKU=Y → custom_label_3="..." (status)`. Ma i `id`, i `SKU` dla każdego zescrapowanego produktu. |
| `parsuj-kategorie-mws.js` | Parsuje zapisaną stronę „Grupowania produktów" (`Ctrl+S` → zapisz jako HTML z ERP, pełne drzewo rozwinięte) → `wynik/kategorie-mws.csv` (pełna ścieżka kategorii + jej `StorageLocationType`). |
| `scal-etykiety-mws.js` | Scala WSZYSTKIE `etykiety-run-*.csv` (różne formaty historyczne) + `sesje-log.txt` w jeden `wynik/etykiety-mws-scalone.csv` (id + etykieta z samego produktu, BEZ dziedziczenia po kategorii). |
| `scal-finalny-etykiety.js` | **To jest plik do wgrania.** Łączy `etykiety-mws-scalone.csv` (produkt) + świeży feed GMC (kategoria per produkt) + `kategorie-mws.csv` (typ per kategoria) wg reguły wyżej → `wynik/etykiety-finalne.csv` (`id,custom_label_1,custom_label_2,custom_label_3`, custom_label_1/2 zawsze puste). |

Wszystko w `wynik/` jest gitignorowane (dane produktowe, nie do repo) — pliki
trzymają się tylko lokalnie na dysku Lecha.

## Jak wznowić / zescrapować nowe produkty od zera

```bash
cd automatyzacje/produkty
# jedna sesja, np. 9 minut (bezpieczny margines pod limit 10 min narzędzia):
node scrape-etykiety-mws.js 100000 --minuty=9

# albo dłuższy, samosterujący przebieg (np. 100 minut):
./sesje-etykiety-mws.sh 100
```

Stan (`state/etykiety-mws.json`) sam pilnuje, żeby nie robić tego samego
produktu dwa razy — kolejne uruchomienie automatycznie leci dalej po liście.

Po zebraniu nowych danych, żeby dostać finalny plik z uwzględnieniem
kategorii:

```bash
node scal-etykiety-mws.js        # odśwież etykiety-mws-scalone.csv
node scal-finalny-etykiety.js    # zbuduj etykiety-finalne.csv
```

## Jak odświeżyć dane kategorii (rzadko, tylko gdy ktoś zmienia strukturę grup)

Kategorie NIE są scrapowane automatycznie (próby przez API/DOM zawiodły —
dane idą przez socket.io, nie zwykłe zapytania POST, a struktura drzewa w UI
jest nietypowa). Ręczny proces:

1. W ERP: „Grupowania produktów" → rozwinąć całe drzewo B2B (wszystkie
   poziomy) → zapisać stronę jako HTML (Ctrl+S, „Strona sieci Web, cały
   plik" albo podobne w przeglądarce).
2. `node parsuj-kategorie-mws.js "C:\...\zapisana-strona.html"` →
   `wynik/kategorie-mws.csv`.

## Dociągnięcie SKU / EAN / brand / nazwy (do wgrania osobno, 2026-09-23)

`etykiety-finalne.csv` ma tylko `id` (GMC), nie SKU. Do zbudowania pliku
`id,SKU,EAN,brand,nazwa`:

- **SKU per id** — już mamy, w `sesje-log.txt` (linie `id=X SKU=Y`), bez
  potrzeby pytania ERP drugi raz.
- **EAN, nazwa, brand** — **nie trzeba pytać ERP wcale**, feed GMC ma to
  wprost: `<g:mpn>` (EAN), `<g:title>` (nazwa), `<g:brand>` (marka).
  `lib/gmc-feed.js` na razie **nie wyciąga `brand`** (trzeba dopisać jedną
  linię w `sparsujFeed` analogiczną do `title`/`productType`).

## Znane ograniczenia / do ręcznego sprawdzenia

- Kilkanaście SKU miało niejednoznaczne dopasowanie EAN (wyszukiwarka ERP
  zwróciła kilka kartotek pod tym samym kodem) albo dwóch kandydatów naraz
  (kruche + chłodnia/mroźnia) — wypisane w logu każdego uruchomienia jako
  „UWAGA — do ręcznego sprawdzenia".
- ~111 produktów z feedu nie miało dopasowanej kategorii przy ostatnim
  scaleniu (feed mógł się zmienić między pobraniami) — dla nich
  `scal-finalny-etykiety.js` zostawia samą wartość produktu, bez
  dziedziczenia po kategorii.
