# Automatyzacja scraperów ERP (WZ + MM + PZ) — wdrożenie na serwerze

Jeden orkiestrator, który raz dziennie ściąga z ERP dokumenty WZ, MM i PZ —
**po kolei, nigdy równolegle** (ERP znosi tylko jedną sesję logowania naraz) —
i zapisuje je wprost do bazy produkcyjnej.

Dwie części: co robi **Lech** zanim wyśle pliki, i co robi **Tomek** na serwerze.
Tomek nie musi nic wiedzieć o GitHubie — jego kroki to instalacja dwóch
programów, jedno kliknięcie, wypełnienie jednego pliku tekstowego i
zarejestrowanie jednego zadania w Harmonogramie Zadań.

---

## Część 1 — Lech, ZANIM wyślesz to Tomkowi

### 1.1 Wygeneruj token dostępu do repo (jednorazowo)

To repo jest prywatne, ale Tomek nie ma (i nie musi mieć) własnego konta
GitHub — dajemy mu token, który działa jak "hasło tylko do tego jednego
repo", wpisane raz, na zawsze w plikach na serwerze.

1. Wejdź na: https://github.com/settings/personal-access-tokens/new
2. **Token name**: np. `savpol-erp-serwer-scrapery`
3. **Expiration**: ustaw najdłuższe możliwe (albo "No expiration", jeśli
   dostępne) — to token do stałej, ciągłej automatyzacji. Zapisz sobie
   przypomnienie na wygaśnięcie, jeśli GitHub wymusi jakąś datę.
4. **Repository access** → "Only select repositories" → wybierz
   `SavpolLech/savpol-erp`.
5. **Permissions** → "Repository permissions" → **Contents: Read and write**
   (musi być "Read **and write**", nie tylko "Read" — serwer sam commituje
   dziennik przebiegów z powrotem do repo, patrz `lib-wspolne/git-log-push.js`).
6. Wygeneruj, skopiuj token (zaczyna się od `github_pat_...`) — GitHub pokaże
   go tylko raz.

### 1.2 Wklej token do `pierwsza-instalacja.bat`

Wersja w repo ma **placeholder** `WKLEJ_TUTAJ_TOKEN` — nigdy nie trzymamy tam
prawdziwego tokenu. Prawdziwą kopię z wklejonym tokenem utrzymujesz ręcznie na
dysku sieciowym (`H:\Smietnik\Kod dla Tomka Kuboszka`). Otwórz tamtą kopię,
znajdź linię:

```
set REPO_URL=https://WKLEJ_TUTAJ_TOKEN@github.com/SavpolLech/savpol-erp.git
```

Zamień `WKLEJ_TUTAJ_TOKEN` na wygenerowany token. **Nie commituj tej zmiany
do repo** — to sekret, wyślij ten JEDEN zmodyfikowany plik Tomkowi osobno.

### 1.3 Co wysłać Tomkowi

- Zmodyfikowany (z tokenem) `pierwsza-instalacja.bat`
- Ten plik (`INSTRUKCJA-TOMEK.md`)
- Dane dostępowe do bazy MSSQL i do konta ERP (osobnym, bezpiecznym kanałem —
  Tomek wpisze je do jednego wspólnego `.env` w kroku 2.4)

---

## Część 2 — Tomek, na serwerze

### 2.1 Zainstaluj Node.js

- https://nodejs.org — pobierz wersję **LTS**, zainstaluj (Dalej → Dalej →
  Zakończ, domyślne ustawienia są OK).

### 2.2 Zainstaluj Git for Windows

- https://git-scm.com/download/win — pobierz, zainstaluj (Dalej → Dalej →
  Zakończ, domyślne ustawienia są OK).

### 2.3 Zaloguj się ponownie (albo zrestartuj)

Po instalacji obu programów wyloguj się i zaloguj ponownie (albo zrestartuj
komputer) — Windows musi "zobaczyć" nowo dodane programy.

### 2.4 Odpal `pierwsza-instalacja.bat`

