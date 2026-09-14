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

## Poprawka: nie każde pole językowe wspiera wszystkie języki

Błędnie założyłem wcześniej, że przełącznik języka (Polski/Angielski/
Niemiecki/Francuski/Niderlandzki/Hiszpański/Portugalski/Ukraiński/Rosyjski/
Chorwacki/Słowacki/Czeski — 12 pozycji w UI) działa identycznie dla
wszystkich pól. Po dokładnym przejrzeniu `kolumny.txt` to nieprawda —
zależy od rodziny kolumn:

| Rodzina pól | Języki faktycznie istniejące w `csItems` |
|---|---|
| `ItemDesc_XX` / `ItemDesc1_XX` / `KeyWords_XX` | pełne ~13: PL, EN, DE, FR, NL, ES, PT, RU, UK, IT, SK, HR, CZ |
| `SEOTitle_XX` | tylko **PL, EN, HR** (kolumny w `kolumny.txt`) |
| `SEODescription_XX` | tylko **PL, EN, HR** (kolumny w `kolumny.txt`) |
| `SEOCanonical_XX` | tylko **PL, EN, HR** (kolumny w `kolumny.txt`) |
| `SEOrobots` | **brak sufiksu językowego** — jedno wspólne pole dla całego produktu |

**Korekta 2026-09-14 (ręczna weryfikacja w ERP przez Lecha, po zakładkach
językowych SEO):** powyższa tabela mówi, jakie kolumny *istnieją w bazie*
(`kolumny.txt`), ale to nie to samo, co to, co UI *wyświetla* w polach dla
każdego języka. Realny widok w karcie produktu, zakładka po zakładce:

| Język | Widoczne pola |
|---|---|
| PL | robots, canonical, tytuł, synonimy klas ETIM, słowa kluczowe, opis |
| EN | robots, canonical, tytuł, słowa kluczowe, opis |
| DE | robots, tytuł, słowa kluczowe, opis |
| FR, NL, ES, PT, UK, RU | robots, tytuł, słowa kluczowe |
| HR | robots, canonical, tytuł, słowa kluczowe |

Czyli UI pokazuje pole „Tytuł” i „Robots” dla dużo szerszej listy języków
(DE/FR/NL/ES/PT/UK/RU), niż to, co `kolumny.txt` ma jako `SEOTitle_XX`
(tylko PL/EN/HR). Dwa możliwe wyjaśnienia, nierozstrzygnięte:
- pole „Tytuł” w tych zakładkach zapisuje się do innej kolumny niż
  `SEOTitle_XX` (np. współdzieli `ItemDesc_XX`), albo
- `kolumny.txt` faktycznie nie ma wszystkich kolumn `csItems` (patrz punkt
  1 w pytaniach do Michała niżej — 141 vs 314 pól) i brakujące
  `SEOTitle_DE`/`_FR`/... po prostu nie trafiły na tę listę.

Nie zgadujemy dalej — to kolejny punkt do Michała. **Ważna uwaga
praktyczna od Lecha:** strona nigdy nie była tłumaczona na inne języki niż
polski, więc niezależnie od tego, które kolumny istnieją, w 99% przypadków
będą one po prostu puste dla EN/DE/HR/itd. — dla scrapera nie warto
inwestować dużo czasu w te pola, dopóki Michał nie potwierdzi, że są
faktycznie używane.

Osobna obserwacja: `ItemDesc_IT`/`KeyWords_IT` istnieją w liście kolumn, ale
zakładka „Włoski” nigdy nie pojawiła się w żadnym zrzucie — może jest
schowana/wymaga przewinięcia listy języków, nie sprawdzone.

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

**Uwaga (2026-09-14):** poniższe to pola widoczne na karcie produktu,
które ja (Claude) zauważyłem podczas własnej eksploracji UI i nie umiałem
dopasować do żadnej kolumny z listy 141 — **nie pochodzą z maila Michała**,
on o nie nie prosił. Zostawiam je tu jako notatkę techniczną, ale zgodnie
z ustaleniem, że zakres ograniczamy do tego, co Michał faktycznie wskazał,
**nie wysyłamy ich Michałowi jako pytań**.

