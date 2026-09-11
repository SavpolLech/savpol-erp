# Automatyzacja WZ — instrukcja wdrożenia na serwerze

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
2. **Token name**: np. `savpol-erp-serwer-wz`
3. **Expiration**: ustaw najdłuższe możliwe (albo "No expiration", jeśli
   dostępne) — to token do stałej, ciągłej automatyzacji, nie do jednorazowego
   użytku. Zapisz sobie w kalendarzu przypomnienie na wygaśnięcie, jeśli
   GitHub wymusi jakąś datę.
4. **Repository access** → "Only select repositories" → wybierz
   `SavpolLech/savpol-erp`.
5. **Permissions** → "Repository permissions" → **Contents: Read and write**
   (musi być "Read **and write**", nie tylko "Read" — serwer sam commituje
   dziennik przebiegów z powrotem do repo, patrz `lib/git-log-push.js`).
6. Wygeneruj, skopiuj token (zaczyna się od `github_pat_...`) — GitHub pokaże
   go tylko raz.

### 1.2 Wklej token do `pierwsza-instalacja.bat`

Otwórz lokalnie `automatyzacje/wz/serwer/pierwsza-instalacja.bat`, znajdź linię:

```
set REPO_URL=https://WKLEJ_TUTAJ_TOKEN@github.com/SavpolLech/savpol-erp.git
```

Zamień `WKLEJ_TUTAJ_TOKEN` na wygenerowany token. **Nie commituj tej zmiany
do repo** — to jest sekret, wyślij ten JEDEN zmodyfikowany plik Tomkowi
osobno (mail, dysk sieciowy — nie przez git).

### 1.3 Co wysłać Tomkowi

- Zmodyfikowany (z tokenem) `pierwsza-instalacja.bat`
- Ten plik (`INSTRUKCJA-TOMEK.md`)
- Dane dostępowe do bazy MSSQL i do konta ERP (osobnym, bezpiecznym kanałem —
  Tomek wpisze je do `.env` w kroku 2.4)

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
(instalacja `npm install` i pobranie przeglądarki mogą potrwać kilka minut).

Na końcu skrypt powie Ci dokładnie, co dalej. Chodzi o dwie rzeczy:

**a) Wypełnij plik `.env`**

Skrypt stworzy plik:

```
C:\savpol-automatyzacje\automatyzacje\wz\.env
```

Otwórz go Notatnikiem i wpisz prawdziwe wartości (dostaniesz je od Lecha
osobno), np.:

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

To zadanie odpala się **tylko raz dziennie, o 7:00** — cały dzień pracy
(sesje scrapowania, przerwy między nimi, koniec o 17:00) obsługuje sam plik
`uruchom.bat` w jednej, długo działającej pętli. Nie trzeba ustawiać
"powtarzaj co godzinę".

1. Otwórz **Harmonogram zadań** (wpisz w wyszukiwarce Windows: "Harmonogram
   zadań" / "Task Scheduler").
2. Po prawej: **Utwórz zadanie** (Create Task) — **nie** "zadanie
   podstawowe", żeby mieć dostęp do wszystkich zakładek na starcie.
3. Zakładka **Ogólne** (General):
   - Nazwa: `Savpol WZ`.
   - Zaznacz **"Uruchom niezależnie od tego, czy użytkownik jest
     zalogowany"** (Run whether user is logged on or not) — inaczej zadanie
     nie odpali się, gdy nikt nie jest zalogowany na ten komputer.
4. Zakładka **Wyzwalacze** (Triggers) → **Nowy...** (New):
   - Zaczynaj zadanie: **Cotygodniowo** (Weekly).
   - Godzina startu: **7:00:00**.
   - Zaznacz dni: **poniedziałek, wtorek, środa, czwartek, piątek** (bez
     soboty i niedzieli).
   - Powtarzanie zadania **wyłączone** (to zadanie odpala się raz na dzień
     roboczy — pętlę wewnątrz dnia robi sam skrypt).
5. Zakładka **Akcje** (Actions) → **Nowa...** (New) → Uruchom program (Start
   a program) → **Program/skrypt**: wskaż plik
   `C:\savpol-automatyzacje\automatyzacje\wz\serwer\uruchom.bat`
   (przycisk "Przeglądaj").
6. Zakładka **Ustawienia** (Settings):
   - Zaznacz **"Zatrzymaj zadanie, jeśli działa dłużej niż"** (Stop the task
     if it runs longer than): **10 godzin**. To siatka bezpieczeństwa — gdyby
     coś się zawiesiło (np. ERP nie odpowiada), zadanie i tak zakończy się
     same, zamiast wisieć do rana.
   - **"Jeśli zadanie już działa"** (If the task is already running):
     **"Nie uruchamiaj nowej kopii"** (Do not start a new instance) —
     zwykle jest to domyślne ustawienie, tylko sprawdź.
7. Zapisz (OK) — może zapytać o hasło konta Windows, na którym to ma działać.

**To wszystko.** Zadanie odpali się raz, o 7:00, w dni robocze. Sam plik
`uruchom.bat` czeka najpierw losowo 0–15 minut (żeby logowanie do ERP nie
wypadało zawsze punktualnie o 7:00), potem wykonuje sesje scrapowania jedna
po drugiej z losowymi przerwami 5–15 minut między nimi. Godzina 17:00 jest
sprawdzana tylko przed **rozpoczęciem kolejnej** sesji, nie w jej trakcie —
sesja, która już trwa o 17:00, kończy się normalnie (tak jak pracownik,
który czasem zostaje odrobinę dłużej, a nie przerywa pracę w połowie).
`scrape.js` dodatkowo sam odmawia **zaczęcia nowej** sesji poza 7:00–17:00 i
w weekendy, niezależnie od tego wszystkiego — nawet gdyby coś było źle
skonfigurowane w Harmonogramie.

Każda sesja jest dodatkowo odpalana przez `odpal-z-timeoutem.ps1` z limitem
75 minut — jeśli sesja się zawiesi (np. ERP przestanie odpowiadać), zostaje
sama automatycznie ubita, a pętla po przerwie startuje kolejną, świeżą
sesję. Kolejna sesja sama wznawia pracę tam, gdzie skończyła poprzednia
(zapisany postęp w `state/`) — nic nie trzeba robić ręcznie po zawieszeniu.
Do tego dochodzi jeszcze ten dzienny limit 10 godzin z kroku 6 wyżej, jako
druga, grubsza siatka bezpieczeństwa na wypadek, gdyby coś zawiesiło się w
samej pętli, a nie w pojedynczej sesji.

### 2.5 Aktualizacje kodu — nic nie musisz robić

Kiedy Lech poprawi coś w skrypcie albo doda nowy typ dokumentu, sam
`uruchom.bat` na początku każdego przebiegu robi `git pull` — najnowsza
wersja kodu pojawi się na serwerze automatycznie, przy najbliższym
zaplanowanym uruchomieniu. Nie musisz nic klikać, aktualizować, pobierać
niczego ręcznie.

### 2.6 Jak sprawdzić, czy działa

Najprościej: zapytaj Lecha — automatyzacja sama zapisuje log każdego
przebiegu z powrotem do repozytorium (`run-log.jsonl`), on widzi to bez
dostępu do tego serwera. Jeśli chcesz sam zerknąć: w Harmonogramie Zadań,
zakładka **Historia** (History) dla zadania `Savpol WZ` pokazuje, kiedy się
odpaliło i czy zakończyło się bez błędu (kod 0).
