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

1. Otwórz **Harmonogram zadań** (wpisz w wyszukiwarce Windows: "Harmonogram
   zadań" / "Task Scheduler").
2. Po prawej: **Utwórz zadanie podstawowe...** (Create Basic Task).
3. Nazwa: `Savpol WZ`. Dalej.
4. Wyzwalacz: **Codziennie** (Daily). Dalej. Ustaw godzinę startu np. **08:00**.
   Dalej.
5. Akcja: **Uruchom program** (Start a program). Dalej.
6. **Program/skrypt**: wskaż plik
   `C:\savpol-automatyzacje\automatyzacje\wz\serwer\uruchom.bat`
   (przycisk "Przeglądaj").
7. Zakończ (Finish).
8. Teraz znajdź to zadanie na liście, kliknij **Właściwości** (Properties):
   - Zakładka **Wyzwalacze** (Triggers) → edytuj wyzwalacz → zaznacz
     **"Powtarzaj zadanie co"** (Repeat task every): **1 godzinę**, **przez
     czas trwania** (for a duration of): **9 godzin** (żeby łapało okno
     8:00–17:00).
   - Ta sama zakładka: **Zaawansowane ustawienia harmonogramu** — jeśli jest
     opcja dni tygodnia, zaznacz **tylko dni robocze (Pon–Pt)**. Jeśli
     kreator dawał tylko "Codziennie" bez wyboru dni — nie szkodzi, skrypt
     **sam odmawia startu w weekend** (ma to wpisane w kodzie), więc
     ewentualne odpalenie w sobotę/niedzielę i tak nic nie zrobi.
   - Zakładka **Ogólne** (General): zaznacz **"Uruchom niezależnie od tego,
     czy użytkownik jest zalogowany"** (Run whether user is logged on or
     not) — inaczej zadanie nie odpali się, gdy nikt nie jest zalogowany na
     ten komputer.
9. Zapisz (OK) — może zapytać o hasło konta Windows, na którym to ma działać.

**To wszystko.** Zadanie będzie się teraz odpalać samo, co godzinę między
8:00 i 17:00, w dni robocze — sam skrypt dodatkowo odmawia pracy poza
7:00–17:00 i w weekendy, nawet gdyby coś poszło nie tak z harmonogramem.

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