- **Kod PKWiU** (dwa oddzielne pola combobox) — nie widać wprost w liście
  141 kolumn pod tą nazwą; `CPACode` (CPA = odpowiednik PKWiU w UE) to
  możliwy kandydat dla jednego z nich, ale niepotwierdzone.
- **Grupa** („Artykuły spożywcze”) i **Klasa** („Wartości odżywcze”) —
  dropdowny w „Dane dodatkowe”, bez oczywistego odpowiednika nazwy kolumny
  w liście 141. **Uwaga: to NIE to samo, co „Grupa produktu” z katalogu**
  (ścieżka typu `B2B\Kategorie\...`) — patrz sekcja niżej, to zupełnie inne
  pole.
- **Symbol PCN** („33021090” — kod taryfy celnej/Intrastat) — brak
  oczywistej kolumny w liście 141.
- **Data ważności ekspozycji** (datepicker, pusty) — brak oczywistego
  dopasowania.
- **Dni do wycofania** — tentatywnie `ShelfLifeDays`, niepotwierdzone.
- radiogroup **„Swobodne korzystanie / Kontrola jakości”** (grupa „Kontrola
  zapasu”) — brak oczywistego dopasowania w liście 141 kolumn.

## Grupa produktu (kolumna „GRUPA PRODUKTU” w katalogu, ścieżka B2B\Kategorie\...)

To jest osobne pole od „Grupa”/„Klasa” wyżej — pytanie Lecha 2026-09-14 po
zrzucie ekranu z katalogu. **Już to mieliśmy namierzone wcześniej, przy
pracy nad `savpol-historia-faktur.user.js`:** techniczna nazwa pola to
`ItemsGroupTranslatedDesc` (patrz `savpol-historia-faktur.user.js:537` —
kolumna „Grupa produktu” w konfiguracji `DATA_FIELDS` siatki katalogu).

To pole **nie pojawiło się w 314-polowej odpowiedzi karty produktu**
(`csItemsOneBro`) — bo karta go po prostu nie pokazuje, to kolumna
specyficzna dla siatki katalogu (`csItems`, `DictIdent: csItems`, inny
request niż karta). Prawdopodobny surowy odpowiednik ID: `csMasterItemsGroupsId`
— to jedyne pole z rodziny „group” złapane w 50 kolumnach katalogu
(`sonda-lista-kolumn.js`), wcześniej błędnie ocenione jako „niskopriorytetowe”.
Wzorzec ID+Desc, który już wielokrotnie potwierdziliśmy, sugeruje że to
faktycznie para: `csMasterItemsGroupsId` (surowy FK) ↔ `ItemsGroupTranslatedDesc`
(gotowy tekst ścieżki do wyświetlenia). Nie jest to jednak jeszcze
zweryfikowane 1:1 (nie sprawdziliśmy tego samego produktu w obu miejscach
naraz) — i tej kolumny w ogóle nie ma w liście 141 od Michała, więc na razie
to tylko techniczna odpowiedź dla Ciebie, nie coś do zgłoszenia Michałowi.

## Realny wiersz z bazy dla SKU 0031513 (od Michała, 2026-09-14)

Michał dosłał xlsx z prawdziwym wierszem `csItems` (SELECT z produkcyjnej
bazy) dla `Item = 0031513` ("Delipasta Buono! VY4 4kg - FABBRI"). To
pierwszy przypadek, gdzie widzimy realne wartości wszystkich 141 kolumn
naraz — rozstrzyga część otwartych pytań z listy 36 niedopasowanych pól:

- **`Photo`/`PhotoSmall`/`PhotoVersion`/`PhotoSmallVersion` = NULL, ale
  `IsPhoto=1`, `IsPhotoPrev=1`.** To **potwierdza** (nie tylko hipotezę z
  API) wcześniejsze ustalenie: te kolumny w `csItems` są martwe/nieużywane
  jako źródło obrazka — `IsPhoto`/`IsPhotoPrev` to tylko flagi "produkt ma
  zdjęcie (w tabeli `csPhotos`)". Scraper powinien po obrazek iść do
  `csPhotos`, nie do tych kolumn `csItems`.
