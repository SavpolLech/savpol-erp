# Wstępne mapowanie: karta produktu (ERP) → kolumny `csItems`

Robocza notatka z sesji diagnostycznej (2026-09-11), produkt testowy: `0000031`
(Aromat cytrynowy - HOFFMANN 900g). Podstawa: `automatyzacje/produkty/info/kolumny.txt`
(141 kolumn tabeli `csItems`).

## Potwierdzone dopasowania

| Kolumna | Pole w ERP | Zakładka |
|---|---|---|
| `Item` | Indeks | Dane podstawowe |
| `PartNo` | Nr kat. | Dane podstawowe |
| `csVATRatesId` | VAT | Dane podstawowe |
| `csItemsTypesId` | Rodzaj | Dane podstawowe |
| `ItemDesc` | Opis (krótki) | Dane podstawowe |
| `IsInventoryRecords` | radiogroup „Ewidencja stanów...” | Dane podstawowe |
| `isSplitPaymentRequired` | checkbox „wymagany mechanizm podzielonej płatności” | Dane podstawowe |
| `purchaseOnRequestOnly` | checkbox „zakup tylko na zamówienie” | Dane podstawowe |
| `EAN` | EAN | Dane podstawowe |
| `csProductManagerId` | Product manager | Dane podstawowe |
| `csItemsVatClassyficationsG` | Klasyfikacja podatkowa VAT | Dane podstawowe |
| `csPurchaseVATRatesId` | VAT zakupu | Dane podstawowe/dodatkowe |
| `purchaseLastPrice` | Zakupu (cena) | Dane podstawowe/dodatkowe |
| `StockLevelMin` | Ilość (grupa „Stan minimalny (jedn. ewidencyjna)”) | Dane podstawowe/dodatkowe |
| `SEOTitle_PL` (i `_EN`, `_DE`... per język) | Tytuł | SEO |
| `SEODescription_PL` (analogicznie per język) | Opis (długi, marketingowy) | SEO |
| `SEOrobots` | Robots | SEO |
| `SEOCanonical_PL` (analogicznie per język) | Canonical | SEO |
| `KeyWords_PL` (analogicznie per język) | Słowa kluczowe | SEO |
| `ItemDesc_PL` (analogicznie per język) | Nazwa produktu | Opisy |
| `csEBIProducersId` | Producent | Dane dodatkowe (Klasyfikacja) |
| `csEBICategoriesId` | Kategoria | Dane dodatkowe (Klasyfikacja) |
| `csEBIConcessionsId` | Koncesja | Dane dodatkowe (Klasyfikacja) |
| `csEBIBrandsId` | Brand (np. „Hoffman”) | Dane dodatkowe (Klasyfikacja) |
| `csEBIVarietiesId` | Odmiana | Dane dodatkowe (Klasyfikacja) |
| `csSeriesId` | Seria | Dane dodatkowe (Klasyfikacja) |
| `csCountriesG` | Kraj | Dane dodatkowe (Intrastat) |
| `SEZKind` | radiogroup „Usługa / SSE / Poza SSE / TOWARY” | Dane dodatkowe (Specjalna strefa ekonomiczna) |
| `IsForWholesale` | checkbox „Dostępność w hurcie” | Dane dodatkowe (Dostępność) |
| `IsForRetail` | checkbox „Dostępność w detalu” | Dane dodatkowe (Dostępność) |
| `IsForSC01` | checkbox „Dostępność w B2B” | Dane dodatkowe (Dostępność) |
| `isGentle` | checkbox „Produkt delikatny” | Dane dodatkowe (Dostępność) |
| `ItemDescShowKind` | radiogroup „Domyślny / Opis serii i produktu / Opis serii” | Dane dodatkowe (Widoczność opisu produktu) |
| `withNutrition` | radiogroup „Nie dotyczy / Produkt zwolniony.../ Podajemy wartości odżywcze” | Dane dodatkowe (Wartości odżywcze) |
| `itemSearchPriority` | Priorytet wyszukiwania | Dane dodatkowe |
| `csItemsId` | Identyfikator wew. | widok Katalog (lista) |
| `csItemsG` | (brak etykiety — surowa nazwa) | widok Katalog (lista) |
| `csCompaniesId` | (brak etykiety — surowa nazwa) | widok Katalog (lista) |
| `csItemsStatusesValuesId` | Status (wyświetlany jako tłumaczony tekst, ale kolumna to ID) | widok Katalog (lista) |

