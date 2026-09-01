# Dane produktów z ERP dla listy z arkusza

Druga funkcja skryptu `savpol-historia-faktur.user.js`, niezależna od
cross-sellingu. Przycisk **🏷️ Dane z ERP** w pasku katalogu.

## Jak używać

1. W arkuszu zaznacz kolumnę z SKU, **EAN-ami albo nazwami** i skopiuj.
2. W ERP, w katalogu produktów, kliknij **🏷️ Dane z ERP**.
3. Wklej listę, zaznacz potrzebne dane, kliknij **Pobierz dane**.
4. Wynik pojawia się w **blokach do wklejenia** — jedno kliknięcie „Kopiuj"
   wypełnia tyle kolumn arkusza, ile jest w bloku.

**Zaznaczenia i tryb są zapamiętywane** między otwarciami panelu, więc przy
powtarzalnej pracy nie odklikujesz ich za każdym razem.

**Pasek postępu** pokazuje `11/50` i szacowany czas do końca. Szacunek liczy się
ze średniej z dotychczasowych pozycji, więc pojawia się dopiero po trzeciej —
wcześniej byłby mylący. Produkty różnią się czasem (historia sprzedaży, karta
z VAT-em), ale przy kilkuset pozycjach średnia szybko się stabilizuje.
Pasek zmienia kolor na zielony po zakończeniu i na pomarańczowy, gdy przebieg
został przerwany.

Dostępne dane z siatki katalogu: SKU, nazwa z ERP, EAN, cena, cena minimalna,
cena graniczna, grupa produktu, stan DYS.

Osobna sekcja **„Z historii sprzedaży"** liczy statystyki cen realnych
transakcji — podłogę cenową, mediany i percentyle. Jest dużo wolniejsza (kilka
sekund na produkt, bo wymaga otwarcia historii), dlatego jest domyślnie
odznaczona. Co znaczą te liczby i którą brać: [polityka-cenowa.md](polityka-cenowa.md).

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
- Zapytanie bywa **skracane**, gdy pełna nazwa nic nie zwróci — ale
  restrykcyjnie, patrz niżej.

Tryb rozpoznawany jest automatycznie: ciąg do 8 cyfr idzie jako SKU, 12–14 cyfr
jako **EAN**, resztę traktujemy jako nazwę. EAN jest identyfikatorem, więc jest
tak pewny jak SKU i zawsze lepszy od nazwy — jeśli masz go w arkuszu, użyj go. Da się to wymusić przełącznikiem, gdy lista jest mieszana
i wolisz jednolite zachowanie.

**SKU jest dopełniane zerami do siedmiu znaków** (`35776` → `0035776`). Arkusze
traktują SKU jak liczbę i gubią wiodące zera, a katalog ERP wymaga pełnego kodu.
W kolumnie wyniku widzisz kod po dopełnieniu, żeby było wiadomo, o co pytaliśmy.

## Szukanie po EAN — kolumna w siatce to nie ten sam kod

**Kolumna `EAN` w siatce katalogu nosi „NR EAN op. sprzedażowego"** — kod
jednostki sprzedażowej, który nie musi być równy EAN-owi z kartoteki produktu.
Realny przypadek: kartoteka `0024282` ma w karcie EAN `9005676401237`, a w siatce
widnieje `40170404…`.

Wyszukiwarka ERP dopasowuje po **kartotekowym** EAN-ie, więc produkt się
znajduje — ale porównanie kolumna-do-kolumny go odrzucało i pozycja lądowała
jako „nie znaleziono".

Dlatego dopasowanie po EAN idzie dwustopniowo:

1. Zgadza się kolumna `EAN` → status `ok`.
2. Nie zgadza się, ale wyszukiwarka zwróciła wynik → **ufamy wyszukiwarce.**
   To ona znalazła ten produkt po podanym kodzie i jest lepszym dowodem niż
   kolumna przechowująca coś innego. Status mówi wtedy „dopasowane przez
   wyszukiwarkę ERP (kolumna EAN w siatce pokazuje kod op. sprzedażowego)",
   żeby nie było to ciche założenie.

W obu przypadkach z wyniku brana jest **kartoteka podstawowa** — bez szarego
podpisu „Promocja specjalna" czy „Towar nisko rotujący". Gdy w wyniku są dwie
kartoteki podstawowe o **różnych SKU**, status wypisuje je obie i każe sprawdzić:
jeden EAN wskazujący na dwa produkty to nie coś, co skrypt ma rozstrzygać.

## Skracanie zapytania — celowo restrykcyjne

Gdy pełna nazwa nic nie zwraca (literówka, inny szyk, dopisek z arkusza),
skrypt próbuje krótszej wersji: **pierwsze 5 znaczących słów**, potem
**pierwsze 3**. I na tym koniec.

