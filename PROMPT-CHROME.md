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

## Zadanie 1 — rozpoznanie widoku katalogu (zrób to pierwsze)

Wyszukaj w katalogu frazę `proszek do pieczenia`. Zwróci ~6 rekordów. Ustal:

1. Selektor pola wyszukiwania i sposób zatwierdzania frazy (Enter? przycisk?).
   ERP używa Kendo UI — część kontrolek wymaga wywołania zdarzeń na instancji
   widgetu, nie samego `.value = ...`. W skrypcie jest już przykład takiego
   podejścia dla `kendoDatePicker` w funkcji `setFilters()`.
2. Nazwy `data-datafield` dla kolumn: SYMBOL, OPIS, GRUPA PRODUKTU, DYS., STATUS.
3. Jak odczytać podpisy pod nazwą produktu („Market", „Towar nisko rotujący").
4. Czy siatka jest paginowana przy większej liczbie wyników i czy pager jest ten sam
   co `.csDataPager` używany już w skrypcie.
5. Czy przy tej liście jest eksport do pliku.

Pokaż mi ustalenia **przed** pisaniem kodu.

## Zadanie 2 — filtr dostępności

Dopisz krok, który dla finalnych kandydatów sprawdza w katalogu stan dyspozycyjny
(`DYS.`) i odrzuca produkty ze stanem zerowym, dobierając następnych z rankingu.
Odczyt na żywo, bez cache — stan zmienia się codziennie.

Uwzględnij flagę „Towar nisko rotujący" jako sygnał deprioryzujący (zapytaj mnie,
czy ma odrzucać, czy tylko obniżać pozycję).

## Zadanie 3 — kategorie zamiast regex-ów

`GRUPA PRODUKTU` zawiera sensowne kategorie (drożdże i mrożonki mają własne).
Chcę zamienić zgadywanie z nazwy na denylistę kategorii — jedna decyzja per gałąź.

Wypisz mi najpierw wartości `GRUPA PRODUKTU`, jakie faktycznie występują wśród
produktów pojawiających się w rekomendacjach, żebym mógł odhaczyć, które nie jadą
kurierem. Nie zakładaj z góry, że kategoria = warunki transportu.

Reguł nazwowych z `EXCLUSIONS` **nie usuwaj** — mają zostać jako druga warstwa.
Dodaj do logu listę kategorii, które wystąpiły wśród kandydatów, a których nie ma
na denyliście (inaczej brakująca gałąź chłodnicza przejdzie po cichu).

## Zadanie 4 — persystencja

Cache kategorii i gramatur w `GM_setValue` / `GM_getValue` (dopisz `@grant`).
Cache narastający — tylko sprawdzani kandydaci, bez zrzutu całego katalogu.
Stanu magazynowego **nie cachuj**.

## Zasady pracy

- Zachowaj obecny styl: komentarze po polsku, konfiguracja na górze pliku,
  każda nowa funkcja wyłączalna flagą.
- Nie zmieniaj progów w `CROSS_SELL` bez pytania — są skalibrowane na realnych
  danych, uzasadnienie jest w `CROSS-SELL.md`.
- Diagnostyka w konsoli przez `console.table`, jak w `logAnalysis()`.
- Po każdym zadaniu pokaż mi wynik na realnym produkcie, zanim przejdziesz dalej.
- Do testów użyj anchorów `0022850` lub `0031629` — ich wyniki są opisane
  w `CROSS-SELL.md`, więc łatwo zauważyć regresję.