Cztery powyższe potwierdzone przez panel „wybór kolumn” widoku Katalog
(`diagnostyka/sonda-lista-kolumn.js`) — techniczna nazwa (`data-fieldname`)
widoczna wprost, więc pewność 100%, nie zgadywanie z etykiety. Ten sam
panel potwierdził też ze 100% pewnością wcześniejszą hipotezę
`withNutrition` (kolumna nazywa się tak dosłownie, bez polskiej etykiety
w tym widoku).

Widok Katalog ma do wyboru 50 kolumn, ale większość to dane
obliczone/pochodne z innych tabel (QStock*, CSalesPrice*, ShowPromo*,
SalesType/Factor, LabelReport*, ItemTransition, Rank, SourceId...) —
nie ma ich w liście 141 kolumn `csItems`, więc pomijam.

Zasada dla pól językowych: przełącznik języka (Polski/Angielski/Niemiecki/
Francuski/Niderlandzki/Hiszpański/Portugalski/Ukraiński/Rosyjski/Chorwacki/
Słowacki/Czeski — 12 pozycji) wybiera, którego sufiksu `_XX` dotyczą pola
Tytuł/Opis/Robots/Canonical/Słowa kluczowe/Nazwa produktu. Nie trzeba klikać
każdego języka osobno, żeby to potwierdzić — struktura jest identyczna.

## Ważna poprawka: „Dane dodatkowe” to osobna, realna zakładka

Przez większość sesji błędnie zakładałem (heurystyka wykrywania aktywnej
zakładki po klasie CSS myliła się), że „Dane podstawowe” i „Dane dodatkowe”
renderują się jednocześnie jako jeden ciągły formularz. To nieprawda —
„Dane dodatkowe” trzeba kliknąć osobno jako górny przełącznik, dopiero
wtedy pokazuje swoją zawartość (grupy: Klasyfikacja, Intrastat, Specjalna
strefa ekonomiczna, Dostępność, Kontrola zapasu, Widoczność opisu produktu,
Wartości odżywcze, Priorytet wyszukiwania — patrz tabela wyżej). To właśnie
tu, nie w Grupy, jest jednoznaczne, nazwane wprost źródło `csEBI*Id` — pytanie
o hierarchię grup z poprzedniej wersji tej notatki jest już nieaktualne.

Pole liczbowe „1” obok Seria (błędnie zaetykietowane przez sondę jako
„Brand”) to prawdopodobnie `FirstInSeries` — nie w 100% pewne.

## Niepewne / bez jednoznacznego dopasowania (Dane dodatkowe)

- **Kod PKWiU** (dwa oddzielne pola combobox) — nie widać wprost w liście
  141 kolumn pod tą nazwą; `CPACode` (CPA = odpowiednik PKWiU w UE) to
  możliwy kandydat dla jednego z nich, ale niepotwierdzone.
- **Grupa** („Artykuły spożywcze”) i **Klasa** („Wartości odżywcze”) —
  dropdowny bez oczywistego odpowiednika nazwy kolumny w liście.
- **Symbol PCN** („33021090” — kod taryfy celnej/Intrastat) — brak
  oczywistej kolumny w liście 141.
- **Data ważności ekspozycji** (datepicker, pusty) — brak oczywistego
  dopasowania.
- **Dni do wycofania** — tentatywnie `ShelfLifeDays`, niepotwierdzone.
- radiogroup **„Swobodne korzystanie / Kontrola jakości”** (grupa „Kontrola
  zapasu”) — brak oczywistego dopasowania w liście 141 kolumn.