Pierwsza wersja schodziła aż do jednego słowa i „Worek cukierniczy jednorazowy
Masterline Green 59x28 cm - One Way" kończył jako zapytanie **„worek"** — to nie
jest już szukanie tego produktu, tylko losowanie z całej kategorii.

Trzy zabezpieczenia, wszystkie w `EAN_TOOL.NAME_FALLBACK`:

| Ustawienie | Wartość | Po co |
|---|---|---|
| `MIN_TOKENS` | 3 | zapytanie nigdy nie schodzi poniżej trzech znaczących słów |
| `MIN_CHARS` | 12 | trzy krótkie słowa (`ser bio 1kg`) nadal bywają za ogólne |
| `MIN_SCORE` | 0,8 | wynik ze **skróconego** zapytania musi trafić mocniej niż z pełnego |

`MIN_SCORE` jest tu najważniejszy. Skrócone zapytanie z natury pasuje do wielu
produktów, więc przeciętne podobieństwo znaczy „coś z tej półki", a nie „ten
produkt". Gdy trafienie nie sięga 0,8, pozycja dostaje status **„nie znaleziono
— nazwa zbyt ogólna"** i **pustą wartość**. Cichy fałszywy wynik jest gorszy od
pustego wiersza, bo wygląda jak dane.

Trafienie uzyskane skróconą nazwą, nawet mocne, jest oznaczane statusem
**„trafione skróconą nazwą — sprawdź"** — nie ginie w tłumie poprawnych.

## Gramatura rozstrzyga, a nie jest ozdobą

„Krem pistacjowy" istnieje w trzech opakowaniach i tylko liczba mówi, o które
chodzi. Dlatego gramatura, pojemność, liczba sztuk i wymiary są traktowane
osobno od reszty nazwy:

- **Wychwytywane jako całość**, przed dzieleniem na słowa: `2,5 kg`, `2.5kg`
  i `2,5KG` dają ten sam token `2.5kg`. Bez tego kropka i spacja rozbijały
  liczbę na kawałki, których nie dało się porównać.
- **Nigdy nie obcinane do rdzenia** — inaczej `500g` i `500ml` byłyby tym samym.
- **Zostają w każdym skróconym zapytaniu.** Skracamy od końca nazwy, a tam
  właśnie siedzi wielkość opakowania. Zapytanie `krem pistacjowy master`
  zwracało trzy rozmiary i skrypt musiał zgadywać; teraz leci
  `krem pistacjowy master 5kg`.
- **Rozbieżność gramatury ścina wynik poniżej obu progów** (do 0,4). Przy ośmiu
  słowach różnica jednego tokenu to tylko 0,125 — za mało, żeby odrzucić złe
  opakowanie. Teraz `Krem pistacjowy 5kg` wobec kartoteki `1kg` dostaje status
  „SŁABE dopasowanie" zamiast cichego trafienia.
- Kartoteka **bez gramatury** przy zapytaniu z gramaturą też jest ścinana —
  brak informacji to nie zgodność.

Gdy szukana nazwa nie podaje gramatury, nic się nie zmienia: dopasowanie działa
jak wcześniej i kartoteka z gramaturą nie jest za nią karana.

Rozpoznawane jednostki: `kg`, `g`, `mg`, `l`, `ml`, `szt`/`sztuk…`, `cm`, `mm`
oraz wymiary w formacie `59x28`.

## Liczba pojedyncza i mnoga

W arkuszu bywa „Worki cukiernicze jednorazowe", w ERP „Worek cukierniczy
jednorazowy". Skrypt **nie generuje form** — polska odmiana to nie doklejenie
końcówki i każda taka próba byłaby zgadywaniem. Zamiast tego działa w dwóch
miejscach:

**Porównywanie** obcina końcówki po obu stronach, więc formy schodzą się same:

| W arkuszu | W ERP | Rdzeń |
|---|---|---|
| worki | worek | `wor` |
| cukiernicze | cukierniczy | `cukiernic` |
| jednorazowe | jednorazowy | `jednorazow` |

**Tokeny z cyframi zostają nietknięte.** Inaczej `500g` i `500ml` spłaszczyłyby
się do tego samego rdzenia, a gramatura to często jedyna rzecz odróżniająca dwie
kartoteki tego samego towaru.

**Wyszukiwanie** dostaje dodatkowe, ostatnie zapytanie zbudowane z rdzeni
(`wor cukiernic jednorazo masterli`). Bez niego samo porównywanie by nie
pomogło — katalog musi najpierw cokolwiek zwrócić. Tu obcinamy tylko słowa
od pięciu znaków, żeby nie robić z „Krem" ciągu „kre".

