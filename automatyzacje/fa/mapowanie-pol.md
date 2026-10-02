# Dokumenty sprzedaży: faktury (FA) i paragony (PAR) — mapowanie pól (ustalenia z 2026-10-02)

Zlecenie Michała (2026-10-02): faktury FA z okna **Dokumenty sprzedaży**
(`https://erp.savpol.pl/pl/dokumenty-sprzedazy/csdocsheaders4sales`), ładowane
jak WZ/MM/PZ do `csDocsHeaders_test` / `csDocsItemsPositions_test`. Wzorcowy
wiersz z polami: `FA_pola_wymagane.xlsx` (arkusz FA = 273 pola nagłówka na
przykładzie 2026/FA/WLS1/022502; DH/DIP = flagi nagłówka/pozycji).

`csDocsTypesId` FA = **267302594**. Lista „Dokumenty sprzedaży” miesza FA
z paragonami (`/PAR/`, `/PARK/`) i korektami (`/FAK/`) — inne typy.

**Status: mapowanie KOMPLETNE, 0 pól „do ustalenia”, 0 stałych.**

## Skąd dane — karta API, nie siatka

Jak kontrahenci (`kontrahenci/`): nie czytamy komórek siatki, tylko
podsłuchujemy odpowiedź API karty i dekodujemy ją (`produkty/lib/decode.js`).

| Źródło | DataSetSQLIdent | Co daje |
|---|---|---|
| Karta faktury `csDocsHeaders_Sales` | `csdocsheaders` | 1 wiersz, 371 pól — **wszystkie 273 kolumny `csDocsHeaders`** (w tym KSeFXML, KSeFUPO, paramsJSON) |
| ta sama odpowiedź | `csdocsitemspositions` | wszystkie pozycje faktury, 168 pól — **wszystkie 120 kolumn `csDocsItemsPositions`** |
| Lista `csdocsheaders4sales` | `csdocsheaders4sales` | 208 pól/wiersz, 21 wierszy/stronę — tylko 46 z 273 pól nagłówka; nadaje się do zebrania id faktur z dnia, nie do danych |

Karta otwiera się wprost z URL:
`https://erp.savpol.pl/pl/faktura/csdocsheaders_sales-213217693,<id>,<id>,x/213217693`
(slug dowolny). Pełne listy pól: `info/pola-karta-csDocsHeaders_Sales.txt`.

Flagi z arkuszy DH (50) i DIP (5) **nie są potrzebne jako stałe** — karta
oddaje je z prawdziwymi wartościami per faktura, zgodnymi z wierszem Michała.

## Kalibracja 2026-10-02 (5 FA z 1 lipca, 1:1 z produkcją)

Faktury: 2026/FA/WLS1/022502 (wzorcowa Michała, 8 poz.), GLS1/029784 (43 poz.,
największa z dnia), KRS1/014891 (31), KRS1/014920 (1), GLS1/029828 (1).
`scrape.js` → `wgraj-do-worek.js` (do `_test`) → `porownaj-z-prod.js`.

- Liczba pozycji 84/84 zgodna, wszystkie `csDocsItemsPositionsId` się pokrywają.
- Nagłówek: 269–272/273 kolumn zgodnych; pozycje: 119/120.
- Różnice, wszystkie wyjaśnione:
  - `lastModifiedDate` (nagłówek) i `createdDate` (pozycje) — **API podaje
    czas z dokładnością do sekundy**, produkcja ma milisekundy
    (`02:10:20.440` vs `02:10:20`). Ograniczenie źródła, nie do obejścia.
  - `LastDocsHeadersPaymentsPositionsDateOfPayment`,
    `DocsHeadersPaymentsPositionsPaymentBalance`,
    `IsPaidFullDocsHeadersPaymentsPositions` (2 faktury) — zapłaty wpisane
    w ERP po kopii bazy (24.07 i 13.08). Prawdziwy stan ERP.

Wniosek: pola płatności zmieniają się po wystawieniu faktury. Przy insert-only
(`ROZBIEZNOSCI.md`) w bazie zostaje stan z dnia scrapowania — do ustalenia
z Michałem, czy to wystarcza.

## Paragony (PAR) — ten sam scraper, `--typ=PAR`

Zlecenie Michała (2026-10-02, „bliźniaczo jak z fakturami”): paragony z tego
samego okna Dokumenty sprzedaży (filtr zaawansowany: Typ dok. równe PAR).
Wzorcowy wiersz: `PAR_pola_wymagane.xlsx` — te same 273 kolumny nagłówka,
te same arkusze DH (50) i DIP (5) co przy FA.

`csDocsTypesId` PAR = **218693742**. Karta otwiera się tym samym URL co faktura
(`csdocsheaders_sales-...`) i daje komplet pól nagłówka i pozycji, więc
**mapowanie jest identyczne jak dla FA: 0 pól „do ustalenia”, 0 stałych.**
Jedyne pole „paragonowe”, które ma wartość, to `FiscDate` (czas fiskalizacji).

```
node scrape.js --typ=PAR <id...>        → wynik/par_<id>.json
node wgraj-do-worek.js --typ=PAR        → csDocsHeaders_test / csDocsItemsPositions_test
node porownaj-z-prod.js --typ=PAR
```

Kalibracja 2026-10-02 (5 z 23 PAR z 1 lipca — liczba 23 = licznik ERP na
zrzucie Michała): GLS1/001170 (wzorcowy, 6 poz.), RAS1/000916 (9, największy
z dnia), RZS1/000932 (6), WLS1/000690 i WLS1/000691 (po 1, ze zrzutu Michała).

- Pozycje 23/23, wszystkie `csDocsItemsPositionsId` się pokrywają.
- Nagłówek 271/273, pozycje 119/120. Różnice wyłącznie w milisekundach:
  `lastModifiedDate`, `FiscDate` (nagłówek) i `createdDate` (pozycje) —
  to samo ograniczenie API co przy FA. Brak różnic w płatnościach (paragony
  są opłacane od razu).

Korekty paragonów (`/PARK/`) to osobny typ — nie wchodzą.

## Następny krok

1. Weryfikacja próbek przez Michała (5 FA i 5 PAR w `csDocsHeaders_test` /
   `csDocsItemsPositions_test`).
2. Lista id faktur z dnia: podsłuch listy `csdocsheaders4sales` z filtrem
   daty i paginacją (21/stronę, ~590 FA/dzień → ~30 stron), filtr
   `csDocsTypesId` FA i PAR (jeden przebieg listy daje id obu typów).
   Kontrola: liczba FA i PAR z dnia = licznik ERP.
3. Czas: karta ~3–5 s → ~40 min na dzień. Wpięcie do orkiestratora
   (`dobij-wszystko.js`) jako kolejny typ + `pushLogs(...)` na koniec przebiegu.