Dwuklik na plik, który dostałeś od Lecha. Pojawi się czarne okno konsoli —
to normalne, poczekaj aż się zamknie samo albo pokaże komunikat na końcu
(instalacja zależności dla trzech scraperów i pobranie przeglądarki mogą
potrwać kilka minut).

Na końcu skrypt powie Ci dokładnie, co dalej. Chodzi o dwie rzeczy:

**a) Wypełnij JEDEN wspólny plik `.env`**

Skrypt stworzy plik:

```
C:\savpol-automatyzacje\automatyzacje\.env
```

To jeden wspólny plik dla WZ, MM i PZ. Otwórz go Notatnikiem i wpisz prawdziwe
wartości (dostaniesz je od Lecha osobno), np.:

```
DB_HOST=...
DB_PORT=1433
DB_USER=...
DB_PASSWORD=...
DB_NAME=worek

ERP_LOGIN=...
ERP_PASSWORD=...
```

Zapisz plik.

**b) Zarejestruj zadanie w Harmonogramie Zadań Windows**

To zadanie odpala się **raz dziennie, w dni robocze (pon-pt), o 9:30**. Jeden
przebieg nadgania po kolei WZ, MM i PZ — dobiera każdy niekompletny dzień z
okna wstecz, więc poniedziałkowy bieg sam uzupełnia piątek, sobotę i niedzielę
(w weekend też powstają pojedyncze dokumenty). Nie trzeba ustawiać
"powtarzaj co godzinę" ani triggera weekendowego.

1. Otwórz **Harmonogram zadań** (wpisz w wyszukiwarce Windows: "Harmonogram
   zadań" / "Task Scheduler").
2. Po prawej: **Utwórz zadanie** (Create Task) — **nie** "zadanie
   podstawowe", żeby mieć dostęp do wszystkich zakładek na starcie.
3. Zakładka **Ogólne** (General):
   - Nazwa: `Savpol Scrapery ERP`.
   - Zaznacz **"Uruchom niezależnie od tego, czy użytkownik jest
     zalogowany"** (Run whether user is logged on or not) — serwer jest
     headless, ma pracować także gdy nikt nie jest zalogowany. Windows zapyta
     o hasło konta, na którym zadanie ma działać.
4. Zakładka **Wyzwalacze** (Triggers) → **Nowy...** (New):
   - Zaczynaj zadanie: **Cotygodniowo** (Weekly).
   - Godzina startu: **9:30:00**.
   - Zaznacz dni: **poniedziałek, wtorek, środa, czwartek, piątek** (bez
     soboty i niedzieli — weekend dobiera poniedziałkowy bieg dzięki oknu
     wstecz).
   - Powtarzanie zadania w ciągu dnia **wyłączone**.
5. Zakładka **Akcje** (Actions) → **Nowa...** (New) → Uruchom program (Start
   a program) → **Program/skrypt**: wskaż plik
   `C:\savpol-automatyzacje\automatyzacje\wz\serwer\uruchom.bat`
   (przycisk "Przeglądaj").
6. Zakładka **Ustawienia** (Settings):
   - Zaznacz **"Uruchom zadanie tak szybko, jak to możliwe, jeśli
     zaplanowane uruchomienie zostanie pominięte"** (Run task as soon as
     possible after a scheduled start is missed) — jeśli serwer był
     wyłączony o 9:30, bieg odpali się przy najbliższej okazji (nadrabianie).
   - Zaznacz **"Zatrzymaj zadanie, jeśli działa dłużej niż"** (Stop the task
     if it runs longer than): **10 godzin**. Siatka bezpieczeństwa — gdyby
     coś się zawiesiło mimo wewnętrznych limitów, zadanie i tak zakończy się
     samo.
   - **"Jeśli zadanie już działa"** (If the task is already running):
     **"Nie uruchamiaj nowej kopii"** (Do not start a new instance).
7. Zapisz (OK).

