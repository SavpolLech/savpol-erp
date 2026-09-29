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

## Etykiety na esavpol.pl — codzienna aktualizacja (od 2026-09-28)

Te same etykiety zasilają też cross-sell i notki na esavpol.pl (nie tylko GMC): baza powiązań
w repo esavpol-pdp (lokalnie folder `design_system`) ma flagi `m[sku]` = `c`/`m`/`k`, endpoint
`cross-sell-public/v2` zwraca je razem z poleceniami, a tagi GTM (`esavpol-core` 1.11.0+) nie
polecają takich produktów do wysyłki kurierem i pokazują notkę „nie wysyłamy kurierem”.

- **Brak osobnego zadania w harmonogramie.** Scraper tego projektu odpala codziennie o 13:00 job
  esavpol_seo („esavpol - sync feed suplementarny MC”, `esavpol_seo/scripts/mc_sync_supplement.py`):
  `scrape-etykiety-mws.js` (tylko nowe produkty) → `scal-etykiety-mws.js` → `scal-finalny-etykiety.js`.
- Na końcu tego joba (wdrożenie po stronie esavpol_seo, kontrakt:
  `esavpol_seo/KONTRAKT-flagi-mws-esavpol-pdp.md`) → `flagi-mws.csv` →
  `esavpol-pdp-baza-powiazan/tools/pdp-generator/scripts/baza-powiazan/mws-aktualizuj.mjs`:
  podmiana samych flag w bazie, commit na `origin/main` esavpol-pdp tylko przy zmianie (dane, nie deploy).
- Pełna przebudowa list poleceń: ręcznie, `odswiez.mjs --csv=<ten projekt>/wynik/etykiety-finalne.csv`.
- `C:Usersl.dudkiewiczDocumentsclaude_codeesavpol-pdp-baza-powiazan` = osobny, czysty worktree
  esavpol-pdp (sparse) tylko dla automatów.
- Kategorie (`wynik/kategorie-mws.csv`) nadal odświeżane ręcznie — patrz wyżej.

## Stawki VAT dla esavpol.pl (od 2026-09-29)

`scrape-etykiety-mws.js` dopisuje przy każdym produkcie stawkę VAT z tej samej karty ERP (`VATRate`)
do `wynik/vat-erp-mws.csv` (`id;sku;vat;data`). Format CSV etykiet się nie zmienia. `wynik/vat-erp-worek.csv`
to jednorazowa migawka stawek z repliki worek (32 tys. SKU, 2026-09-29). Oba pliki czyta esavpol-pdp
`mws-aktualizuj.mjs`: blok „netto + VAT” na PDP pokazuje się tylko przy zgodności stawki z karty sklepu
i z ERP (esavpol-core 1.13.0). Błąd zapisu stawki trafia tylko do logu i nie przerywa scrapera.