**Zastrzeżenie:** nie mam potwierdzonego, czy wyszukiwarka katalogu dopasowuje
początki słów. Jeśli wymaga całych, to zapytanie po prostu nic nie zwróci i nic
się nie zepsuje — tyle że odmiana nadal nie będzie działać przy wyszukiwaniu.
Widać to po statusach: jeśli produkty w liczbie mnogiej kończą jako „nie
znaleziono", to znaczy, że ta droga nie działa i trzeba szukać innej.

Zapytanie po rdzeniach liczy się jako skrócone, więc obowiązuje je ostrzejszy
próg 0,8.

## Grupa produktu — dwa ostatnie człony

Kolumna „Grupa produktu" zwraca **dwa ostatnie człony ścieżki**:

```
B2B\Kategorie\Polewy, syropy, napoje\Soki
→ Polewy, syropy, napoje\Soki
```

Wspólny przedrostek (`B2B\Kategorie`) jest ten sam dla wszystkich pozycji, więc
w arkuszu tylko zabierał szerokość kolumny. Sam człon liścia bywa za ogólny
(„Soki", „Posypki"), stąd dwa, a nie jeden.

Komórka w siatce bywa zawijana na kilka linii, więc białe znaki są sklejane
przed podziałem — inaczej „Dekoracje cukrowe" rozpadłoby się na dwa człony.

**Parametr `group` przekazywany do generatora opisów zostaje pełną ścieżką.**
Tam służy do dopasowania kategorii w `cross-sell-map.md` i pełny kontekst jest
przydatny; skrócenie dotyczy wyłącznie kolumny wyjściowej do arkusza.

## Formaty pod Google Sheets

**Apostrof (domyślnie włączony) tylko dla SKU i EAN.** Bez niego Sheets zje
wiodące zero (`03187571231907` → `3187571231907`) i zamieni długie kody na zapis
naukowy. Przy cenach apostrof byłby **szkodliwy** — zrobiłby z nich tekst,
którego nie da się zsumować, dlatego świadomie ich nie dotyka.

**Kropka w cenach** (domyślnie wyłączona) zamienia polski przecinek na kropkę.
Włącz, jeśli arkusz ma ustawienia regionalne z kropką dziesiętną.

**CSV** zapisuje wszystko razem: szukaną wartość, wszystkie pobrane pola
i status każdej pozycji.

## Zapamiętane zaznaczenia w siatce

ERP **pamięta zaznaczone wiersze między wyszukiwaniami**. Po kilku produktach
w siatce tykało kilka checkboxów naraz i „Historia produktu" zamiast otworzyć
jeden produkt pokazywała dialog „zaznaczyłeś X rekordów" — przebieg się zacinał.

Dlatego przed wyborem wiersza skrypt odznacza wszystko, co zostało z poprzednich
produktów. Czyści **tylko checkboxy w wierszach danych** — nagłówkowy „zaznacz
wszystko" kliknięty przez pomyłkę zaznaczyłby całą stronę.

## Bloki wyjściowe

Pola, które w arkuszu leżą obok siebie, wychodzą jako **jedna wklejka
rozdzielona tabulatorami** — Sheets rozkłada ją na osobne komórki. Zamiast
dziewięciu kopiowań robisz cztery.

| Blok | Kolejność kolumn |
|---|---|
| Identyfikacja | SKU → Nazwa z ERP → Marka → Grupa produktu |
| Ceny z kartoteki | Cena → Cena graniczna → Cena minimalna |
| Z historii sprzedaży | Mediana (transakcje) → P90 (transakcje) |
| ID, stan, EAN, VAT | ID wewnętrzne → Stan (DYS.) → EAN → VAT |

**VAT zwracany jest jako ułamek** (`5%` → `0,05`), bo w arkuszu wchodzi do
mnożenia — procent jako tekst byłby tam bezużyteczny. Wartości powyżej 1 są
traktowane jako procent, poniżej jako gotowy ułamek.

**ID wewnętrzne to identyfikator kartoteki w ERP** — ten sam numer, który
e-commerce ma w adresie produktu (`…-218526476`) i przekazuje do Google Merchant
Center. W siatce pojawia się po włączeniu ukrytej kolumny „Identyfikator wew."
(pole `csItemsId`). Gdy jej nie ma, a karta produktu i tak jest otwierana po
VAT, numer jest brany z identyfikatora zakładki karty — bez dodatkowego kosztu.

ERP wyświetla go **ze spacjami jako separatorem tysięcy** (`218 526 474`), więc
są usuwane. Inaczej w arkuszu wylądowałby tekst, którego nie da się porównać
z identyfikatorem ze sklepu ani użyć w `VLOOKUP`.

