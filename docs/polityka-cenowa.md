# Podłoga cenowa z historii sprzedaży — jaką liczbę brać

Do analizy: jak nisko można zejść z ceną w e-commerce, nie podcinając klientów
B2B, którzy kupują ten produkt od nas dziś.

## Najpierw korekta pytania

W rozmowie pojawił się „top 10 percentyl" jako kandydat na wynik. **To liczba
z przeciwnego końca rozkładu, niż potrzebna.**

Ograniczeniem nie jest to, ile najlepszych klientów płaci najwięcej — tylko
to, ilu **zostanie podciętych**, gdy zejdziemy z ceną. Jeśli B2B kupuje po 110
i ustawimy 100, podcinamy każdego, kto płaci powyżej 100. Podłogą jest więc
**niski percentyl**: kwota, poniżej której leży już tylko mała, akceptowalna
część sprzedaży.

- **P25** — poniżej tej kwoty jest 25% sprzedaży. Zejście do niej podcina jedną
  czwartą — i to tę, która i tak ma najlepsze warunki. To rekomendowana podłoga
  (`PRICE_STATS.FLOOR_PERCENTILE = 25`).
- **P10** — podłoga agresywna: podcina 10%. Do produktów, gdzie chcemy walczyć
  ceną, świadomie ryzykując rozmowę z kilkoma partnerami.
- **Mediana** — nie jest podłogą. Zejście do mediany podcina połowę klientów.
  Warto ją znać jako punkt odniesienia, nie jako granicę.
- **P90** — to ta liczba z pierwotnego pytania. Nie mówi nic o podłodze, ale
  mówi, ile da się utrzymać na górnym segmencie. Zostawiona jako informacja.

**Cena minimalna i graniczna z kartoteki nie zastępują tej analizy** — to progi
ustawione ręcznie w ERP. Historia sprzedaży pokazuje, co się realnie dzieje.

## Ważyć wolumenem czy liczyć transakcje? Jedno i drugie