- **`KeyWords_DE/ES/FR/NL/PT/RU/UK/IT/SK/CZ`** — wszystkie NULL. Potwierdza
  przypuszczenie: strona nigdy nie była tłumaczona, te kolumny są po
  prostu puste, nie brakuje ich w naszym zapytaniu testowym.
- **`KeyWordsAuto`** i **`KeyWordsAuto_DE/ES/FR/IT/NL/PL/PT/RU/UK`** —
  wszystkie wypełnione, ten sam auto-generowany string (firma+SKU+EAN+nazwa
  produktu, sanityzowane znaki). To pole systemowe pod wyszukiwanie
  full-text, nie do ręcznej edycji przez użytkownika.
- **`KeyWordsAuto_EN`** — też wypełnione, ale **inną, bogatszą treścią**
  (dodatkowo kod producenta i pełna nazwa producenta "Fabbri 1905
  S.p.A."). EN ma inny algorytm generowania niż pozostałe języki — niski
  priorytet, ale warto wiedzieć.
- **`DefSort`** = `967128` — aktywnie używane pole sortowania.
- **`LastChangeDate`** / **`createdDate`** — wypełnione, standardowe pola
  audytowe, działają jak oczekiwano.
- **`isEOL`** = NULL — kolumna istnieje, ale nieużyta dla tego (aktywnego)
  produktu — sensowne, prawdopodobnie ustawiana tylko dla wycofanych.
- **`csUNSPSCCommodityId`** = NULL — nieużywane dla tego produktu.
- **`csProducersIdAgr`** = `218472565` (WYPEŁNIONE!) — ale to **nie jest
  ten sam FK co `csEBIProducersId`** (który dla tego produktu jest NULL).
  Osobny, realny klucz do czegoś innego niż główny słownik producentów —
  `NameA1Agr`/`NameL1Agr` mimo to są NULL. Nierozpoznane, warto zapytać
  Michała czym jest ta rodzina "Agr", jeśli okaże się istotna.
- **`purchaseLastPrice`** = NULL — legalnie puste dla tego produktu, nie
  potwierdza ani nie zaprzecza teorii, że to alias/duplikat
  `CPurchasePrice` (które w ogóle jest w innej tabeli, `csItemsUnits`, nie
  w `csItems`).

## Photo / PhotoSmall — namierzone (2026-09-14)

W wiadomości do Michała napisaliśmy, że `Photo`/`PhotoSmall`/`PhotoVersion`
nie udało się namierzyć — to już nieaktualne, znaleźliśmy działający
mechanizm:

**Bonus-odkrycie:** baza `worek` (automatyzacje/wz — replika ERP budowana
pod migrację do Odoo) ma tabelę `dbo.csItems` z dokładnie tymi samymi 141
kolumnami co lista Michała (`kolumny.txt`), 1:1, bez różnic w obie strony —
włącznie z `Photo`/`PhotoSmall` (varbinary — surowe bajty obrazka wprost w
wierszu) i `PhotoVersion`/`PhotoSmallVersion` (int — licznik, ten sam co
`|1` na końcu URL-a z API ERP). Jest tam też osobna tabela `dbo.csPhotos`
(pełna galeria, z watermarkami). **Ale obie tabele mają 0 wierszy** — to
tylko struktura, dane produkcyjne jeszcze nie są zsynchronizowane, więc
nie da się tu jeszcze sprawdzić, czy `Photo`/`PhotoSmall` są realnie
wypełnione w produkcji. Jeśli/kiedy `worek` się napełni, SQL wprost do tej
bazy może okazać się dużo prostszą drogą do całego mapowania Michała niż
odpytywanie ERP-owego API — zero zgadywania nazw pól, zero
base64+zip+deflate. Diagnostyczne skrypty jednorazowe:
`automatyzacje/wz/sprawdz-tabele-foto.js`, `sprawdz-csitems.js`,
`sprawdz-zdjecia-wypelnienie.js`.

1. Zdjęcie NIE jest w danych karty produktu (`csItemsOneBro`/`csitems`) —
   pola `PhotoUrl`/`PhotoSmallUrl` tam są zawsze `null`. Trzeba pobrać
   dane z zakładki **Zdjęcia** (`DataSetSQLIdent: csphotos`), która ma
   własny rekord ze wszystkimi metadanymi zdjęcia (46 pól, m.in.
   `LocalFileName`, `RemoteFileName`, `RemoteIdent`, `PhotoUrl`,
   `PhotoUrlMed`, `PhotoUrlSmall`).
2. Pole `PhotoUrl` w tym rekordzie NIE jest gotowym linkiem — to
   wewnętrzny identyfikator w formacie `tabela|pole|GUID|wersja`, np.
   `csPhotos|Photo|A4064574-9CCE-4850-19A3-E1CBA59E9B7C|1`.
3. Potwierdzony (podsłuchany z Network w DevTools, status 200) wzorzec
   prawdziwego URL do pobrania pliku:

   ```
   https://erp.savpol.pl/api/Download/<PhotoUrl z "|" zamienionym na "_">.png
   ```

   Przykład: `https://erp.savpol.pl/api/Download/csPhotos_Photo_A4064574-9CCE-4850-19A3-E1CBA59E9B7C_1.png`

   Rozszerzenie jest zawsze `.png`, niezależnie od oryginalnego
   `LocalFileName`/`RemoteFileName` (które kończyły się na `.jpg`) — endpoint
   serwuje/konwertuje zawsze do PNG.
4. To endpoint pod `/api/...` na `erp.savpol.pl` — wymaga tej samej
   zalogowanej sesji ERP co resztą danych (nie jest publiczny/anonimowy).
   Scraper będzie musiał pobierać zdjęcia w tej samej sesji (ciasteczko/token),
   nie osobnym anonimowym requestem.

Nie sprawdzone: czy `PhotoUrlMed`/`PhotoUrlSmall` (analogiczne pola, wersje
mniejsze) używają tego samego wzorca URL (prawdopodobnie tak, po prostu z
`Photo` zamienionym na `PhotoMed`/`PhotoSmall` w środku identyfikatora) —
do potwierdzenia przy pierwszej realnej implementacji scrapera.

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

## PRZEŁOM (2026-09-14): prawdziwe nazwy pól wprost z kodu aplikacji

Znaleźliśmy sposób, żeby ominąć zgadywanie z etykiet całkowicie. Karta
produktu (`DictIdent: csItemsOneBro`) jest budowana z jednego dużego
requestu API, który zwraca m.in. `VisualDefinition` — surowy szablon HTML
CAŁEJ karty, ze wszystkimi atrybutami `data-datafield="..."`. To jest
źródło prawdy — nazwa techniczna wprost z kodu, nie zgadywana z etykiety.

Jak to zdobyliśmy: `diagnostyka/podsluch-danych-produktu.js` (wersja
2026-09-11.6) podsłuchuje `fetch`/`XMLHttpRequest`, a odpowiedzi tej
aplikacji są spakowane jako base64(ZIP+deflate) w polu `JSONResult` —
skrypt dekoduje to bezpośrednio w przeglądarce (`DecompressionStream`,
zero ręcznego przepisywania danych binarnych, co wcześniej się nie udawało).

### WAŻNE ZASTRZEŻENIE — nazwy pól w karcie ≠ nazwy kolumn w `kolumny.txt`

Karta korzysta z `data-datasetsqlident="csItems"`, ale sporo pól ma
**inne nazwy niż w liście 141 kolumn** — np. `ProducerDesc` zamiast
`csEBIProducersId`, `CPurchasePrice` zamiast `purchaseLastPrice`,
`purchaseVATRate` zamiast `csPurchaseVATRatesId`. To wygląda na
widok/zapytanie z przemianowanymi/rozwiniętymi polami nad prawdziwą
tabelą `csItems`, nie bezpośredni dostęp do surowych kolumn. **To kluczowe
pytanie do Michała** — patrz sekcja pytań niżej.

### Potwierdzone 1:1 (dokładnie ta sama nazwa co w `kolumny.txt`)

| Kolumna | Pole w ERP (etykieta) | Sekcja |
|---|---|---|
| `IsInventoryRecords` | Ewidencja stanów... (4 opcje: 0/1/2/3) | Dane podstawowe |
| `BMM` | radiogroup bez widocznej etykiety (3 opcje) | Dane podstawowe |
| `canSetSalePrice` | Użytkownik może zmieniać cenę sprzedaży | Dane podstawowe |
| `IsExp` | Wyeksportowana | Dane podstawowe |
| `isSplitPaymentRequired` | Wymagany mechanizm podzielonej płatności | Dane podstawowe |
| `purchaseOnRequestOnly` | Zakup tylko na zamówienie | Dane podstawowe |
| `StockLevelMin` | Ilość (Stan minimalny) | Dane podstawowe |
| `FirstInSeries` | pole liczbowe obok Seria | Dane dodatkowe — **potwierdzone, nie tentatywne** |
| `CPACode` | Kod PKWiU (jeden z dwóch) | Dane dodatkowe |
| `SEZKind` | radiogroup Usługa/SSE/Poza SSE/TOWARY | Dane dodatkowe |
| `IsForWholesale` | Dostępność w hurcie | Dane dodatkowe |
| `IsForRetail` | Dostępność w detalu | Dane dodatkowe |
| `IsForSC01` | Dostępność w B2B | Dane dodatkowe |
| `isGentle` | Produkt delikatny | Dane dodatkowe |
| `SMM` | radiogroup bez widocznej etykiety (2 opcje) | Dane dodatkowe |
| `ItemDescShowKind` | Widoczność opisu produktu | Dane dodatkowe |
| `withNutrition` | Wartości odżywcze | Dane dodatkowe |
| `itemSearchPriority` | Priorytet wyszukiwania | Dane dodatkowe |
| `CeneoItemDesc` | pole w zakładce „Opisy dod.” (ukryta uprawnieniami, ale pole istnieje w szablonie) | Opisy dod. |
| `ItemDesc1`, `ItemDesc2`, `ItemDesc3`, `ItemDesc4` | dodatkowe pola opisu (bez sufiksu języka) | Opisy dod. |

„Kod PKWiU” (drugie pole) to `PCGS` w szablonie (kolumna `csPCGSG` w
`kolumny.txt` to prawdopodobnie GUID-owy klucz do słownika PCGS, a samo
`PCGS`/`PCGSTranslatedDesc` to pola tekstowe wyświetlane na karcie —
prawdopodobnie odpowiadają `csPCGSG` pośrednio przez wybór ze słownika).

„Data ważności ekspozycji” → `validTo` (pole readonly, obliczane — stąd
nie ma go wprost w liście 141 kolumn jako edytowalnej kolumny).
„Dni do wycofania” → `expireDays` (też readonly/obliczane).

### Nazwy inne niż w `kolumny.txt` (prawdopodobnie widok z aliasami)

| Pole w karcie (`data-datafield`) | Etykieta | Najbliższa kolumna z listy |
|---|---|---|
| `ProducerDesc` | Producent | `csEBIProducersId`? |
| `CategoryDesc` | Kategoria | `csEBICategoriesId`? |
| `ConcessionDesc` | Koncesja | `csEBIConcessionsId`? |
| `BrandDesc` | Brand | `csEBIBrandsId`? |
| `VarietyDesc` | Odmiana | `csEBIVarietiesId`? |
| `Series` | Seria | `csSeriesId`? |
| `CPurchasePrice` | Zakupu (cena) | `purchaseLastPrice`? |
| `purchaseVATRate` | VAT zakupu | `csPurchaseVATRatesId`? |
| `ItemClassyfication` | Klasyfikacja podatkowa VAT | `csItemsVatClassyficationsG`? |
| `CountryTranslatedDesc` | Kraj | `csCountriesG`? |
| `EANType` | Typ kodu kreskowego | brak w liście 141 |
| `isFractionalQuantity` | Czy ilość ułamkowa | brak w liście 141 |
| `groupsInfo01XML`…`groupsInfo04XML` | (mechanizm edycji „Grupy” — 4 maski grup, multi-select, XML) | brak w liście 141 — to jednak NIE jest bezpośrednio `csEBI*Id`, tylko osobny mechanizm |
| `CRecyclingFee` | KGO | brak w liście 141 pod tą nazwą |

**Wcześniejsze „pewne” dopasowania `csEBIProducersId`/`csEBICategoriesId`/
`csEBIConcessionsId`/`csEBIBrandsId`/`csEBIVarietiesId`/`csSeriesId`/
`csPurchaseVATRatesId`/`purchaseLastPrice`/`csItemsVatClassyficationsG`/
`csCountriesG` z wcześniejszej sekcji tej notatki są więc do ponownego
potwierdzenia** — karta najwyraźniej nie wystawia tych surowych kolumn
wprost, tylko ich odpowiedniki opisowe/przez widok.

### Jeszcze bez dopasowania

„Grupa” („Artykuły spożywcze”) i „Klasa” („Wartości odżywcze”) z Dane
dodatkowe nie pojawiły się w tym fragmencie szablonu, który zdążyliśmy
zdekodować (możliwe, że są dalej w tym samym pliku, nie doczytaliśmy do
końca) — do sprawdzenia. „Symbol PCN” też nie widoczny jeszcze w
zdekodowanej części. Radiogroup „Swobodne korzystanie / Kontrola jakości”
— również nie widoczny jeszcze.

## ROZSTRZYGNIĘCIE (2026-09-14, ciąg dalszy): pełna lista 314 pól z zapytania SQL

Pytanie „czy to jest osobny widok z aliasami, czy klient sam dorabia HTML
do czystych nazw z API?" — złapaliśmy request `OperationName:
RefreshDataSetSQL_Synchronous` dla tej samej karty (`DictIdent:
csItemsOneBro`). To jest odpowiedź serwera z **surowymi danymi rekordu**
w formacie `DataTable` (`FieldDefs` — lista definicji pól, osobno wartości
w wierszach) — nie szablon HTML. Wyciągnęliśmy z niej pełną listę **314
nazw pól**, które ten jeden zapytanie SQL faktycznie zwraca dla produktu.

**Odpowiedź: serwer zwraca OBA warianty naraz.** W tych samych 314 polach
są jednocześnie: `csEBIProducersId` I `ProducerDesc`, `csEBIBrandsId` I
`BrandDesc`, `csEBICategoriesId` I `CategoryDesc`, `csEBIConcessionsId` I
`ConcessionDesc`, `csEBIVarietiesId` I `VarietyDesc`, `csPurchaseVATRatesId`
I `purchaseVATRate`, `csItemsVatClassyficationsG` I `ItemClassyfication`,
`csSeriesId` I `Series`, `csPCGSG` I `PCGS`/`PCGSTranslatedDesc`. Szablon
HTML binduje się do wersji opisowej (do wyświetlenia/edycji przez
combobox), ale surowa kolumna ID jest w tych samych danych pod swoją
prawdziwą nazwą — **więc nasze pierwotne dopasowania `csEBI*Id` z góry tej
notatki jednak są poprawne**, tylko trzeba je czytać z innego pola danych
niż to, do którego bezpośrednio binduje się kontrolka na ekranie.

### Nowe potwierdzenia 1:1 z tej listy 314 pól

`ShelfLifeDays`, `csItemsVatClassyficationsG`, `csPurchaseVATRatesId`,
`csEBIProducersId`, `csEBIBrandsId`, `csEBICategoriesId`,
`csEBIConcessionsId`, `csEBIVarietiesId`, `csSeriesId`, `csCountriesG`,
`PartNo2`, `csETIMClassesId`, `csPCGSG`, `csCPACodesG`,
`csStorageLocationsTypesG`, `ExpectedExpirationPeriod`,
`LotRegistrationRequired`, `ExpirationDateRequired`,
`csSysTablesIdentTemplatesG`, `csItemsModelsId`, `csProductExpertId`,
`weightClass`, `strengthClass`, `isDiff`, `registerPrice`, `basePrice`,
`blockEditETIMFeatures`, `globalPrice`, `globalStrictPrice`, `AutoItemNo`,
`csCompaniesId4FTI` — wszystkie potwierdzone dosłownie, bez zgadywania.

### WAŻNE ZASTRZEŻENIE: to zapytanie jest wyselekcjonowane, nie wyczerpujące

Ta konkretna odpowiedź NIE zawiera wszystkich 141 kolumn — np. z rodziny
`KeyWords_XX` widać tylko `KeyWords_PL`/`EN`/`HR` (nie ma DE/ES/FR/NL/PT/
RU/UK/IT/SK/CZ, mimo że te kolumny istnieją w bazie wg `kolumny.txt`),
podobnie `KeyWordsAuto_XX` — tylko `_HR`. Nieobecność pola w tej liście
**nie znaczy, że kolumna nie istnieje** — znaczy tylko, że to konkretne
zapytanie (dopasowane do aktualnie widocznych zakładek/języka) jej nie
pobrało. Do pełnego scrapowania trzeba będzie sprawdzić, czy przełączenie
zakładki/języka rozszerza SELECT, czy lista pól jest zawsze taka sama
niezależnie od tego, co jest aktualnie widoczne na ekranie.

### Pełna lista: 36 kolumn z `kolumny.txt` (Michała), których NIE ma w tej odpowiedzi 314 pól

To jest lista do wysłania Michałowi — pyta go nie „skąd rozjazd 141 vs
314" (to nie nasza sprawa, on definiuje wymagania), tylko wprost: **czy
rozpoznaje po nazwie, gdzie te kolumny się liczą, i czy ma kandydata z
tego, co złapaliśmy.** Podzielone wg naszego przypuszczenia:

**Warianty językowe — prawdopodobnie po prostu nie złapane w tym jednym
zapytaniu (produkt nigdy nie był tłumaczony, ale kolumny w bazie mogą
istnieć):** `KeyWords_DE`, `KeyWords_ES`, `KeyWords_FR`, `KeyWords_NL`,
`KeyWords_PT`, `KeyWords_RU`, `KeyWords_UK`, `KeyWords_IT`, `KeyWords_SK`,
`KeyWords_CZ`, `KeyWordsAuto`, `KeyWordsAuto_DE`, `KeyWordsAuto_EN`,
`KeyWordsAuto_ES`, `KeyWordsAuto_FR`, `KeyWordsAuto_IT`, `KeyWordsAuto_NL`,
`KeyWordsAuto_PL`, `KeyWordsAuto_PT`, `KeyWordsAuto_RU`, `KeyWordsAuto_UK`.

**Mamy kandydata pod inną nazwą:** `purchaseLastPrice` → prawdopodobnie
`CPurchasePrice` (pole „Zakupu" na karcie — pytanie 1 niżej, czy to ta sama
wartość); `Photo`/`PhotoSmall`/`PhotoVersion`/`PhotoSmallVersion`/
`IsPhoto`/`IsPhotoPrev` → prawdopodobnie odpowiadają `PhotoUrl`/
`PhotoSmallUrl` (API oddaje gotowy URL zamiast surowego pola binarnego).

**Bez żadnego kandydata w złapanych 314 polach:** `DefSort`,
`LastChangeDate`, `createdDate`, `isEOL`, `csUNSPSCCommodityId`,
`csProducersIdAgr`, `NameA1Agr`, `NameL1Agr`.

### Pola z tej listy 314, których nie ma w `kolumny.txt` pod żadną nazwą

Dla porządku — to, co karta zwraca, a czego nie ma na liście Michała:
`EANType`, `isFractionalQuantity`, `groupsInfo01`…`04` (+ warianty XML),
`itemsGroupMask01`…`04`, `CRecyclingFee` (KGO), `validTo`, `expireDays`,
`csItemsAddId`/`csItemsAddG` (+ cała rodzina `Atr01`…`AtrInt09` —
atrybuty rozszerzone produktu), `csProducersIdNew`/`csSupplierIdNew` (+
`ProducersDescNew`/`SupplierDescNew`/`*Ident`), `csItemsGroupsId4Purchase`/
`csItemsGroupsId4BonusDiscount` (+ rabaty grupowe), `Usr4PIM`. Skoro Michał
sam definiuje zakres, nie pytamy go o to wprost — to tylko informacja, że
CSV „wszystkie-pola-api" zawiera więcej niż jego lista, gdyby chciał
kiedyś po to sięgnąć.

## Sprawdzone dodatkowo (2026-09-14): katalog i pozostałe zakładki karty

Przed wysłaniem wiadomości do Michała sprawdziliśmy dwa dodatkowe źródła,
żeby nie przegapić czegoś istotnego:

- **Katalog (lista produktów)** — 50 dostępnych kolumn (z `sonda-lista-kolumn.js`)
  w większości pokrywa się z tym, co już mamy, albo jest poza zakresem. Jedyne
  nowe, ale niskopriorytetowe: `csMasterItemsGroupsId`, `csMailsTemplatesTypesG`.
- **Pozostałe zakładki karty produktu** (Zapasy, Zdjęcia, Załączniki, Grupy,
  Opisy w B2B, Powiązane, Jednostki, Referencje, Kontrahenci, Do użycia w
  magazynach, Limity cen produktów, Stany MWS, Towary w drodze) — złapane
  `podsluch-danych-produktu.js` v9, potwierdzone realnymi danymi (nie tylko
  szablonem `VisualDefinition`):

  | Zakładka | `DataSetSQLIdent` | pól |
  |---|---|---|
  | Zdjęcia | `csphotos` | 46 |
  | Załączniki | `csattachments` | 50 |
  | Grupy | `csitemsgroupsitems` | 35 |
  | Opisy w B2B | `csitemsdesc4b2bportals` | 46 |
  | Powiązane | `csitemslinkedto` | 31 |
  | Jednostki | `csitemsunits4item` | 88 |
  | Referencje | `csitemsrefs` | 22 |
  | Kontrahenci | `csitemscustomers` | 32 |
  | Opisy | `csitemdescriptions` | 12 |
  | Do użycia w magazynach | `csitemswarehouses4item` | 31 |
  | Limity cen produktów | `cspricingpoliciesitemslimits` | 68 |
  | Stany MWS | `csstockswms` | 20 |
  | Towary w drodze | `csgoodsintransit` | 16 |

  Każda ma własne ID/G i klucze obce (`csItemsId` itp.) — to potwierdza
  wcześniejszy wniosek: to naprawdę osobne tabele/relacje, nie kolumny
  `csItems`. Żadna nie ujawniła nowego pola pasującego do listy 141 kolumn.

## Nierozstrzygnięte pytania do Michała

**Zasada (2026-09-14):** pytamy Michała tylko o to, co on sam wskazał na
liście 141 kolumn — nie o to, czy jego lista jest kompletna względem
naszego zapytania testowego (to jego decyzja jako zakres wymagań, nie
nasza). Nie pytamy też o pola, które zauważyłem sam podczas eksploracji
UI, a on o nie nie prosił (Symbol PCN, radiogroup „Swobodne korzystanie",
Grupa/Klasa z „Dane dodatkowe") — to zostaje w notatce wyżej jako
ciekawostka techniczna, nie trafia do Michała. Zakres ograniczamy do
`csItems` — nie pytamy o dane z osobnych tabel (Zapasy, Opisy w B2B,
Jednostki, Referencje, Kontrahenci, Do użycia w magazynach), skoro Michał
ich nie wskazał.

1. `purchaseLastPrice` (z Twojej listy) vs `CPurchasePrice` (pole
   faktycznie widoczne na karcie, w polu „Zakupu”) — czy to ta sama
   wartość pod dwiema nazwami, czy naprawdę dwie różne kolumny (np. jedna
   ręcznie wpisywana, druga wyliczana z historii zakupów)?
2. 36 kolumn z Twojej listy 141, których nie widzimy w danych, jakie
   zwraca karta produktu (patrz pełna lista wyżej, sekcja „Pełna lista: 36
   kolumn..."). Większość to warianty językowe (`KeyWords_DE/ES/FR/...`),
   które pewnie po prostu nie są uzupełnione (produkt nigdy nie był
   tłumaczony) — ale czy rozpoznajesz po nazwie, gdzie się liczą
   pozostałe: `DefSort`, `LastChangeDate`, `createdDate`, `isEOL`,
   `csUNSPSCCommodityId`, `csProducersIdAgr`, `NameA1Agr`, `NameL1Agr`?
3. Pola SEO per język — `SEOTitle`/`SEODescription`/`SEOCanonical` masz na
   liście tylko dla PL/EN/HR, ale w UI pole „Tytuł” i „Robots” pokazuje
   się też dla DE/FR/NL/ES/PT/UK/RU. Wiesz, gdzie się to zapisuje dla tych
   dodatkowych języków?
