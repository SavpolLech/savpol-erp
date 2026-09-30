# Przeglądarka bazy worek

Lokalny odpowiednik phpMyAdmina dla bazy `worek` (MS SQL Server — phpMyAdmin
obsługuje tylko MySQL). **Wyłącznie odczyt.**

## Uruchomienie

Dwuklik `przegladarka-launcher.bat`. Przy pierwszym uruchomieniu zainstaluje
zależności, potem sam otworzy `http://localhost:3399`. Zamknięcie czarnego okna
wyłącza przeglądarkę.

Dane logowania bierze ze wspólnego `automatyzacje/.env` (te same co scrapery).
Serwer słucha tylko na 127.0.0.1 — nikt z sieci się do niego nie podłączy.

## Co umie

- lista tabel (na górze tabele scraperów: `csDocsHeaders`, `csDocsItemsPositions`,
  `csItems`, `csPhotos` i ich wersje `_test`), liczba wierszy, wyszukiwarka,
- podgląd tabeli: domyślnie od najnowszych (malejąco po `<Tabela>Id`),
  sortowanie kliknięciem nagłówka, stronicowanie, struktura kolumn,
- filtr pod nagłówkiem (zatwierdzasz Enterem):

  | wpis | znaczenie |
  |---|---|
  | `2026/WZ/RAS1` | tekst zaczyna się od (liczby, daty, GUID: równe) |
  | `*RAS1*` | zawiera — wolne na dużych tabelach |
  | `=5`, `!=0`, `>=2026-09-01`, `<100` | porównania |
  | `NULL`, `!NULL` | puste / niepuste |

- kliknięcie komórki pokazuje pełną wartość (JSON sformatowany),
- **Zapytanie SQL**: dowolny `SELECT` / `WITH`, Ctrl+Enter,
- **Kopiuj do schowka**: widoczne wiersze jako TSV z nagłówkiem (co, skąd,
  kiedy) — wklejasz do Excela albo do rozmowy z Claude.

## Dlaczego jest tylko do odczytu i ostrożna

Worek to kopia produkcyjnego ERP (`csDocsItemsPositions` ma ~47 mln wierszy).

- Do worka tylko dopisujemy i robią to wyłącznie scrapery, więc tu nie ma
  żadnej edycji. Pole SQL odrzuca wszystko poza SELECT/WITH, a każde
  zapytanie i tak wykonuje się w transakcji zakończonej ROLLBACK.
- Filtr domyślnie działa jako „zaczyna się od”, a nie „zawiera”, bo tylko wtedy
  serwer może użyć indeksu. Po filtrze nie liczymy wszystkich wierszy (COUNT to
  pełny skan tabeli). Zapytanie dłuższe niż 30 s zostaje przerwane.
