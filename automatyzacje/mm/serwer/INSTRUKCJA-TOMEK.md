# Automatyzacja MM (przesunięcia magazynowe) — instrukcja wdrożenia na serwerze

Procedura jest **identyczna jak dla WZ** (`automatyzacje/wz/serwer/INSTRUKCJA-TOMEK.md`)
— ten sam serwer, ten sam token dostępu do repo, ten sam Node.js + Git.
Poniżej tylko to, co się różni dla MM.

---

## Jeśli WZ już działa na tym serwerze

Kod MM jest w **tym samym repozytorium** (folder `C:\savpol-automatyzacje`),
więc **nie klonujesz niczego drugi raz** i **nie instalujesz Node/Git jeszcze
raz**. Robisz tylko dwie rzeczy:

1. **Nie musisz nic wpisywać, jeśli działa już wspólny `.env`.** Dane logowania
   (baza + ERP) są w JEDNYM pliku `C:\savpol-automatyzacje\automatyzacje\.env`,
   z którego korzystają wszystkie automatyzacje (WZ, MM, produkty). Jeśli WZ już
   działa, ten plik jest wypełniony — MM go po prostu użyje, nic nie kopiujesz.

   (Gdyby wspólnego pliku jeszcze nie było, utwórz go raz:
   `copy C:\savpol-automatyzacje\automatyzacje\.env.example C:\savpol-automatyzacje\automatyzacje\.env`
   i wpisz dane od Lecha. Osobny `automatyzacje\mm\.env` twórz TYLKO, gdy MM ma
   mieć inne dane niż reszta.)

2. **Zarejestruj OSOBNE zadanie** w Harmonogramie Zadań — tak samo jak dla WZ,
   ale:
   - Nazwa: **`Savpol MM`** (żeby nie mylić z `Savpol WZ`).
   - Akcja → Program/skrypt:
     `C:\savpol-automatyzacje\automatyzacje\mm\serwer\uruchom.bat`
   - Godzina startu: ustaw **inną niż WZ** (np. WZ o 7:00, MM o 7:30) — żeby dwa
     przebiegi nie logowały się do ERP w tej samej sekundzie. Każdy z nich i tak
     dokłada losowe 0–15 min opóźnienia, ale różny start to dodatkowy margines.
   - Reszta zakładek (Wyzwalacze: dni robocze; Ustawienia: stop po 10 h, „nie
     uruchamiaj nowej kopii") — jak w instrukcji WZ.

To wszystko. `uruchom.bat` z folderu `mm` sam robi `git pull`, odświeża schemat
i puszcza sesje scrapowania w pętli do 17:00, dokładnie jak wersja WZ.

---

## Jeśli to czysty serwer (WZ jeszcze nie ma)

Wtedy odpalasz `pierwsza-instalacja.bat` z folderu `mm` (dwuklik) — sklonuje
repo, zainstaluje zależności i Chromium, stworzy szablon `.env`. Dalej: wypełnij
`.env` (dane od Lecha) i zarejestruj zadanie `Savpol MM` wskazujące na
`serwer\uruchom.bat`. Szczegóły krok po kroku (instalacja Node/Git, token do
repo, zakładki Harmonogramu) — patrz pełna instrukcja WZ:
`automatyzacje/wz/serwer/INSTRUKCJA-TOMEK.md`.

## Jak sprawdzić, czy działa

Tak samo jak przy WZ: automatyzacja sama zapisuje log każdego przebiegu z
powrotem do repo (`automatyzacje/mm/run-log.jsonl`) — Lech widzi to bez dostępu
do serwera. Lokalnie: Harmonogram Zadań → zadanie `Savpol MM` → zakładka
**Historia**.
