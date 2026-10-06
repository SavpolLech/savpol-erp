# Automatyzacja scraperów ERP — obsługa

Jak korzystać z działającego już automatu. Instalacja od zera — patrz
**`INSTALACJA.md`**.

## Co robi automat sam

Raz dziennie (pon–pt, 9:30) ściąga z ERP dokumenty WZ, MM i PZ — po kolei,
nigdy równolegle — i zapisuje do bazy. Dobiera też zaległe dni z okna wstecz,
więc poniedziałkowy bieg uzupełnia piątek/sobotę/niedzielę. Dokumenty już
obecne w bazie są pomijane (nie ma duplikatów). Nic nie trzeba robić ręcznie.

**MM wchodzą z opóźnieniem 3 dni.** MM bywają cofane i poprawiane (daty,
wartości), zanim zostaną zaksięgowane — zwykle 2–3 dni po utworzeniu. Dlatego
automat bierze dzień MM dopiero, gdy ma on co najmniej 3 dni (np. MM z
poniedziałku wchodzą w czwartek). Brak MM za ostatnie 2–3 dni to norma, nie
błąd. Opóźnienie zmienia `MM_MIN_AGE_DAYS` w `.env`.

## Jak sprawdzić, czy działa

Automat sam zapisuje log każdego przebiegu z powrotem do repozytorium
(`run-log.jsonl` w katalogu każdego scrapera) — Lech widzi to bez dostępu do
serwera. Można też zerknąć samemu: w Harmonogramie Zadań, zakładka **Historia**
(History) dla zadania `Savpol Scrapery ERP` pokazuje, kiedy się odpaliło i czy
zakończyło się bez błędu.

## Ręczne dobicie brakującego dnia

Gdy ERP pokazuje dla jakiegoś dnia więcej dokumentów niż jest w bazie (np. ERP:
800 WZ, baza: 780), można dobrać brakujące samemu:

1. Wejdź do folderu `C:\savpol-automatyzacje\automatyzacje\wz\serwer\`.
2. Dwuklik na **`dobij-dzien.bat`**.
3. Wpisz typ (`wz`, `mm`, `pz` albo `sprzedaz` — faktury FA i paragony PAR)
   i datę (`RRRR-MM-DD`).
4. Tryb: naciśnij **Enter** (szybki — dobiera brakujące). Jeśli szybki nie
   pomógł (w bazie dalej jest mniej niż w ERP), odpal jeszcze raz i wybierz
   **`p`** (pełny — przeklikuje dzień od zera).

**MM: nie dobijaj ręcznie dnia młodszego niż 3 dni.** Ręczne dobicie omija
opóźnienie — wciągnęłoby MM jeszcze niezaksięgowane, a poprawek z ERP baza już
nie przyjmie (do bazy tylko dopisujemy).

**Sprzedaż (FA, PAR): nie dobijaj ręcznie dnia młodszego niż 14 dni** — z tego
samego powodu: faktury dochodzą z datą wstecz, a płatności dopisują się po
wystawieniu. Automat sam bierze dzień, gdy skończy 14 dni.

Bezpieczne o każdej porze: bierze tę samą blokadę co codzienny automat, więc
nigdy nie wejdzie na ERP równolegle (gdyby akurat trwał inny bieg, wypisze
„inny bieg trwa" i wyjdzie — spróbuj później). Dokumenty już w bazie nie są
dublowane — dopisywane są tylko brakujące.

## Doscrapowanie brakujących produktów po ID

Gdy dostaniesz listę identyfikatorów (ID) brakujących produktów (kartotek,
których nie ma jeszcze w bazie):

1. Wklej ID (jeden pod drugim albo po przecinku) do pliku
   `C:\savpol-automatyzacje\automatyzacje\produkty\lista-id.txt`.
2. Dwuklik na **`dobij-produkty-po-id.bat`** (w folderze `serwer\`). Za
   pierwszym razem, jeśli pliku nie ma, skrypt utworzy go i otworzy w Notatniku
   — wklej ID, zapisz i odpal `.bat` ponownie.

Skrypt sam zescrapuje te produkty i zapisze je do bazy. Bierze tę samą blokadę
co reszta (nie wejdzie na ERP równolegle), a produkty już obecne w bazie
pomija.
