# Kontrahenci — mapowanie pól (ustalenia z 2026-10-02)

Zlecenie Michała: dane słownikowe kontrahentów. Kolejność:
1. `csCustomersGroups` (grupy klienckie),
2. `csCustomers` (baza),
3. potem tabele z zakładek karty: `csCustomersAddresses` (Dane adresowe),
   `csCustomersContacts` (Dane kontaktowe), `csBankAccounts` (Rachunki
   bankowe), `csCustomersUsrs` (Opiekuni), `csTradeConditions` (Warunki
   handlowe), `csCustomersGroupsCustomers` (Klasyfikacja),
   `csCustomersFeatures` (O kontrahencie).

## Skąd dane — API, nie siatka

Jak przy produktach (`produkty/`), nie czytamy komórek siatki, tylko
podsłuchujemy odpowiedź API karty i dekodujemy ją (`produkty/lib/decode.js`).
Dzięki temu **nie trzeba włączać/wyłączać kolumn w widoku ERP**.

| Źródło | DictIdent / DataSetSQLIdent | Co daje |
|---|---|---|
| Karta kontrahenta (EDYCJA) | `csCustomersOneBroFull`, `RefreshObjectReturnList[0]` | 468 pól, w tym **wszystkie 168 kolumn `csCustomers`** + adres główny, adres korespondencyjny, warunki handlowe (Sup/Rec), rachunek bankowy |
| Lista kontrahentów | `csCustomers`, `RecordProps` | 93 pola zaznaczonego wiersza (podzbiór karty) |
| Okno Grupy kontrahentów | `csCustomersGroups`, `RecordProps` | 53 pola, w tym **wszystkie 34 kolumny `csCustomersGroups`** — ale tylko dla wiersza zaznaczonego przy otwarciu |
| Klik w grupę | `csCustomersGroups` (podsiatka) | członkowie grupy: 193 pola, `csCustomersGroupsCustomersId` + dane kontrahenta → materiał na `csCustomersGroupsCustomers` |
| Lista rozwijana grupy na karcie | `cscustomersgroupslookup` | 97 grup (tylko id/G/nazwa) |

Pełne listy pól: `info/pola-karta-csCustomersOneBroFull.txt`,
`info/pola-grupa-csCustomersGroups.txt`. Pokrycie kolumn tabel w `worek`
sprawdzone skryptem: 168/168 i 34/34, **0 pól niedostępnych**.

## Nawigacja (Playwright)

- **Karta po id działa wprost z URL** (sprawdzone na 417109229 MEGIW i
  30445738062 KUREK FOOD — tego drugiego brak w `worek`):
  `https://erp.savpol.pl/pl/kontrahent/cscustomersonebrofull-213217693,<id>,<id>,x/213217693`
  (slug i nazwa w URL są dowolne; 213217693 = csCompaniesId).
- Lista kontrahentów: `https://erp.savpol.pl/pl/kontrahenci/cscustomers` — działa z URL.
- Grupy kontrahentów: **link prowadzi na pulpit**, trzeba wejść z menu
  (wpisać „kontrah” w `input.csEditMainMenuFilter` znak po znaku —
  `fill()` nie uruchamia filtra — i kliknąć `span.k-link` „Grupy kontrahentów”).
  Siatka: 21 wierszy/stronę, pager `.csDataPager`.

## Stan `worek` (2026-10-02)

- `csCustomers`: 58 914 wierszy, ostatnia zmiana 2026-07-24 (kopia z ERP).
  ERP: 44 316 aktywnych.
- Od 2026-07-27 dokumenty WZ/MM/PZ w `worek` odwołują się do **162
  kontrahentów, których nie ma w `csCustomers`** (437 dokumentów).
- `csCustomersGroups`: 117 wierszy = 117 w ERP, nazwy i opisy zgodne (jedyna
  różnica: spacja na końcu opisu BAFRA — artefakt odczytu z DOM). **Nic do
  dopisania.** Nowa grupa → wykryć po nazwie w siatce, rekord z karty grupy.

## Zasady

- Tylko INSERT nowych `csCustomersId` (patrz `ROZBIEZNOSCI.md`) — zmiany
  istniejących kontrahentów w ERP logujemy, nie nadpisujemy.
- Próbka: 5 kontrahentów do `csCustomers_test`, weryfikacja Michała, potem reszta.

## Kalibracja 2026-10-02 (próbka 1:1 z produkcją)

Skrypty: `scrape.js` (karta → `wynik/kontrahent_<id>.json`, poza repo),
`wgraj-do-worek.js` (→ `csCustomers_test`, 168 kolumn jak produkcja; `--realne`
dopiero po akceptacji Michała), `porownaj-z-prod.js` (test vs produkcja).

5 kontrahentów już obecnych w `csCustomers`, różnych typów: firma (417109229
MEGIW), dostawca (218468494), osoba fizyczna (29457278739), z logo
(28424966772), ostatnio zmieniany przed kopią (28930288827). Wynik:

- **165–167 z 168 kolumn zgodnych 1:1**, w tym Logo (bajt w bajt).
- `LastChangeDate`, `lastActivity`: API podaje czas do sekundy, produkcja ma
  milisekundy (`08:08:21.463` vs `08:08:21`). Nie do odzyskania z karty.
- 28930288827: inny `csCustomersStatusesValuesId` i `LastChangeDate`
  2026-08-04 — kontrahent zmieniony w ERP po kopii bazy, czyli prawdziwa
  zmiana, nie błąd.
- Poprawione w trakcie: API oddaje pusty tekst jako null — w kolumnach
  tekstowych NOT NULL (`CustomerIdent`) zapisujemy `''` jak produkcja.

Do zrobienia przed automatem: lista WSZYSTKICH nowych kontrahentów z ERP
(nie tylko tych z dokumentów), `run-log.jsonl` + `pushLogs`, wpięcie do
orkiestratora `dobij-wszystko.js`.
