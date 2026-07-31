# Prompt do wklejenia w Claude in Chrome

Skopiuj treść poniżej. Zaloguj się wcześniej do ERP i otwórz katalog produktów.

---

Pracujemy na skrypcie Tampermonkey do ERP Savpol:
https://github.com/SavpolLech/savpol-erp

Przeczytaj najpierw `CROSS-SELL.md` — to pełny kontekst projektu, podjęte decyzje
i roadmapa. Potem `savpol-historia-faktur.user.js` (v1.9, działa poprawnie,
nie przepisuj go od zera).

Skrót: skrypt scrapuje historię faktur produktu z ERP, liczy co-occurrence
i typuje 4 produkty do sekcji „Często kupowane razem" w e-commerce. Wyklucza
produkty, których nie da się wysłać kurierem — dziś zgadując kategorię z nazwy
produktu, bo nie mieliśmy dostępu do danych strukturalnych.

Jestem zalogowany w ERP i mam otwarty katalog produktów
(`erp.savpol.pl/pl/katalog/csitems/`). Masz dostęp do przeglądarki, więc możesz
sam obejrzeć DOM — nie zgaduj selektorów, sprawdź je.

## Stan: Zadania 1-4 są ZROBIONE

Nie powtarzaj ich. W skrypcie działają już:

- odczyt katalogu (`lookupCatalogItem`, `switchToCatalogTab`, `searchCatalog`),
- filtr dostępności (`AVAILABILITY`): `DYS.` ≤ 0, „Towar nisko rotujący",
  kartoteki pomocnicze `-M`/`-R`,
- wykluczenie po grupie (`GROUP_FILTER`, `groupDeny` + `groupAllow`),
- cache kategorii/gramatury w GM storage (`CATALOG_CACHE`),
- bramka anchora (`ANCHOR_GATE`) i SKU do schowka (`CLIPBOARD`).

## Co jest otwarte

**A. Cache nie daje dziś żadnej oszczędności** — jest zapisywany, ale nigdy
czytany do decyzji. Szczegóły i jedyne miejsce, gdzie może zadziałać
(odrzucenie po grupie z cache, bez zapytania do katalogu), opisuje
`CROSS-SELL.md`, sekcja „Cache: stan faktyczny". To najsensowniejsze
następne zadanie.

**B. Podstawianie wariantów** — `CROSS-SELL.md`, krok „Podstawianie wariantów".
Wymaga decyzji właściciela produktu, bo oznacza rekomendowanie SKU, które samo
nie zapracowało na sygnał co-occurrence. Zapytaj przed implementacją.

**C. Bramka anchora działa po scrapowaniu**, bo nazwę anchora bierze
z zescrapowanych pozycji. Przeniesienie jej przed scrapowanie wymaga odczytania
nazwy z zaznaczonego wiersza katalogu — ustal selektory na żywej sesji.
Oszczędza wtedy całe scrapowanie 100 faktur, nie tylko lookupy.

**D. Do decyzji właściciela produktu:** `szynka` nie ma żadnej reguły
wykluczenia (`wędlina` i `kiełbasa` jej nie łapią). Wyszła przy anchorze
gastronomicznym `0031401`.

## Zasady pracy

- Zachowaj obecny styl: komentarze po polsku, konfiguracja na górze pliku,
  każda nowa funkcja wyłączalna flagą.
- Nie zmieniaj progów w `CROSS_SELL` ani reguł w `EXCLUSIONS` bez pytania —
  są skalibrowane na siedmiu anchorach, uzasadnienia w `CROSS-SELL.md`.
- Rdzenie odmiany idą do `substring`, pełne słowa do `words` — patrz
  „Pułapki nazewnictwa". Rdzeń w `words` nigdy nie dopasuje formy odmienionej.
- Diagnostyka w konsoli przez `console.table`, jak w `logAnalysis()`.
- **Zrób `git pull` przed startem i `git push` po zakończeniu.** Repo jest
  edytowane też z drugiej sesji; rozjazdy już się zdarzały.
- Po każdym zadaniu pokaż wynik na realnym produkcie, zanim przejdziesz dalej.
- Do testów użyj anchorów z tabeli kalibracji w `CROSS-SELL.md` — ich wyniki
  są tam zapisane, więc regresja jest widoczna od razu.
