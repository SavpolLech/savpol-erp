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

Zasada dla pól językowych: przełącznik języka (Polski/Angielski/Niemiecki/
Francuski/Niderlandzki/Hiszpański/Portugalski/Ukraiński/Rosyjski/Chorwacki/
Słowacki/Czeski — 12 pozycji) wybiera, którego sufiksu `_XX` dotyczą pola
Tytuł/Opis/Robots/Canonical/Słowa kluczowe/Nazwa produktu. Nie trzeba klikać
każdego języka osobno, żeby to potwierdzić — struktura jest identyczna.

## Wymaga potwierdzenia od Michała

**Zakładka „Grupy”** to siatka przypisań produktu do WIELU hierarchii grup
naraz (nie proste pola):
- `B2B\Kategorie\Cukiernicze\produkty\Aromaty\Etanolowe`
- `B2B\Profil produkcji\Cukiernia`
- `B2B\Marki\hoffman`
- `SAVPOL\CD\AR\Aromaty`

Pewne: **Marka → `B2B\Marki\...`** = najpewniej `csEBIBrandsId`.

Niepewne (nie zgadujemy z samej nazwy drzewa): `csEBICategoriesId`,
`csEBIConcessionsId`, `csEBIVarietiesId`, `csEBIProducersId` — które z
pozostałych 3 drzew (`B2B\Kategorie\...`, `B2B\Profil produkcji\...`,
`SAVPOL\CD\AR\...`) odpowiada którym kolumnom? Do zapytania.

Pola „Kategoria / Marka / Partner / Profil produkcji” na Dane podstawowe są
zawsze puste — to prawdopodobnie tylko widgety szybkiego dodawania do tej
samej siatki grup, nie osobne miejsce przechowywania wartości.

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

Jeszcze nie sprawdzone, ale prawdopodobnie też osobne tabele (pominięte jako
niskopriorytetowe — dane operacyjne/relacyjne, nie master produktu):
Powiązane, Kontrahenci, Do użycia w magazynach, Limity cen produktów,
Stany MWS, Towary w drodze.

„Atrybuty” i „Opisy dod.” pojawiają się w DOM (wykrywane przez sondę), ale
NIE są widoczne na rzeczywistej liście bocznej tego konta — najpewniej
ukryte/wyłączone uprawnieniami (patrz `diagnostyka/README.md`).

## Wciąż niezidentyfikowane pola na Dane podstawowe/dodatkowe

Kilkanaście pól typu `(bez etykiety)` (checkboxy TAK/nie) na lewym
formularzu — etykieta nie została znaleziona przez sondę (prawdopodobnie
inny wzorzec DOM niż `label.Label`). Do zbadania osobno, jeśli okaże się
istotne — obecnie nie wiadomo, których kolumn dotyczą.

## Nierozstrzygnięte pytania do Michała

1. Które z 4 drzew grup (Kategorie/Profil produkcji/Marki/SAVPOL CD\AR)
   odpowiada którym kolumnom `csEBICategoriesId`/`csEBIConcessionsId`/
   `csEBIVarietiesId`/`csEBIProducersId`?
2. Czy dane z osobnych tabel (Zapasy, Opisy w B2B, Jednostki, Referencje)
   w ogóle wchodzą w zakres tego zadania, czy interesuje go wyłącznie
   `csItems`?
