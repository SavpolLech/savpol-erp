# Dane produktów z ERP dla listy z arkusza

Druga funkcja skryptu `savpol-historia-faktur.user.js`, niezależna od
cross-sellingu. Przycisk **🏷️ Dane z ERP** w pasku katalogu.

## Jak używać

1. W arkuszu zaznacz kolumnę z SKU **albo z nazwami** i skopiuj.
2. W ERP, w katalogu produktów, kliknij **🏷️ Dane z ERP**.
3. Wklej listę, zaznacz potrzebne dane, kliknij **Pobierz dane**.
4. Każda wybrana informacja pojawia się jako **osobna kolumna z własnym
   przyciskiem „Kopiuj"** — wklejasz kolumnę po kolumnie w odpowiednie miejsca
   arkusza.

Dostępne dane (wszystkie z siatki katalogu): SKU, nazwa z ERP, EAN, cena,
cena minimalna, cena graniczna, grupa produktu, stan DYS.

Wynik jest **w kolejności wejściowej**, a brak wartości zostawia pustą linię —
dzięki temu wklejenie obok kolumny źródłowej nie przesuwa wierszy. Kolejność
jest tu jedyną rzeczą wiążącą wynik z arkuszem, więc puste linie są celowe.

## Szukanie po nazwie — najważniejsze ograniczenie

SKU jest identyfikatorem: albo pasuje, albo nie. **Nazwa nie daje takiej
pewności** — w arkuszu bywa skrócona, z inną gramaturą, bez marki, z literówką.
Dlatego:

- **Zaznacz „Nazwa z ERP" i sprawdź ją wzrokowo.** To kolumna kontrolna: obok
  swojej nazwy widzisz tę, którą skrypt uznał za dopasowanie. Jest domyślnie
  włączona i nie warto jej wyłączać przy szukaniu po nazwie.
- Dopasowanie liczy **udział słów szukanej nazwy obecnych w nazwie z ERP**.
  Liczone jednostronnie, bo ERP dopisuje do nazw markę i gramaturę, więc jego
  nazwa bywa dłuższa i kara za to byłaby niesłuszna. `Mascarpone 500g` wobec
  `Mascarpone 500g GALBANI` daje 1,0.
- Poniżej progu `NAME_MATCH_MIN` (0,6) wynik dostaje status
  **„SŁABE dopasowanie nazwy — sprawdź"**. Wartości są zwracane, ale nie ufaj
  im bez obejrzenia.
- Gdy kilka kartotek pasuje **równie dobrze**, status mówi „kilka pasujących
  nazw". Skrypt nie zgaduje po cichu.
- Zapytanie jest **skracane etapami**, gdy pełna nazwa nic nie zwróci: cała
  nazwa → pierwsze 4 znaczące słowa → pierwsze 2 → pierwsze. Jeden literowy
  rozjazd w środku nazwy nie musi wtedy kończyć się pustym wierszem.

Tryb rozpoznawany jest automatycznie: co pasuje do wzorca SKU (6–8 cyfr) idzie
jako SKU, resztę traktujemy jako nazwę. Da się to wymusić przełącznikiem, gdy
lista jest mieszana i wolisz jednolite zachowanie.

## Formaty pod Google Sheets

**Apostrof (domyślnie włączony) tylko dla SKU i EAN.** Bez niego Sheets zje
wiodące zero (`03187571231907` → `3187571231907`) i zamieni długie kody na zapis
naukowy. Przy cenach apostrof byłby **szkodliwy** — zrobiłby z nich tekst,
którego nie da się zsumować, dlatego świadomie ich nie dotyka.

**Kropka w cenach** (domyślnie wyłączona) zamienia polski przecinek na kropkę.
Włącz, jeśli arkusz ma ustawienia regionalne z kropką dziesiętną.

**CSV** zapisuje wszystko razem: szukaną wartość, wszystkie pobrane pola
i status każdej pozycji.

## Co skrypt robi z niejednoznacznościami

- **Kilka kartotek na jedno SKU** (podstawowa plus „Gratis", „Promocja
  specjalna", „Towar nisko rotujący" — rozpoznawalne po szarym podpisie pod
  nazwą): bierze kartotekę **bez podpisu**. Gdy jest ich więcej niż jedna albo
  gdy wszystkie mają podpis, wypisuje pozycję do sprawdzenia.
- **Brak w katalogu** albo **puste pole**: pusta linia plus wpis na liście
  problemów pod wynikiem.
- **Błąd odczytu**: nie przerywa listy. Po 400 udanych odczytach utrata całości
  byłaby dotkliwsza niż jedna luka.

Lista „do sprawdzenia ręcznie" pod wynikiem jest istotna — bez niej pusta linia
wygląda tak samo jak produkt, który naprawdę nie ma danej wartości.

## Dlaczego to nie jest osobny skrypt

Odczyt to w całości praca z katalogiem: przełączenie zakładki, wyszukanie,
znalezienie właściwego wiersza. To najbardziej kruchy fragment tego projektu —
wykrywanie zakładki katalogu przerabialiśmy trzy razy (v2.9.1), rozpoznawanie
siatki dwa (v2.16.1), oczekiwanie na dane raz (v2.17.1). Kopia w drugim pliku
oznaczałaby, że każdy z tych błędów wraca i naprawia się go dwa razy.

Funkcja jest wyłączalna flagą `EAN_TOOL.ENABLE` i nie dotyka niczego
w pipelinie cross-sellingu. Nowe pole do odczytu dodaje się jednym wpisem
w `DATA_FIELDS` — nazwa kolumny `data-datafield` plus etykieta.

## Sprostowanie do handoffu z rozszerzenia w Chrome

Dokument `handoff_ean_automation.md` zawiera dwa błędne ustalenia, które
kosztowałyby dużo czasu przy pisaniu od zera:

1. **„Aplikacja jest osadzona w iframe, `document.querySelector` nic nie
   znajdzie".** Nieprawda — cały ten skrypt od miesiąca czyta DOM ERP zwykłym
   `document.querySelector`. To było ograniczenie narzędzia, którym wtedy
   zaglądano do strony, nie własność ERP.
2. **„Trzeba zaznaczyć wiersz, kliknąć POKAŻ, odczytać pole na karcie produktu
   i wrócić do listy".** Niepotrzebne — **EAN i ceny są kolumnami siatki
   katalogu** (`EAN`, `CSalesMinPrice`, `CSalesLimitPrice`; widać je w logach
   diagnostycznych obok `Item` i `ItemDesc`). Wystarczy wyszukać i odczytać
   wiersz, co usuwa cztery kroki na produkt razem z ich pułapkami:
   zapamiętanymi checkboxami, dialogiem „zaznaczyłeś X rekordów" i powrotem
   przez breadcrumb.

Trafna była za to uwaga o formacie tekstowym w Sheets i o tym, że wynik trzeba
przenieść ręcznie — Tampermonkey działa na domenie ERP i do arkusza nie sięgnie.
