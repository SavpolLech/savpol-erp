# Szablon: prompt inicjujący scraper nowego rodzaju dokumentu

Zasada: **osobny wątek = osobny rodzaj dokumentu**. Skopiuj sekcję "PROMPT"
niżej do nowej rozmowy, wypełnij `{{...}}` wsadem od Michała i wytnij komentarze
`(…)`. Reszta pliku to ściąga, czego ten prompt oczekuje i jak przyspieszyć
diagnostykę — zostaje w repo, nie wkleja się jej do czatu.

---

## PROMPT (skopiuj do nowego wątku)

> Budujemy scraper nowego rodzaju dokumentu w tym repo. Wzorzec, który
> **klonujemy 1:1 co do architektury**, to `automatyzacje/wz/` — przeczytaj go
> najpierw, zanim cokolwiek napiszesz. Nowy typ ma zamieszkać w
> `automatyzacje/{{katalog-typu, np. pz}}/` z tą samą strukturą:
> `scrape.js`, `lib/{fields,fixed-values,schema,state,git-log-push}.js`,
> `generate-test-tables.js`, `schema-test-tables.json`, `.env(.example)`,
> `serwer/`. To, co się różni między typami, to **tylko**: URL listy w ERP,
> lista pól (`lib/fields.js`), stałe wartości per typ (`lib/fixed-values.js`)
> i tabele docelowe. Logika DOM, sesje, paczki, stan, limit godzin,
> git-log-push — bez zmian.
>
> **Wsad od Michała:**
> - Rodzaj dokumentu: `{{np. PZ — przyjęcie zewnętrzne}}`
> - Widok/lista w ERP (URL albo nazwa w menu): `{{URL lub ścieżka}}`
> - Tabela(e) docelowa(e) w bazie `worek`: `{{np. dbo.csDocsHeaders +
>   dbo.csDocsItemsPositions, albo inne}}`
> - Pola do uzupełnienia (nagłówek): `{{lista nazw kolumn 1:1 z bazy}}`
> - Pola do uzupełnienia (pozycje): `{{lista nazw kolumn 1:1 z bazy}}`
> - Wartości stałe per typ (flagi zależne od rodzaju dokumentu, nie
>   scrapowane): `{{np. csDocsTypesId=..., Stock=...}}`
> - Znane pułapki / uwagi Michała: `{{np. które pole z pierwszej pozycji,
>   co wymaga włączenia kolumny w ERP, co jest niedostępne}}`
>
> **Kolejność pracy:**
> 1. Załóż `automatyzacje/{{katalog-typu}}/mapowanie-pol.md` — dla KAŻDEGO
>    pola z listy Michała zapisz, skąd je bierzemy (grid nagłówka / grid
>    pozycji / pierwsza pozycja / wartość stała / **niedostępne**). To jest
>    plan; nie scrapujemy niczego, dopóki mapowanie nie jest kompletne.
> 2. Faza diagnostyki w konsoli ERP (patrz niżej — użyj gotowej,
>    uogólnionej sondy, nie klikaj po polach ręcznie). Wynik z sondy sam
>    ląduje w schowku; wkleję go tutaj.
> 3. Uzupełnij `lib/fields.js` i `lib/fixed-values.js` na podstawie sondy +
>    mapowania. Dopiero to jest "prawda" dla scrape.js.
> 4. `generate-test-tables.js` na PRAWDZIWYM schemacie → `schema-test-tables.json`
>    (typy z bazy, nie zgadywane w kodzie).
> 5. Uruchom na **próbce** (`MAX_DOCS=5`, jeden dzień) → wynik do weryfikacji
>    przez koordynatora, ZANIM podniesiemy limit. Tak samo jak przy WZ.
>
> **Zasady projektu (obowiązują):**
> - Każdy snippet do konsoli sam kopiuje wynik do schowka (`copy()` →
>   `navigator.clipboard` → `textarea`+`execCommand`), w konsoli zostaje tylko
>   krótkie "skopiowano, N znaków". Zrzut samoopisujący się: nagłówek z URL
>   i datą. (Patrz `CLAUDE.md`.)
> - Commit + push od razu, bez pytania — testuję na wersji z repo.
> - `MAX_DOCS` startuje na 5 (tryb ostrożny), wraca do 900 dopiero po
>   zatwierdzeniu próbki przez koordynatora.
>
> **Definicja ukończenia próbki:** 5 dokumentów danego typu wpisanych do
> `worek` (tabele `*_test`), liczba dok./pozycji zgadza się z licznikiem
> ERP dla wybranego dnia, mapowanie-pol.md kompletne (0 pól "do ustalenia").

---

## Ściąga: skąd się biorą pola (do czego zmusza prompt)

ERP renderuje siatki zależnie od **uprawnień i konfiguracji widoku konkretnego
użytkownika** — ten sam ekran na dwóch kontach ma inne kolumny. Dlatego nie
zgadujemy selektorów, tylko czytamy realny DOM sondą (`diagnostyka/README.md`).
Pola trafiają do jednej z kategorii, dokładnie jak w `automatyzacje/wz/lib/fields.js`:

- **grid nagłówka** — kolumna `data-datafield` o tej samej nazwie na liście.
- **grid pozycji** — kolumna w siatce karty dokumentu.
- **pierwsza pozycja** — pole bez własnej kolumny w nagłówku, ale stałe dla
  całego dokumentu → bierzemy z pierwszej pozycji.
- **wartość stała per typ** — flaga zależna od rodzaju dokumentu
  (`lib/fixed-values.js`), nie scrapowana.
- **niedostępne** — nie istnieje w żadnym gridzie; odnotować i zgłosić Michałowi.

## Przyspieszenie diagnostyki

Diagnostyka jest długa, bo dotąd szło się polami iteracyjnie. Da się ją ściąć
do **jednego przebiegu**:

1. **Najpierw włącz wszystkie kolumny** w panelu kolumn ERP (część pól nie jest
   renderowana domyślnie — patrz uwaga w `wz/lib/fields.js`). Bez tego sonda ich
   nie zobaczy, choćby istniały.
2. **Jedna sonda zrzuca cały inwentarz naraz** zamiast pola po polu: dla każdej
   widocznej siatki `.cs-grid-data-table` listę wszystkich `data-datafield`,
   listę zakładek `li.k-item[aria-controls]`, stan pagera, URL i datę — do
   schowka jednym stringiem. To rozwija `diagnostyka/sonda-lista-kolumn.js`;
   dla nowego typu zwykle wystarcza uruchomić ją na liście **i** na otwartej
   karcie dokumentu (dwa zrzuty), i porównać z listą pól Michała.
3. Co zostaje ręczne (i pewnie musi): rozstrzygnięcie, które pole z listy
   Michała odpowiada której kolumnie, gdy nazwy się nie pokrywają 1:1, oraz
   które pola są naprawdę "niedostępne" vs tylko wyłączone w widoku. Tego sonda
   nie rozstrzygnie — ale dostaje kompletny materiał w jednym zrzucie zamiast
   w dziesięciu podejściach.

Wniosek: przyspieszamy zbieranie (jeden zrzut po włączeniu kolumn), a nie samo
mapowanie — decyzja "które pole = które" zostaje po stronie człowieka + Michała.