**To wszystko.** Zadanie odpali się raz, o 9:30, w dni robocze. `uruchom.bat`
zrobi `git pull` (najnowszy kod) i uruchomi orkiestrator
`automatyzacje\dobij-wszystko.js`, który przechodzi typy **po kolei**
(WZ → MM → PZ) i dla każdego dobija niekompletne dni do końca, dopiero potem
przechodzi do następnego. Dwa scrapery nigdy nie wchodzą na ERP naraz —
pilnuje tego dodatkowo globalna blokada `automatyzacje\.scrapery.lock`.

Pojedyncza sesja scrapowania ma wewnętrzny limit 75 minut — jeśli się
zawiesi (np. ERP przestanie odpowiadać), jest sama ubijana, a orkiestrator
startuje kolejną, świeżą sesję, która wznawia pracę tam, gdzie skończyła
poprzednia (zapisany postęp w `state/`). Dzienny limit 10 godzin z kroku 6 to
druga, grubsza siatka bezpieczeństwa.

### 2.5 Aktualizacje kodu — nic nie musisz robić

Kiedy Lech poprawi coś w skryptach albo doda nowy typ dokumentu, sam
`uruchom.bat` na początku każdego przebiegu robi `git pull` — najnowsza
wersja kodu pojawi się na serwerze automatycznie, przy najbliższym
zaplanowanym uruchomieniu. Nie musisz nic klikać ani pobierać ręcznie.

### 2.6 Jak sprawdzić, czy działa

Najprościej: zapytaj Lecha — automatyzacja sama zapisuje log każdego
przebiegu z powrotem do repozytorium (`run-log.jsonl` w katalogu każdego
scrapera), on widzi to bez dostępu do serwera. Jeśli chcesz sam zerknąć: w
Harmonogramie Zadań, zakładka **Historia** (History) dla zadania
`Savpol Scrapery ERP` pokazuje, kiedy się odpaliło i czy zakończyło się bez
błędu.

### 2.7 Ręczne dobicie brakującego dnia (Tomek / Michał)

Czasem ERP pokazuje dla jakiegoś dnia więcej dokumentów niż jest w bazie
(worku) — np. ERP: 800 WZ, worek: 780. Nie trzeba pisać do Lecha, można
dobrać brakujące samemu:

1. Wejdź do folderu `C:\savpol-automatyzacje\automatyzacje\wz\serwer\`.
2. Dwuklik na **`dobij-dzien.bat`**.
3. Wpisz, o co chodzi: typ (`wz`, `mm` albo `pz`) i datę (`RRRR-MM-DD`).
4. Tryb: naciśnij **Enter** (szybki — dobiera brakujące). Jeśli szybki nie
   pomógł (w worku dalej jest mniej niż w ERP), odpal jeszcze raz i wybierz
   **`p`** (pełny — przeklikuje dzień od zera).

To jest bezpieczne o każdej porze: bierze tę samą blokadę co codzienny automat,
więc nigdy nie wejdzie na ERP równolegle (gdyby akurat trwał inny bieg, po
prostu wypisze „inny bieg trwa" i wyjdzie — spróbuj później). Dokumenty, które
już są w bazie, nie zostaną zdublowane — dopisywane są tylko brakujące.

### 2.8 Doscrapowanie brakujących produktów po ID (Michał)

Gdy Michał przyśle listę identyfikatorów (ID) brakujących produktów (kartotek,
których nie ma jeszcze w bazie), można je dociągnąć samemu:

1. Wklej ID (jeden pod drugim albo po przecinku) do pliku
   `C:\savpol-automatyzacje\automatyzacje\produkty\lista-id.txt`.
2. Dwuklik na **`dobij-produkty-po-id.bat`** (w tym samym folderze `serwer\`).
   Za pierwszym razem, jeśli pliku nie ma, skrypt utworzy go i otworzy w
   Notatniku — wklej ID, zapisz i odpal `.bat` ponownie.

Skrypt sam zescrapuje te produkty i zapisze je do bazy produkcyjnej. Jest
bezpieczny: bierze tę samą blokadę co reszta (nie wejdzie na ERP równolegle),
a produkty już obecne w bazie pomija.
