# Nowe produkty bez historii sprzedaży — instrukcja dla `esavpol-pdp`

Do wykonania **w repozytorium `SavpolLech/esavpol-pdp`**. Strona ERP jest już
gotowa (userscript v2.20.0) i wysyła opisane niżej parametry.

## Problem

Narzędzie miało służyć produktom z historią sprzedaży. W praktyce marketing
chce nim opisywać **nowo dodane produkty**, a te mają zero, jedną albo dwie
faktury. Co-occurrence nie ma wtedy z czego powstać.

## Ile faktur to za mało — zmierzone, nie wyczute

Dla ośmiu skalibrowanych produktów losowo przycinaliśmy próbę do K faktur
(40 losowań na kombinację) i sprawdzali, ile z „prawdziwego" top-4 (z pełnej
próby) wraca w wyniku:

| Faktur | Trafień z pełnego top-4 | Przebiegów bez wyniku |
|---|---|---|
| 10 | 5% | 78% |
| 15 | 11% | 55% |
| 20 | 22% | 32% |
| 30 | 44% | 7% |
| 40 | 57% | 2% |
| 50 | 68% | 0% |
| 60 | 74% | 0% |
| 80 | 85% | 0% |

Przy 20 fakturach **trzy z czterech rekomendacji byłyby inne**, gdyby dane były
kompletne. Sugerowane progi: **30** jako podłoga, **50** jako granica pewności.
Trzyma je apka — skrypt przekazuje samo `invoices=N`, patrz niżej.

## Co przychodzi w URL

Skrypt otwiera generator tak jak dotąd, plus dwa nowe parametry:

```
?sku=0000759&invoices=2&group=Artykuły%20cukiernicze%5CDekoracje%20cukrowe%5CPosypki
?sku=0031018&cross=0020669,0006418&invoices=87
```

| Parametr | Znaczenie |
|---|---|
| `sku` | anchor, bez zmian |
| `cross` | SKU z faktur; puste, gdy nic nie przeszło progów |
| `invoices` | **na ilu fakturach oparta jest rekomendacja** (`0` = brak historii) |
| `group` | ścieżka grupy produktu z katalogu ERP, rozdzielona `\` |

Uzgodnione 2026-08-06: skrypt przekazuje **fakt, nie ocenę**. Nie ma flagi
„niepewne" — jest `invoices=N`, a próg trzyma generator. Powód jest praktyczny:
zmiana progu po stronie apki nie wymaga wtedy aktualizacji userscriptu u trzech
osób z osobna.

Konsekwencja, która z tego wynika: **skrypt nie wycina kandydatów przy małej
próbie.** Gdyby wycinał, generator nigdy by ich nie zobaczył i nie mógłby progu
obniżyć. Przy 12 fakturach i jednym kandydacie dostaniesz `cross=…&invoices=12`
— decyzja, co z tym zrobić, należy do apki.

`group` jest wysyłana zawsze, gdy udało się ją odczytać. Generator ustala
kategorię sam z danych sklepu, więc to materiał pomocniczy — ale grupa z ERP
bywa dokładniejsza niż hierarchia w sklepie i nic nie kosztuje.

## Do zrobienia

### 1. Tryb rules-based przy pustym `cross`

`kit-data/cross-sell/cross-sell-map.md` jest napisana dokładnie pod ten przypadek
(„Rules trwałe. Dla nowej kategorii produktu → od razu wiemy jakie kategorie
targetów pasują, bez CSV") i ma nawet gotowy przykład
`sweety-60-quick.md (rules-based, brak faktur)`.

**Ta mapa nie jest dziś używana.** `lib/load-kit.ts:189-190` wczytuje
`crossSellMap` i `exclusions` do obiektu kitu, ale grep po całym projekcie
pokazuje wyłącznie definicję typu i przypisanie — nic ich nie konsumuje.
To gotowa baza wiedzy leżąca odłogiem.

Gdy `cross` jest puste:

1. dopasuj `group` do sekcji w `cross-sell-map.md` (kategorie ERP nie nazywają
   się identycznie jak nagłówki mapy — dopasowanie musi być rozmyte albo
   przez tabelę aliasów, którą warto dopisać do mapy);
2. z `skus.jsonl` (472 wpisy, pole `category`) wybierz konkretne SKU dla
   wskazanych przez mapę kategorii;
3. odsiej to, co wypada po `exclusions.md`;
4. **oznacz w wygenerowanym pliku, że propozycje są rules-based, nie z faktur** —
   inaczej za pół roku nikt nie odróżni jednego od drugiego.

Gdy `group` nie pasuje do żadnej sekcji mapy: nie zgaduj. Lepiej opis bez sekcji
cross-sellingu niż cztery przypadkowe produkty na stronie.

### 2. Próg po stronie apki

Apka dostaje `invoices=N` i sama rozstrzyga, czy to dość. Pomiar wyżej sugeruje
30 jako podłogę i 50 jako granicę pewności, ale to jej decyzja i jej stała.
Wynik z małej próby ma być widoczny dla osoby redagującej.

### 3. `meta` w `/api/invoice-history`

POST niesie teraz dwa dodatkowe pola, obok istniejących `partial`/`unverified`:

```jsonc
"meta": { "tooFewInvoices": true, "lowConfidence": false, … }
```

Warto je zapisywać w komentarzach nagłówka pliku i zwracać w `GET` — wtedy
sprawdzanie duplikatu wie, że poprzedni przebieg nie miał z czego liczyć,
i nie odradza powtórzenia, gdy produkt zdążył się już sprzedać.

## Do decyzji: faktury w repo

`kit-data/cross-sell/README.md` mówi:

> Faktury CSV nie są przechowywane w repo (usunięte 2026-07-27) — […] faktury
> to najbardziej wrażliwe dane w repo (ilości, ceny, wartości sprzedaży)

Integracja z 2026-08-06 zaczęła je zapisywać ponownie, w węższej postaci:
`Numer dokumentu;Produkt;SKU;Ilość` — bez cen, wartości i kontrahentów.
Główny powód usunięcia w dużej części odpada, ale README trzeba uzgodnić
z rzeczywistością: albo dopisać, po co zapis wrócił, albo integrację wyłączyć.

Argument za zapisem, którego wcześniej nie było: mając archiwum wielu historii
da się policzyć **tło** — jak często dany produkt występuje na fakturach
w ogóle. To potrzebne do odsiania bestsellerów, patrz niżej.

## Znane ograniczenie, jeszcze nienaprawione

W ośmiu skalibrowanych produktach dwa SKU wracają niemal zawsze:

```
0006418: 7/8 anchorów
0020669: 6/8 anchorów
```

Wszystkie pozostałe: 1/8. To nie są produkty „kupowane razem z tym" — to
bestsellery kupowane ze wszystkim. Zajmują dwa z czterech miejsc w każdej
rekomendacji. Lekarstwem jest **lift**: porównać udział produktu w fakturach
anchora z jego udziałem we wszystkich fakturach. Wymaga archiwum historii,
więc jest zależne od decyzji wyżej. Nie jest częścią tego zadania.
