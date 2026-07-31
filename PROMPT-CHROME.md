# Prompt do wklejenia w Claude in Chrome

Skopiuj treść poniżej. Zaloguj się wcześniej do ERP i otwórz katalog produktów.

---

Pracujemy na skrypcie Tampermonkey do ERP Savpol:
https://github.com/SavpolLech/savpol-erp

Przeczytaj najpierw `CROSS-SELL.md` — to pełny kontekst projektu, podjęte decyzje
i roadmapa. Potem `savpol-historia-faktur.user.js` (v2.6.0, działa poprawnie
i jest skalibrowany na realnych danych — nie przepisuj go od zera).

Skrót: skrypt scrapuje historię faktur produktu z ERP, liczy co-occurrence
i typuje 4 produkty do sekcji „Często kupowane razem" w e-commerce. Wyklucza
produkty, których nie da się wysłać kurierem — na podstawie nazwy oraz grupy
produktu odczytanej z katalogu. Główny wynik pracy to SKU rekomendowanych
produktów w schowku, rozdzielone przecinkami.

Jestem zalogowany w ERP i mam otwarty katalog produktów
(`erp.savpol.pl/pl/katalog/csitems/`). Masz dostęp do przeglądarki, więc możesz
sam obejrzeć DOM — nie zgaduj selektorów, sprawdź je.

## Stan: Zadania 1-4 są ZROBIONE

Nie powtarzaj ich. W skrypcie działają już:

- odczyt katalogu (`lookupCatalogItem`, `switchToCatalogTab`, `searchCatalog`),
- filtr dostępności (`AVAILABILITY`): `DYS.` ≤ 0, „Towar nisko rotujący",
  kartoteki pomocnicze `-M`/`-R`,
- wykluczenie po grupie (`GROUP_FILTER`, `groupDeny` + `groupAllow`),
- bramka anchora (`ANCHOR_GATE`) i SKU do schowka (`CLIPBOARD`).

## Co jest otwarte

**A. Cache katalogowy został USUNIĘTY w v2.6.0** — nie przywracaj go bez
przeczytania `CROSS-SELL.md`, sekcja „Cache katalogowy — ZROBIONY I USUNIĘTY".
Był zapisywany i nigdy czytany, a jego uzasadnienie było błędne: grupa i stan
przychodzą z tego samego zapytania.

**B. Podstawianie wariantów** — `CROSS-SELL.md`, krok „Podstawianie wariantów".
Wymaga decyzji właściciela produktu, bo oznacza rekomendowanie SKU, które samo
nie zapracowało na sygnał co-occurrence. Zapytaj przed implementacją.

**C. Bramka anchora działa po scrapowaniu**, bo nazwę anchora bierze
z zescrapowanych pozycji. Przeniesienie jej przed scrapowanie wymaga odczytania
nazwy z zaznaczonego wiersza katalogu — ustal selektory na żywej sesji.
Oszczędza wtedy całe scrapowanie 100 faktur, nie tylko lookupy.

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