**VAT wymaga otwarcia karty produktu** (przycisk „Edycja"), bo nie ma go
w siatce katalogu i nie da się tam dodać takiej kolumny. To kilka sekund na
produkt — tyle samo co statystyki cenowe — więc pole jest wydzielone i domyślnie
odznaczone. Przy 500 pozycjach licz się z dodatkowym kwadransem, a z włączonymi
też statystykami cen — z sumą obu.

Stawka jest wybierana **po etykiecie kontrolki**, nie po kolejności pól na
karcie. Kolejność jest krucha, a etykieta stała. `VAT zakupu` jest odrzucany
jawnie — to inna stawka.

**Panel pokazuje z historii sprzedaży tylko medianę i P90 po transakcjach.**
Reszta statystyk jest nadal liczona, ale nie zajmuje miejsca w interfejsie —
definicje leżą w `SALES_FIELDS_EXTRA` i przywraca się je przeniesieniem wpisu
do `SALES_FIELDS`. Ostrzeżenia o wiarygodności próby **nie znikają razem
z kolumnami**: zbyt mała liczba transakcji, limit 100 pozycji i pominięte
magazyny nadal trafiają do kolumny statusu.

Kolejność w bloku to kolejność kolumn w arkuszu i jest celowa — odpowiada
układowi w docelowym pliku, nie kolejności na liście pól. Definicja siedzi
w `OUTPUT_BLOCKS` na górze skryptu; dopisanie własnego bloku to jedna linia.

Pole zaznaczone, a nieujęte w żadnym bloku, dostaje własne okno — tak jak
wcześniej. Blok, z którego zaznaczono tylko jedno pole, też wychodzi jako
jedna kolumna.

Puste wartości zostają puste również w bloku, żeby nie przesuwać pozostałych
kolumn w wierszu.

## Co skrypt robi z niejednoznacznościami

- **Kartoteki pomocnicze** — ten sam produkt pod SKU z sufiksem albo z szarym
  podpisem pod nazwą („Gratis", „Promocja specjalna", „Towar nisko rotujący").
  Nie mają własnej historii sprzedaży i mogą mieć inne ceny, więc do analizy
  nie nadają się nigdy.

  Format sufiksu jest stały: **myślnik i jedna wielka litera**. W użyciu widziane
  `-G`, `-M`, `-P`, `-R`, `-S`, ale wzorzec obejmuje **dowolną literę**, więc
  nowe sufiksy nie wymagają zmiany kodu. Reguła ma jedną definicję w skrypcie
  (`AUX_CARD_SUFFIX`) używaną i tu, i w filtrze dostępności cross-sellingu.

  Odsiewane **dwoma niezależnymi sitami**: po sufiksie w SKU i po podpisie.
  Kartoteka może mieć jedno bez drugiego, więc jedno sito nie wystarcza.
  Wyszukanie `0000317` zwraca trzy wiersze, brany jest wyłącznie ten z SKU
  dokładnie równym szukanemu. Gdy zostaną same kartoteki dodatkowe, pozycja
  trafia do sprawdzenia ręcznego.
- **Brak w katalogu** albo **puste pole**: pusta linia plus wpis na liście
  problemów pod wynikiem.
- **Błąd odczytu**: nie przerywa listy. Po 400 udanych odczytach utrata całości
  byłaby dotkliwsza niż jedna luka.
- **Siatka mogła się nie odświeżyć**: zabezpieczenie opisane niżej zadziałało,
  ale wynik i tak wygląda podejrzanie. Sprawdź tę pozycję ręcznie.

## Potwierdzanie, że wyniki się przeładowały

`searchCatalog()` czeka na to, że siatka **istnieje** — a ona istnieje od
poprzedniego wyszukiwania. Przy odczycie po SKU dawało to najwyżej „nie
znaleziono", bo porównujemy dokładny numer. Przy odczycie po **nazwie**
wybieramy najlepszy z widocznych wierszy, więc stara zawartość wracała jako
wynik: kolejne produkty dostawały cenę pierwszego.

Dlatego przed każdym wyszukiwaniem zapisujemy **odcisk zawartości siatki**
(liczba wierszy plus ich SKU) i czekamy, aż się zmieni. Gdy się nie zmieni,
zapytanie leci drugi raz — ERP gubi pojedyncze żądania częściej, niż by się
chciało.

Brak zmiany nie zawsze jest błędem: dwa podobne zapytania mogą dać identyczne
wyniki. Dlatego alarmujemy dopiero wtedy, gdy **brak odświeżenia zbiega się ze
słabym dopasowaniem nazwy** — to układ, w którym wartość jest najpewniej cudza.

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