Te pola warto zapytać Michała wprost, zamiast zgadywać dalej z samych nazw.

## Nie pasuje do listy 141 kolumn — osobne tabele/relacje

Sprawdzone i odrzucone jako out-of-scope dla `csItems`:

- **Zapasy** — stany magazynowe per magazyn (inna tabela, nie master item)
- **Zdjęcia / Załączniki** — pliki binarne, osobne tabele
- **Opisy w B2B** — siatka portal × typ opisu × język (osobna tabela,
  relacja jeden-do-wielu; przykładowe typy: „Przechowywanie po/przed
  otwarciem”, „Skład produktu”, „Nazwa produktu” per portal
  `b2c-savpol.certusoft.pl` / `esavpol.pl`)
- **Jednostki** — osobna tabela jednostek miary (Butelka/karton/Paleta),
  każda z własną wagą/wymiarami/ceną. To też wyjaśnia, skąd Waga/Wysokość/
  Szerokość/Długość/Objętość/Precyzja na Dane podstawowe — to pola WYBRANEJ
  jednostki z tej tabeli, nie kolumny `csItems`. Zawiera też podzakładki
  „kody kreskowe” (`csItemsBarCodes`) i „Ceny walutowe” — też osobne tabele.
- **Referencje** — zewnętrzne identyfikatory produktu w innych systemach
  (tabela `csItemsRefs`, kolumny `csItemsRefsId`/`csItemsRefsTypesG`)
- **Powiązane** — relacja produkt↔produkt, brak pól formularza w widoku
- **Kontrahenci** — siatka „Kontrahent / Producent / Dostawca / B2B / Minimum
  log...” — relacja produkt↔kontrahent z rolami, osobna tabela
- **Do użycia w magazynach** — checkbox-lista magazynów (GDS1/Gdańsk,
  GLS1/Gliwice, GUS1/Grudziądz, KRS1/Kraków, LOS1/Łódź, RZS1/Rzeszów,
  WLS1/Wałbrzych, WAS1/Warszawa) — relacja produkt↔magazyn
- **Limity cen produktów** — brak nowych pól w widoku, prawdopodobnie
  siatka limitów per kontrahent/grupa
- **Stany MWS** — brak nowych pól w widoku, dane WMS per lokalizacja
- **Towary w drodze** — brak nowych pól w widoku (pusta siatka dla tego
  produktu)

Wszystkie zakładki z rzeczywistej listy bocznej tego konta zostały
sprawdzone (sesja z 2026-09-11). „Atrybuty” i „Opisy dod.” pojawiają się w
DOM (wykrywane przez sondę), ale NIE są widoczne na rzeczywistej liście
bocznej tego konta — najpewniej ukryte/wyłączone uprawnieniami (patrz
`diagnostyka/README.md`).

## Wciąż niezidentyfikowane pola na Dane podstawowe/dodatkowe

Kilkanaście pól typu `(bez etykiety)` (checkboxy TAK/nie) na lewym
formularzu — etykieta nie została znaleziona przez sondę (prawdopodobnie
inny wzorzec DOM niż `label.Label`). Do zbadania osobno, jeśli okaże się
istotne — obecnie nie wiadomo, których kolumn dotyczą.

## Nierozstrzygnięte pytania do Michała

1. Co to za kolumny (jeśli w ogóle są w `csItems`): Kod PKWiU (x2), Grupa,
   Klasa, Symbol PCN, Data ważności ekspozycji, radiogroup „Swobodne
   korzystanie / Kontrola jakości”? Żadna nie ma oczywistego odpowiednika
   nazwy w liście 141 kolumn.
2. Czy dane z osobnych tabel (Zapasy, Opisy w B2B, Jednostki, Referencje,
   Grupy, Kontrahenci, Do użycia w magazynach) w ogóle wchodzą w zakres
   tego zadania, czy interesuje go wyłącznie `csItems`?
3. `FirstInSeries` — czy to na pewno pole liczbowe obok Seria na Dane
   dodatkowe? Do potwierdzenia.