To pytanie z rozmowy („czy trzeba to ważyć wolumenem") ma odpowiedź: **zależy,
czego się boisz**, więc narzędzie liczy oba warianty.

| Wariant | Odpowiada na pytanie |
|---|---|
| **ważony wolumenem** | ile **towaru** sprzedajemy poniżej tej kwoty |
| **po transakcjach** | ile **umów z klientami** jest poniżej tej kwoty |

Rozjazd między nimi jest informacją, nie usterką. Przykład z rzeczywistego
układu: jeden klient bierze 500 kg po 102 zł, dwóch po 114 zł.

- ważone P90 = **102** — bo 90% kilogramów wychodzi po 102
- transakcyjne P90 = **114** — bo 17% umów jest droższych

Ryzyko utraty partnerstwa jest **per relacja**, nie per kilogram: obrażony
klient odchodzi cały, niezależnie od tego, ile kupował. Dlatego do decyzji
„czy kogoś podcinam" bierz wariant **transakcyjny**, a wolumenowy do oceny,
ile obrotu jest w grze.

## Co zwraca skrypt

Przycisk **🏷️ Dane z ERP**, sekcja „Z historii sprzedaży". Każda liczba jako
osobna kolumna do wklejenia.

| Kolumna | Znaczenie |
|---|---|
| Transakcji | liczba pozycji faktur w okresie — **czytaj pierwsze** |
| Wolumen | suma ilości |
| PODŁOGA (P25 wol.) | rekomendowana podłoga, ważona wolumenem |
| PODŁOGA (P25 transakcje) | to samo, liczone po umowach |
| Mediana (wol.) / (transakcje) | punkt odniesienia, nie granica |
| P10 (wol.) | podłoga agresywna |
| P90 (wol.) / (transakcje) | górny segment |
| Cena min./maks. w historii | do wychwycenia deali jednorazowych |
| Rozwarstwienie | P90/P10 — powyżej 1,15 sygnalizowane w statusie |
| Okres (od–do) | **faktyczny** zakres dat użytej próby |

**Liczbę transakcji czytaj przed wszystkim innym.** Percentyl z trzech faktur to
nie statystyka. Poniżej `MIN_TRANSACTIONS` (5) status mówi wprost „percentyle
niewiarygodne" — to ta sama lekcja co przy cross-sellingu, gdzie pomiar pokazał,
że przy 20 fakturach trzy z czterech rekomendacji byłyby inne.

**Rozwarstwienie** to bezpośrednia odpowiedź na przykład z rozmowy (10 klientów
po 102, 2 po 114). Gdy `P90/P10 ≥ 1,15`, status mówi „ceny rozwarstwione — dwie
grupy klientów". Wtedy żadna jedna liczba nie opisuje rynku i trzeba spojrzeć na
rozkład.

## Skąd dane

Siatka **historii produktu**, kolumny `FNetPriceADis` (cena netto po rabacie),
`dQuantity`, `CustomerDesc`, `DocDate`. Wszystko jest na liście, więc **nie
otwieramy dokumentów** — jeden produkt to sekundy, nie minuty jak w pipelinie
cross-sellingu.

**Zakres wybierasz w panelu**, przy sekcji „Z historii sprzedaży":

| Wybór | Okno | Do czego |
|---|---|---|
| 1 miesiąc | 1 miesiąc wstecz | bieżąca cena, gdy produkt rotuje szybko |
| **2 miesiące** (domyślnie) | 2 miesiące wstecz | dość świeże, żeby opisywać dziś, i dość szerokie, żeby złapać klientów kupujących raz na kilka tygodni |
| 1 rok | 12 miesięcy wstecz | produkty wolnorotujące i sezonowe |

To **okno kroczące**, liczone od dziś — nie „od początku roku", jak w pierwszej
wersji. Tamto miało wadę, która ujawniała się dopiero z czasem: w styczniu
kurczyło się do kilku tygodni, więc to samo ustawienie dawało w różnych
miesiącach różnie liczną próbę.

Wybór steruje **filtrem daty w ERP**, nie tylko odsiewem w skrypcie — krótszy
zakres to mniej stron do przewinięcia, czyli szybszy przebieg. Odsiew po stronie
skryptu zostaje jako druga linia obrony, gdyby filtr nie zadziałał.

**Krótszy zakres to mniejsza próba.** Przy „1 miesiąc" część produktów wejdzie
poniżej `MIN_TRANSACTIONS` i dostanie status „percentyle niewiarygodne" —
to nie usterka, tylko uczciwa informacja, że z pięciu transakcji nie da się
policzyć podłogi. Kolumna „Okres (od–do)" pokazuje, co faktycznie weszło
do próby.

**Limit 100 najnowszych transakcji** (`MAX_TRANSACTIONS`). Bestsellery mają
w roku setki pozycji i przewijanie ich stron zajmowało większość czasu
przebiegu, a percentyl ze 100 pozycji jest praktycznie tak samo stabilny jak
z 800. Liczą się najnowsze, bo lista historii jest sortowana od najnowszych.

Skutek uboczny jest realny: **przy trafieniu w limit próba obejmuje krótszy
okres niż zamówiony.** Produkt z 400 transakcjami od stycznia zostanie policzony
z ostatnich kilku tygodni. Dlatego limit jest zgłaszany w statusie, a kolumna
**„Okres (od–do)"** pokazuje faktyczny zakres dat — bez niej nie dałoby się
odróżnić „cena stabilna od stycznia" od „cena z ostatnich dwóch tygodni".
Jeśli przy jakimś produkcie okres wyjdzie podejrzanie krótki, podnieś limit
dla tego przebiegu.

## Tylko magazyn GLS1

**Różne magazyny mają różne ceny**, więc mieszanie ich dawałoby podłogę, która
nie obowiązuje nigdzie. Liczymy wyłącznie transakcje z magazynu wskazanego
w `PRICE_STATS.WAREHOUSE` — domyślnie `GLS1` (Gliwice). Pusty ciąg wyłącza filtr.

Kod magazynu bywa wyświetlany samodzielnie (`GLS1`) albo z opisem
(`GLS1 - Gliwice`), więc szukamy wystąpienia kodu, nie równości.

Filtrujemy **po stronie skryptu**, bo widok historii nie ma wyboru magazynu
w interfejsie — w przeciwieństwie do daty, którą da się zawęzić u źródła.
Oznacza to, że strony i tak są przewijane w całości; limit 100 transakcji liczy
się **po** odsiewie, więc obejmuje 100 pozycji z GLS1, a nie 100 wszystkich.

### Gdy z GLS1 nie ma sprzedaży — drabinka awaryjna

Zdarza się, że w wybranym zakresie produkt nie sprzedał się z Gliwic ani razu.
Zamiast zwracać pustkę, skrypt schodzi po trzech stopniach:

| Stopień | Zakres | Magazyn | Status |
|---|---|---|---|
| 1 | wybrany | tylko GLS1 | normalny |
| 2 | wybrany + 2 mies. | tylko GLS1 | „poszerzono do N mies." |
| 3 | wybrany + 2 mies. | **wszystkie** | „BRAK sprzedaży z GLS1 — cena oszacowana z innych magazynów" |

**Każdy stopień poniżej pierwszego jest zgłaszany w statusie.** Cena z innego
magazynu nie może wyglądać jak cena z GLS1 — to inna półka cenowa, a decyzja
podjęta na niej byłaby decyzją na cudzych danych. Stopień 3 to **oszacowanie,
nie pomiar**, i tak jest opisany.

Kolumna „Okres (od–do)" pokazuje przy tym faktyczny zakres, więc poszerzenie
widać także w danych, nie tylko w statusie.

Na wszystkich stopniach liczą się **wyłącznie dokumenty typu FA** — korekty
i inne typy nie wchodzą do próby na żadnym etapie.

Progi sterujące: `FALLBACK_EXTRA_MONTHS` (2) i `FALLBACK_OTHER_WAREHOUSES`
(`false` wyłącza trzeci stopień, jeśli wolisz pustkę od oszacowania).

Odrzucone pozycje są **liczone i raportowane**:

- gdy zostanie zero — status mówi „brak sprzedaży z magazynu GLS1 (7 transakcji
  z innych magazynów)". Bez tego rozróżnienia produkt sprzedający się świetnie
  w Warszawie wyglądałby na awarię odczytu;
- gdy zostaną jakieś — status dopisuje „pominięto N transakcji z innych
  magazynów", żeby było widać, na jakiej części sprzedaży liczona jest podłoga.

Dalej odsiewane: ilości zerowe i ujemne (korekty, zwroty), ceny zerowe
(gratisy), kontrahenci z listy `EXCLUDE_CUSTOMERS`.

## Powrót do katalogu po każdym produkcie (v2.28.1)

Pierwsza wersja policzyła poprawnie jeden produkt i stanęła: kolejne SKU trafiały
do **wyszukiwarki historii sprzedaży** zamiast do katalogu. Ten sam błąd
naprawialiśmy już w pipelinie cross-sellingu (v2.7.1) — wrócił nową drogą.

Dwie przyczyny:

**1. Zakładkę do zamknięcia brałem po kliknięciu, nie przed.**
`document.querySelector('li.k-state-active')` zaraz po `openHistory()` zwracał
jeszcze **katalog**, bo historia otwiera się asynchronicznie. Zamykaliśmy więc
katalog, zostawiając historię jako jedyny widok z wyszukiwarką. Teraz zakładka
katalogu jest zapamiętywana **przed** otwarciem historii, a skrypt czeka na
faktyczne pojawienie się panelu historii, zamiast odczekać 400 ms.

**2. Historia sprzedaży ma kolumnę `Item` dokładnie tak jak katalog.** Reguła
zapasowa „panel z wyszukiwarką i kolumną `Item`" opisywała oba, więc po
zamknięciu katalogu skrypt uznawał historię za katalog. Rozstrzyga `DocNumber`:
historia jest listą dokumentów i go ma, katalog jest listą kartotek i nie ma.
Weryfikowana jest teraz także **zapamiętana** zakładka — ERP potrafi przerysować
panel pod tym samym id.

Po zamknięciu historii skrypt **potwierdza** powrót do katalogu (czeka na pole
wyszukiwania), zamiast założyć, że nastąpił.

**To czwarty raz ten sam wzorzec** — po v2.16.1, v2.17.1 i v2.26.1. Rozpoznawanie
widoku po obecności pojedynczej kolumny jest za słabe w ERP, gdzie kilka widoków
dzieli te same nazwy pól. Zawsze „ma X i **nie ma** Y".

## Rozpoznawanie zakładki historii (v2.28.3-4)

Objaw: „historia produktu nie otworzyła się" dla każdego produktu, brak
ustawionych filtrów i mnożące się zakładki „Pozycje dokumentów".

Wszystko z jednej przyczyny. Wykrywanie otwartej historii wymagało, żeby
**aktywna** zakładka miała w panelu wiersz z numerem dokumentu. Przy domyślnym
filtrze wierszy może nie być wcale, więc warunek nigdy się nie spełniał —
a `return` przy tej porażce wypadał **przed** blokiem `finally`, czyli skrypt
nie zamykał zakładki, którą sam otworzył. Filtry nie były więc nawet próbowane;
obserwacja „nie ustawił filtrów" i komunikat „nie otworzyła się" opisywały ten
sam błąd.

Sondy w konsoli potwierdziły, że selektory filtrów są poprawne: panel filtrów
jest wewnątrz panelu historii, widoczny, z polem `input[placeholder="Od"]`
i radiami „Wszystkie" / „Działające na stany". Problem nigdy nie był w nich.

Naprawa:

- historia rozpoznawana po **ID nowej zakładki** (porównanie zbioru zakładek
  przed i po kliknięciu) — bez zgadywania, która jest aktywna i co ma w panelu;
- od momentu wykrycia zakładka jest zamykana w `finally` bez wyjątków;
- zaległe zakładki historii są sprzątane przed każdym produktem i po nim;
- zakładka historii rozpoznawana **dwojako**: po etykiecie („Pozycje
  dokumentów: 0003593") albo po zawartości panelu. Sama zawartość nie
  wystarcza, bo przy pustym wyniku panel nie ma numerów dokumentów — czyli
  dokładnie te zakładki, które zostają po awarii, byłyby niewidzialne dla
  sprzątacza.

## Sprzedaż detaliczna nie wchodzi do próby

Zamówienie z e-commerce (typ **ZOID**) kończy się normalną fakturą **FA**
z magazynu **GLS1** — po tych kryteriach nie da się jej odróżnić od sprzedaży
B2B. A to sprzedaż po cenie 100%, więc wciągnięta do próby **zawyżałaby podłogę**
i pozwoliła zejść niżej, niż wolno wobec partnerów.

Odsiewamy ją **kilkoma niezależnymi sygnałami**, bo żaden nie jest dostępny
zawsze ani nie łapie wszystkich przypadków:

1. **Kontrahent** — `EXCLUDE_CUSTOMERS: ['eSavpol']`. Dopasowanie do granicy
   słowa, nie zwykły podciąg: „eSavpol" nie może trafiać w „Piekarnię
   eSavpolską". Kropka w „eSavpol.pl" jest granicą, więc realny kontrahent
   nadal wpada.
2. **Typ powiązanego zamówienia** — `EXCLUDE_ORDER_TYPES: ['ZOID']`, szukany
   między ukośnikami w numerze (`2026/ZOID/GLS1/003863`). Działa tylko wtedy,
   gdy kolumna z powiązanymi dokumentami jest w widoku, dlatego **uzupełnia**
   listę kontrahentów, a nie ją zastępuje.

3. **Brak NIP-u kontrahenta** — `EXCLUDE_WITHOUT_VAT_CODE`, **domyślnie
   wyłączone**. Firma ma NIP, konsument nie, więc faktura bez NIP-u to niemal
   na pewno detal. To jedyny sygnał, który łapie klientów detalicznych
   **zarejestrowanych** w sklepie: kupują pod własnym nazwiskiem, więc filtr
   po nazwie „eSavpol.pl" (obejmujący tylko zakupy bez rejestracji) ich mija.

   Wyłączone, bo nie wiem, czy w waszych danych każdy partner B2B ma wypełniony
   NIP — a wycięcie prawdziwych partnerów byłoby gorsze od zostawienia kilku
   detalicznych. **Skrypt liczy takie pozycje niezależnie od flagi** i pokazuje
   w statusie („N transakcji bez NIP kontrahenta"), więc najpierw zobacz skalę
   na kilkunastu produktach, potem zdecyduj.

Odrzucone pozycje są liczone: status dopisuje „pominięto N transakcji sprzedaży
detalicznej". Gdy zostanie zero, komunikat rozróżnia przypadki — „brak sprzedaży
B2B — wszystkie N transakcji to sprzedaż detaliczna" to zupełnie inna informacja
niż „produkt się nie sprzedaje", a bez tego rozróżnienia wyglądałyby tak samo.

## Do ustawienia przed pierwszym poważnym użyciem

`EXCLUDE_CUSTOMERS` jest już ustawione na `['eSavpol']` — patrz sekcja wyżej.
Jeśli sprzedaż detaliczna idzie w waszym ERP także przez innego kontrahenta,
dopisz jego nazwę do tej listy.

## Czego to nie robi

- **Nie zna marży.** Podłoga z tej analizy mówi tylko o relacjach z partnerami.
  Czy dana cena jest opłacalna, rozstrzyga cena zakupu, której tu nie czytamy.
- **Nie rozróżnia kanałów ani grup rabatowych.** Wszystkie faktury lecą do
  jednego worka. Gdyby to było potrzebne, `CustomerDesc` już jest odczytywany
  i da się po nim grupować.
- **Nie liczy udziału wolumenu powyżej zadanej ceny.** To najbardziej wprost
  decyzyjna liczba („jeśli ustawię 100 zł, podcinam X% umów") — ale wymaga
  podania ceny na wejściu, czyli innego kształtu narzędzia. Warte zrobienia,
  gdy ta wersja się sprawdzi.
