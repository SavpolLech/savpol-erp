# Automatyzacja scraperów ERP — instalacja na serwerze

Jeden automat, który raz dziennie ściąga z ERP dokumenty (WZ, MM, PZ) — po
kolei, nigdy równolegle — i zapisuje je do bazy. Instalacja to: dwa programy,
jedno kliknięcie, wypełnienie jednego pliku tekstowego i zarejestrowanie
jednego zadania w Harmonogramie Zadań.

Do instalacji potrzebujesz (dostaniesz od Lecha):
- pliku `pierwsza-instalacja.bat` (z wpisanym już dostępem do repo),
- danych dostępowych do bazy MSSQL i do konta ERP.

Jak korzystać z gotowego automatu (ręczne dobicie dnia, doscrapowanie
produktów) — patrz **`OBSLUGA.md`**.

---

## 1. Zainstaluj Node.js

https://nodejs.org — pobierz wersję **LTS**, zainstaluj (Dalej → Dalej →
Zakończ, domyślne ustawienia są OK).

## 2. Zainstaluj Git for Windows

https://git-scm.com/download/win — pobierz, zainstaluj (Dalej → Dalej →
Zakończ, domyślne ustawienia są OK).

## 3. Zaloguj się ponownie (albo zrestartuj)

Po instalacji obu programów wyloguj się i zaloguj ponownie (albo zrestartuj
komputer) — Windows musi „zobaczyć" nowo dodane programy.

## 4. Odpal `pierwsza-instalacja.bat`

Dwuklik na plik. Pojawi się czarne okno konsoli — to normalne, poczekaj aż się
zamknie samo albo pokaże komunikat na końcu (instalacja zależności i pobranie
przeglądarki mogą potrwać kilka minut).

Na końcu skrypt powie, co dalej — chodzi o dwie rzeczy (5 i 6 niżej).

## 5. Wypełnij plik `.env`

Skrypt stworzy plik:

```
C:\savpol-automatyzacje\automatyzacje\.env
```

To jeden wspólny plik dla wszystkich scraperów. Otwórz go Notatnikiem i wpisz
prawdziwe wartości (dostaniesz je od Lecha), np.:

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

## 6. Zarejestruj zadanie w Harmonogramie Zadań Windows

Zadanie odpala się **raz dziennie, w dni robocze (pon–pt), o 9:30**. Jeden
przebieg nadgania po kolei WZ, MM i PZ — dobiera każdy niekompletny dzień z
okna wstecz, więc poniedziałkowy bieg sam uzupełnia piątek, sobotę i niedzielę
(w weekend też powstają pojedyncze dokumenty). Nie trzeba ustawiać „powtarzaj
co godzinę" ani triggera weekendowego.

1. Otwórz **Harmonogram zadań** (wpisz w wyszukiwarce Windows: „Harmonogram
   zadań" / „Task Scheduler").
2. Po prawej: **Utwórz zadanie** (Create Task) — **nie** „zadanie podstawowe",
   żeby mieć dostęp do wszystkich zakładek na starcie.
3. Zakładka **Ogólne** (General):
   - Nazwa: `Savpol Scrapery ERP`.
   - Zaznacz **„Uruchom niezależnie od tego, czy użytkownik jest zalogowany"**
     (Run whether user is logged on or not) — serwer jest headless, ma
     pracować także gdy nikt nie jest zalogowany. Windows zapyta o hasło konta,
     na którym zadanie ma działać.
4. Zakładka **Wyzwalacze** (Triggers) → **Nowy...** (New):
   - Zaczynaj zadanie: **Cotygodniowo** (Weekly).
   - Godzina startu: **9:30:00**.
   - Zaznacz dni: **poniedziałek, wtorek, środa, czwartek, piątek** (bez soboty
     i niedzieli — weekend dobiera poniedziałkowy bieg dzięki oknu wstecz).
   - Powtarzanie zadania w ciągu dnia **wyłączone**.
5. Zakładka **Akcje** (Actions) → **Nowa...** (New) → Uruchom program (Start a
   program) → **Program/skrypt**: wskaż plik
   `C:\savpol-automatyzacje\automatyzacje\wz\serwer\uruchom.bat`
   (przycisk „Przeglądaj").
6. Zakładka **Ustawienia** (Settings):
   - Zaznacz **„Uruchom zadanie tak szybko, jak to możliwe, jeśli zaplanowane
     uruchomienie zostanie pominięte"** (Run task as soon as possible after a
     scheduled start is missed) — jeśli serwer był wyłączony o 9:30, bieg
     odpali się przy najbliższej okazji (nadrabianie).
   - Zaznacz **„Zatrzymaj zadanie, jeśli działa dłużej niż"** (Stop the task if
     it runs longer than): **10 godzin**. Siatka bezpieczeństwa — gdyby coś się
     zawiesiło mimo wewnętrznych limitów, zadanie i tak zakończy się samo.
   - **„Jeśli zadanie już działa"** (If the task is already running): **„Nie
     uruchamiaj nowej kopii"** (Do not start a new instance).
7. Zapisz (OK).

**To wszystko.** Zadanie odpali się raz, o 9:30, w dni robocze. `uruchom.bat`
zrobi `git pull` (najnowszy kod) i uruchomi automat, który przechodzi typy
**po kolei** (WZ → MM → PZ) i dla każdego dobija niekompletne dni do końca,
dopiero potem przechodzi do następnego. Dwa scrapery nigdy nie wchodzą na ERP
naraz — pilnuje tego globalna blokada `automatyzacje\.scrapery.lock`.

Pojedyncza sesja scrapowania ma wewnętrzny limit 75 minut — jeśli się zawiesi
(np. ERP przestanie odpowiadać), jest sama ubijana, a automat startuje kolejną,
świeżą sesję, która wznawia pracę tam, gdzie skończyła poprzednia (zapisany
postęp w `state/`). Dzienny limit 10 godzin z kroku 6 to druga, grubsza siatka
bezpieczeństwa.

## 7. Aktualizacje kodu — nic nie trzeba robić

`uruchom.bat` na początku każdego przebiegu robi `git pull` — najnowsza wersja
kodu pojawi się na serwerze automatycznie, przy najbliższym uruchomieniu. Nic
nie trzeba klikać ani pobierać ręcznie.
