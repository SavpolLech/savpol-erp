# Kody EAN dla listy SKU z arkusza

Druga funkcja skryptu `savpol-historia-faktur.user.js`, niezależna od
cross-sellingu. Przycisk **🏷️ Kody EAN** w pasku katalogu.

## Jak używać

1. W arkuszu zaznacz kolumnę SKU (np. `B2:B151`) i skopiuj.
2. W ERP, w katalogu produktów, kliknij **🏷️ Kody EAN**.
3. Wklej listę w pole i kliknij **Pobierz kody EAN**. 150 SKU zajmuje
   kilka minut; przebieg da się przerwać, wynik z dotychczasowych zostaje.
4. Kliknij **Kopiuj do arkusza** i wklej w pierwszą komórkę kolumny EAN.

Wynik jest **w kolejności wejściowej**, a produkt bez kodu zostawia pustą linię
— dzięki temu wklejenie wprost obok kolumny SKU nie przesuwa wierszy. Kolejność
jest tu jedyną rzeczą wiążącą wynik z arkuszem, więc puste linie są celowe,
a nie przeoczeniem.

**Apostrof jest domyślnie włączony.** Bez niego Google Sheets zje wiodące zero
(`03187571231907` → `3187571231907`) i zamieni 13-cyfrowe kody na zapis naukowy.
Apostrof wymusza tekst i sam nie wchodzi do wartości komórki.

Opcja **z kolumną SKU** daje dwie kolumny (SKU + EAN) do wklejenia obok siebie
albo pod `VLOOKUP`, gdy kolejność w arkuszu zdążyła się zmienić.

Przycisk **CSV** zapisuje pełny wynik razem ze statusem każdego SKU.

## Co skrypt robi z niejednoznacznościami

- **Kilka kartotek na jedno SKU** (podstawowa plus „Gratis", „Promocja
  specjalna", „Towar nisko rotujący" — rozpoznawalne po szarym podpisie pod
  nazwą): bierze kartotekę **bez podpisu**. Gdy każda ma podpis, bierze pierwszą
  i wypisuje SKU na liście do sprawdzenia.
- **Brak produktu w katalogu** albo **produkt bez EAN**: pusta linia w wyniku
  plus wpis na liście problemów pod polem wyniku.
- **Błąd odczytu**: nie przerywa listy. Po 140 udanych odczytach utrata całości
  byłaby dotkliwsza niż jedna luka.

Lista „do sprawdzenia ręcznie" pod wynikiem jest istotna — bez niej pusta linia
wygląda tak samo jak produkt, który naprawdę nie ma kodu.

## Dlaczego to nie jest osobny skrypt

Odczyt EAN to w całości praca z katalogiem: przełączenie zakładki, wyszukanie
SKU, znalezienie właściwego wiersza. To najbardziej kruchy fragment tego
projektu — wykrywanie zakładki katalogu przerabialiśmy trzy razy (v2.9.1),
rozpoznawanie siatki dwa (v2.16.1), oczekiwanie na dane raz (v2.17.1).
Skopiowanie tego do drugiego pliku oznaczałoby, że każdy z tych błędów wraca
w kopii i trzeba go naprawiać dwa razy.

Funkcja jest wyłączalna flagą `EAN_TOOL.ENABLE` i nie dotyka niczego
w pipelinie cross-sellingu.

## Sprostowanie do wcześniejszego handoffu

Dokument `handoff_ean_automation.md` (z sesji rozszerzenia w Chrome) zawiera
dwa błędne ustalenia, które kosztowałyby dużo czasu przy pisaniu od zera:

1. **„Aplikacja jest osadzona w iframe, `document.querySelector` nic nie
   znajdzie".** Nieprawda — cały ten skrypt od miesiąca czyta DOM ERP zwykłym
   `document.querySelector`. To było ograniczenie narzędzia, którym wtedy
   zaglądano do strony, nie własność ERP.
2. **„Trzeba zaznaczyć wiersz, kliknąć POKAŻ, odczytać pole EAN na karcie
   produktu i wrócić do listy".** Niepotrzebne — **EAN jest kolumną siatki
   katalogu** (`td[data-datafield="EAN"]`, widać ją w logach diagnostycznych
   obok `Item`, `ItemDesc`, `QStockAv`). Wystarczy wyszukać SKU i odczytać
   wiersz, co usuwa cztery kroki na produkt razem z ich pułapkami:
   zapamiętanymi checkboxami, dialogiem „zaznaczyłeś X rekordów" i powrotem
   przez breadcrumb.

Trafna była za to uwaga o formacie tekstowym w Sheets i o tym, że wynik trzeba
przenieść ręcznie — Tampermonkey działa na domenie ERP i do arkusza nie sięgnie.
