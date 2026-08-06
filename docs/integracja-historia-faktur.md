# Historia faktur z ERP → repo `esavpol-pdp`

Instrukcja do wykonania **w repozytorium `SavpolLech/esavpol-pdp`**. Druga
strona integracji (userscript w `SavpolLech/savpol-erp`) jest opisana na końcu —
tam zmiany zrobi osobna sesja, ta instrukcja niczego w tamtym repo nie wymaga.

## Po co to

Skrypt `savpol-historia-faktur.user.js` scrapuje z ERP historię faktur produktu
(do 100 dokumentów od stycznia 2024), liczy co-occurrence i typuje SKU do
cross-sellingu. Dotąd historia lądowała jako CSV w Pobranych operatora i ginęła.

Nad opisami pracują równolegle trzy osoby. Bez wspólnego miejsca nie da się
odpowiedzieć na dwa pytania: **które produkty są już zrobione** i **na jakich
danych powstała dana rekomendacja**. Repo `esavpol-pdp` jest prywatne i już
teraz służy jako baza (`lib/github-commit.ts` commituje przez Octokit), więc
historia trafia tam, gdzie reszta dorobku.

## Dlaczego przez apkę, a nie prosto z przeglądarki

Userscript mógłby commitować sam, ale wtedy **PAT z prawem zapisu leżałby
w Tampermonkey na każdym komputerze**, gdzie skrypt działa. Apka ma już token
po stronie serwera (`GITHUB_PAT`) i sprawdzoną ścieżkę zapisu, więc token
zostaje tam, gdzie jego miejsce.

Wysyłka jest **same-origin**: userscript dostanie `@match` na domenę generatora
i wyśle dane dopiero z jego strony, gdzie i tak ląduje po kliknięciu „Otwórz
generator PDP". Dzięki temu nie ma CORS-a ani preflightu, a ciasteczko `mkt_auth`
jedzie automatycznie.

## Do zrobienia: `POST /api/invoice-history`

Nowy plik `app/api/invoice-history/route.ts`.

### Kontrakt

Żądanie:

```jsonc
{
  "sku": "0031018",              // anchor, 6-8 cyfr, opcjonalnie -X na końcu
  "csv": "Numer dokumentu;Produkt;SKU;Ilość\n\"FS/1234/2025\";\"Krem…\";\"0020669\";\"6\"\n…",
  "meta": {
    "invoices": 87,              // ile faktur weszło do próby (N)
    "partial": false,            // czy przebieg został przerwany
    "unverified": false,         // czy filtr dostępności padł (brak weryfikacji w katalogu)
    "candidates": ["0020669", "0006418", "0003863", "0005105"],
    "scriptVersion": "2.14.0",
    "collectedAt": "2026-08-06T09:12:44.000Z"
  }
}
```

Odpowiedź `200`:

```jsonc
{ "ok": true, "path": "pages/_kit/cross-sell/historia/0031018.csv", "commit": "<sha>" }
```

Kody błędów: `401` brak/nieważne ciasteczko, `400` zły `sku` lub pusty `csv`,
`413` payload ponad limit, `502` błąd GitHuba. Zawsze `{ ok: false, error: "…" }`.

### Uwierzytelnienie

To samo, co reszta apki. Sprawdź ciasteczko `mkt_auth` przeciwko
`expectedAuthToken()` z `lib/auth.ts`.

**Uwaga:** `proxy.ts` przy braku ciasteczka **przekierowuje na `/login`** (303).
Dla `fetch` z userscriptu redirect na HTML jest bezużyteczny — dopisz
`/api/invoice-history` do wyjątków w `config.matcher` i zrób kontrolę wewnątrz
route'a, zwracając czyste `401 { ok: false, error: "unauthorized" }`. Inaczej
skrypt dostanie 200 ze stroną logowania i uzna wysyłkę za udaną.

### Zapis

Ścieżka: `pages/_kit/cross-sell/historia/<SKU>.csv`.

