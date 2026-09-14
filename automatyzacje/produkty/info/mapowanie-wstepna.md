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
| `SEOTitle_XX` | tylko **PL, EN, HR** |
| `SEODescription_XX` | tylko **PL, EN, HR** |
| `SEOCanonical_XX` | tylko **PL, EN, HR** |
| `SEOrobots` | **brak sufiksu językowego** — jedno wspólne pole dla całego produktu |

Konsekwencja dla scrapera: przy zbieraniu SEO Tytuł/Opis/Canonical trzeba
zbierać TYLKO z zakładek Polski/Angielski/Chorwacki — pozostałe języki na
tym panelu nie mają gdzie zapisać wartości w tej tabeli (mogą być puste nie
dlatego, że nikt ich nie wypełnił, tylko dlatego, że nie ma dla nich
kolumny). Dla Słowa kluczowe i Nazwa produktu (Opisy) — zbieramy ze
wszystkich ~13 języków normalnie.

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

## Nierozstrzygnięte pytania do Michała

1. **Najważniejsze:** karta produktu w ERP wystawia pola pod innymi
   nazwami niż surowe kolumny z Twojej listy (np. `ProducerDesc` zamiast
   `csEBIProducersId`, `CPurchasePrice` zamiast `purchaseLastPrice`,
   `purchaseVATRate` zamiast `csPurchaseVATRatesId`, `Series` zamiast
   `csSeriesId`). Czy to jest widok/zapytanie zbudowane nad `csItems`,
   i czy możesz dać nam listę: nazwa pola w UI → surowa nazwa kolumny w
   tabeli? Bez tego nie mamy pewności, do której kolumny wpisywać wartości
   przy zapisie do bazy.
2. `EANType`, `isFractionalQuantity`, `groupsInfo01XML`–`04XML`,
   `CRecyclingFee` (KGO) — nie widzimy ich w liście 141 kolumn pod żadną
   rozpoznawalną nazwą. Czy w ogóle są w `csItems`, a jeśli tak, pod jaką
   nazwą?
3. Kod PKWiU (drugie pole, `PCGS`/`PCGSTranslatedDesc`) — czy to faktycznie
   `csPCGSG`, czy inna kolumna?
4. Grupa, Klasa, Symbol PCN, radiogroup „Swobodne korzystanie/Kontrola
   jakości” — wciąż nieznalezione w szablonie karty, doszukujemy dalej.
5. Czy dane z osobnych tabel (Zapasy, Opisy w B2B, Jednostki, Referencje,
   Kontrahenci, Do użycia w magazynach) w ogóle wchodzą w zakres tego
   zadania, czy interesuje Cię wyłącznie `csItems`?
