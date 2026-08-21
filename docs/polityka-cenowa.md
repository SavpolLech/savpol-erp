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

**Okres: od 1 stycznia bieżącego roku** (`FROM_YEAR_START`). Przez dwa lata
wstecz cena zmieniała się tak czy inaczej, więc starsze transakcje nie opisują
dzisiejszych warunków — a im dłuższy okres, tym więcej stron do przewinięcia.
Data trafia do **filtra w ERP**, nie tylko do odsiewu w skrypcie, więc lista
jest krótsza u źródła i przebieg jest szybszy. Odsiew po stronie skryptu
zostaje jako druga linia obrony, gdyby filtr nie zadziałał.

**Uwaga na styczeń i luty:** okno kurczy się wtedy do kilku tygodni i próba
bywa za mała. Nie wydłużamy go po cichu — status powie „tylko N transakcji",
a `FROM_YEAR_START: false` przywraca okno kroczące `MONTHS_BACK` (12 miesięcy),
gdy świadomie chcesz szerszej próby.

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

## Do ustawienia przed pierwszym poważnym użyciem

**`EXCLUDE_CUSTOMERS` jest puste**, więc statystyka obejmuje **także sprzedaż
własnego e-commerce**, jeśli przechodzi ona przez ERP jako kontrahent. To
zaniża podłogę: porównywalibyśmy się z własną ceną detaliczną zamiast z cenami
partnerów B2B. Wpisz tam fragment nazwy tego kontrahenta (dopasowanie bez
wielkości liter, bez polskich znaków).

Nie wiem, jak ten kontrahent się nazywa w waszym ERP — dlatego lista jest pusta,
a nie zgadnięta.

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