**Jeden plik na produkt — to jest istotne, nie kosmetyczne.** `appendSkusJsonl`
(`lib/github-commit.ts:47-95`) robi read-modify-write bez blokady, więc dwa
nakładające się przebiegi potrafią zgubić wpisy jednego z nich. Osobny plik na
SKU nie ma tego problemu: dwie osoby nigdy nie piszą do tego samego pliku.
(Sam wyścig w `skus.jsonl` istnieje niezależnie od tej integracji i wart jest
osobnego zgłoszenia.)

Do zapisu użyj istniejącego `upsertFile` z `lib/github-commit.ts` — obsługuje
już `sha` istniejącego pliku, więc nadpisanie ponownego przebiegu zadziała bez
dodatkowej logiki.

Nagłówek pliku niech niesie metadane jako komentarze przed CSV, żeby dało się
je odczytać bez osobnego indeksu:

```
# sku=0031018 invoices=87 partial=false unverified=false
# candidates=0020669,0006418,0003863,0005105
# script=2.14.0 collected=2026-08-06T09:12:44.000Z
Numer dokumentu;Produkt;SKU;Ilość
"FS/1234/2025";"Krem…";"0020669";"6"
```

Wiadomość commita: `Historia faktur <SKU> (<N> faktur)`.

### Walidacja

- `sku` musi pasować do `/^[0-9]{6,8}(-[A-Z])?$/` — ten sam wzorzec, którym
  userscript odsiewa pozycje nie będące produktami (usługi kurierskie).
  Wartość wchodzi do ścieżki pliku, więc bez walidacji jest to path traversal.
- `csv` — odrzuć puste i ponad ~2 MB. Realnie 100 faktur to kilkadziesiąt kB,
  a Vercel i tak tnie ciało żądania w okolicach 4,5 MB.
- `runtime = "nodejs"` (Octokit nie działa na edge).

## Do zrobienia: `GET /api/invoice-history?sku=…`

Drobiazg, ale to on rozwiązuje problem trzech osób pracujących równolegle.
Zwraca, czy historia dla SKU już istnieje:

```jsonc
{ "ok": true, "exists": true, "invoices": 87, "collectedAt": "2026-08-06T09:12:44.000Z" }
```

Userscript zapyta o to **przed** startem przebiegu i powie operatorowi „ten
produkt zrobiła już inna osoba, 87 faktur, 6 sierpnia" — zamiast mielić trzy
minuty po raz drugi. Czytaj przez `repos.getContent`; `404` z GitHuba to
`{ ok: true, exists: false }`, nie błąd.

## Czego NIE robić

- **Nie dopisuj historii do `skus.jsonl`.** Ten plik trzyma karty produktów do
  cross-sellingu, ma inny cykl życia i jest już obciążony wyścigiem zapisu.
- **Nie rób wspólnego pliku indeksu** (`historia/index.csv` itp.). Wróciłby
  dokładnie ten sam konflikt. Zestawienie, gdy będzie potrzebne, generuje się
  skryptem z listy plików w katalogu.
- **Nie przyjmuj `path` ani nazwy pliku z żądania.** Ścieżkę składa serwer z
  zwalidowanego `sku`.

## Druga strona: co zrobi `savpol-erp`

Dla kontekstu — w tamtym repo dojdzie:

1. `@match` na domenę generatora (dziś skrypt matchuje `erp.savpol.pl`
   i `esavpol.pl`).
2. Odłożenie historii i metadanych w `GM_setValue` na koniec przebiegu.
3. Po otwarciu generatora — same-origin `fetch('/api/invoice-history', {
   method: 'POST', credentials: 'include' })` i wyczyszczenie storage po `200`.
4. Zapytanie `GET` przed startem przebiegu i komunikat, gdy produkt jest już
   zrobiony.

Skrypt nie potrzebuje żadnego tokena ani zmiennej środowiskowej.

## Jak sprawdzić, że działa

1. `POST` curl-em z ciasteczkiem `mkt_auth` — plik pojawia się w repo,
   odpowiedź niesie sha commita.
2. Ten sam `POST` drugi raz — plik nadpisany, bez błędu `sha mismatch`.
3. `POST` bez ciasteczka — czyste `401` JSON-em, **nie** HTML strony logowania.
4. `sku=../../etc` — `400`, żaden plik nie powstaje.
5. `GET` dla nieistniejącego SKU — `{ ok: true, exists: false }`.
