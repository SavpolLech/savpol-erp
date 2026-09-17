# Automatyzacja PZ (przyjęcia zewnętrzne) — instrukcja wdrożenia na serwerze

Procedura jest **identyczna jak dla WZ** (`automatyzacje/wz/serwer/INSTRUKCJA-TOMEK.md`)
— ten sam serwer, ten sam token dostępu do repo, ten sam Node.js + Git.
Poniżej tylko to, co się różni dla PZ.

---

## Jeśli WZ/MM już działa na tym serwerze

Kod PZ jest w **tym samym repozytorium** (folder `C:\savpol-automatyzacje`),
więc **nie klonujesz niczego drugi raz** i **nie instalujesz Node/Git jeszcze
raz**. Robisz tylko dwie rzeczy:

1. **Nie musisz nic wpisywać, jeśli działa już wspólny `.env`.** Dane logowania
   (baza + ERP) są w JEDNYM pliku `C:\savpol-automatyzacje\automatyzacje\.env`,
   z którego korzystają wszystkie automatyzacje (WZ, MM, PZ, produkty). Jeśli
   WZ/MM już działa, ten plik jest wypełniony — PZ go po prostu użyje.

   (Gdyby wspólnego pliku jeszcze nie było, utwórz go raz:
   `copy C:\savpol-automatyzacje\automatyzacje\.env.example C:\savpol-automatyzacje\automatyzacje\.env`
   i wpisz dane od Lecha. Osobny `automatyzacje\pz\.env` twórz TYLKO, gdy PZ ma
   mieć inne dane niż reszta.)

2. **Zarejestruj OSOBNE zadanie** w Harmonogramie Zadań — tak samo jak dla WZ,
   ale:
   - Nazwa: **`Savpol PZ`** (żeby nie mylić z `Savpol WZ` / `Savpol MM`).
   - Akcja → Program/skrypt:
     `C:\savpol-automatyzacje\automatyzacje\pz\serwer\uruchom.bat`
   - Godzina startu: ustaw **inną niż WZ/MM** (np. WZ 7:00, MM 7:30, PZ 8:00) —
     żeby przebiegi nie logowały się do ERP w tej samej sekundzie. Każdy z nich
     i tak dokłada losowe 0–15 min opóźnienia, ale różny start to dodatkowy
     margines.
   - Reszta zakładek (Wyzwalacze: dni robocze; Ustawienia: stop po 10 h, „nie
     uruchamiaj nowej kopii") — jak w instrukcji WZ.

To wszystko. `uruchom.bat` z folderu `pz` sam robi `git pull`, odświeża schemat
i puszcza sesje scrapowania w pętli do 17:00, dokładnie jak wersja WZ/MM.

---

## Jeśli to PIERWSZA automatyzacja na tym serwerze

Pełna procedura od zera (Node.js, Git, klonowanie, `.env`, Harmonogram Zadań)
jest w `automatyzacje/wz/serwer/INSTRUKCJA-TOMEK.md` — wykonaj ją, podmieniając
wszędzie `wz` na `pz` i nazwę zadania na `Savpol PZ`. Skrypt
`pierwsza-instalacja.bat` w tym folderze jest już przygotowany pod PZ
(gałąź `pz-deploy`, folder `automatyzacje\pz`).
