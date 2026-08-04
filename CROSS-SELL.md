# Cross-sell z historii faktur — kontekst i stan prac

Dokument opisuje, po co powstał `savpol-historia-faktur.user.js`, jakie decyzje
zostały podjęte i dlaczego, oraz co jest następnym krokiem. Jest samowystarczalny —
nie wymaga znajomości wcześniejszych rozmów.

## Cel biznesowy

Savpol sprzedaje hurtowo surowce cukiernicze i lodziarskie. Uruchamiamy e-commerce
i na stronie produktowej chcemy sekcję **„Często kupowane razem"**.

Skrypt Tampermonkey scrapuje historię faktur wybranego produktu (anchora) z ERP,
liczy co-occurrence i typuje 4 produkty do cross-sellingu — z pominięciem tych,
których sklep nie może wysłać kurierem.

**Kluczowe rozróżnienie:** historia faktur opisuje obecnych odbiorców **hurtowych**.
Klientem e-commerce ma być mała lokalna cukiernia. Dane pokazują, co jest kupowane
razem, ale nie mówią, co kupi klient online — dlatego filtry gramatury i dostępności
są tak samo ważne jak sam co-occurrence.

## Stan obecny (v2.8.0)

Skalibrowane na **siedmiu** anchorach (tabela w „Kalibracja"). Roadmapa zamknięta
w punktach 1-4; został krok 5 (podstawianie wariantów).

- Scrapowanie historii faktur z paginacją (limit 100 faktur, od 1.01.2024).
- Analiza co-occurrence liczona **per faktura**, nie per pozycja.
- Wykluczenia logistyczne z **nazwy** produktu, odporne na brak diakrytyków
  (`fold()`).
- Filtr gramatury opakowania (`MAX_PACK_KG`).
- Deduplikacja po rodzinie produktu (`ONE_PER_FAMILY`).
- Nadpisania per SKU (`skuDeny` / `skuAllow`).
- **Wykluczenie po grupie katalogowej** (`GROUP_FILTER`, `groupDeny`/`groupAllow`).
- **Filtr dostępności katalogowej** (`AVAILABILITY`): `DYS.` na żywo, odrzucanie
  stanu ≤ 0, „Towaru nisko rotującego" i kartotek pomocniczych (`-M`, `-R`),
  z dobieraniem kolejnych kandydatów z puli `dedupedRanked`.
- **SKU do schowka** (`CLIPBOARD`) — główny wynik pracy, lista rozdzielona
  przecinkami, np. `0020669,0006418,0003863,0005105`.
- Eksport: `cross_sell_<SKU>.csv` + opcjonalnie `historia_faktur_<SKU>.csv`.
- **Nakładka z postępem** (`PROGRESS`) — pływające okno z etapem, paskiem,
  licznikiem `X / 100 faktur` i czasem trwania. Przebieg trwa kilka minut,
  a napis na przycisku w toolbarze ERP jest ciasny i łatwo go przeoczyć.
- Diagnostyka w konsoli (`console.table`): ranking, wykluczenia z nazwą reguły,
  duplikaty rodzin, wynik filtra dostępności, pokrycie sprawdzania grup.

Filtr dostępności, grupy i nakładka postępu wymagają DOM-u, więc **nie są
testowalne offline** —
analiza co-occurrence, reguły nazwowe i format schowka są. Patrz „Testowanie
zmian w regułach".

### `EXCLUSIONS` filtruje TYLKO kandydatów, nigdy anchora

Ważne rozróżnienie, bo raz je pomyliłem i kosztowało to jedną wersję.

Produkty chłodnicze i mroźnicze **są** na e-commerce — z odbiorem osobistym
z magazynu. Dla nich cross-sell jest potrzebny **tak samo** jak dla pozostałych.
Reguły wykluczeń istnieją wyłącznie po to, żeby **nie polecać** produktów, których
nie da się wysłać — nie po to, żeby decydować, dla których produktów liczyć.

W v2.5.0 dodałem bramkę anchora (`ANCHOR_GATE`), która pomijała cross-sell, gdy
sam anchor pasował do wykluczenia. **Błąd interpretacji** wypowiedzi właściciela
produktu („nie chcę robić cross-sellingu do takich produktów" = nie polecać ich
jako kandydatów, nie: nie liczyć dla nich). Usunięta w v2.7.0.

Objaw, po którym to wyszło: anchor `0023812` (Śmietana kwaśna Piątnica) zwrócił
zero produktów, choć dane były dobre — N=99, lider 26%, pula 26 pozycji.

### Pipeline

1. Klik „Historia produktu" dla zaznaczonego produktu w katalogu.
2. Ustawienie filtrów: data od 1.01.2024 + radio „Wszystkie".
3. Iteracja po fakturach typu `FA`, otwarcie każdej, odczyt pozycji
   (SKU, nazwa, ilość). Deduplikacja po numerze dokumentu.
4. `analyzeCrossSell()` — kroki opisane niżej.
5. Zapis CSV.

### Kroki analizy

| krok | co robi |
|---|---|
| 1 | `N` = liczba faktur, w których **faktycznie widać anchor-SKU** wśród pozycji |
| 2 | dla każdego innego SKU: w ilu z tych `N` faktur wystąpił (raz na fakturę) |
| 3 | wykluczenia: format SKU → `skuDeny` → `skuAllow` → reguły nazwowe → próg gramatury |
| 4 | próg sygnału: `count >= MIN_COUNT` **i** `share >= MIN_SHARE` |
| 5 | max 1 produkt na rodzinę, potem `TOP_N` |

Jeśli po filtrach nie zostanie nikt — CSV zawiera wiersz `"sygnał zbyt słaby"`,
zamiast wymuszania słabych kandydatów.

## Konfiguracja

Wszystko na górze pliku.

### `CROSS_SELL`

| pole | wartość | uzasadnienie |
|---|---|---|
| `MIN_COUNT` | 4 | **główny próg** — patrz „Kalibracja" |
| `MIN_SHARE` | 5 | tylko podłoga szumu; wiąże mocniej niż `MIN_COUNT` przy `N < 80` |
| `TOP_N` | 4 | tyle slotów ma sekcja na stronie produktowej |
| `MAX_PACK_KG` | 10 | worek 25kg to czyste B2B; 10kg (cukier puder) jeszcze ujdzie |
| `ONE_PER_FAMILY` | true | bez tego lista to jedna rekomendacja powtórzona 3× |

### `EXCLUSIONS`

Kolejność sprawdzania: `skuPattern` → `skuDeny` → `skuAllow` → `substring` →
`prefix` → `allOf` → `words` → gramatura. **Decyzja per SKU wygrywa z całą heurystyką** —
`skuAllow` obchodzi także próg gramatury.

- `skuPattern` — wzorzec prawidłowego SKU produktu (`/^[0-9]{6,8}(-[A-Z])?$/`).
  Pozycje niepasujące to **usługi i opłaty, nie towary** — patrz „Pozycje, które
  nie są produktami".
- `skuDeny` — `{ '0000263': 'powód' }`. Wyklucz zawsze. Rejestr wiedzy, której
  nazwa nie zdradza.
- `skuAllow` — ratunek na fałszywe trafienia reguł.
- `substring` — fragment gdziekolwiek w nazwie. Można podać
  `{ frag: 'śmietan', unless: ['aromat', 'budyń'] }` — trafienie anulowane,
  gdy nazwa zawiera któryś z `unless`.
- `prefix` — nazwa musi się **zaczynać** od fragmentu.
- `allOf` — wszystkie fragmenty grupy muszą wystąpić (dowolna kolejność).
- `words` — dopasowanie na granicy słowa, przez klasy Unicode (`\p{L}`),
  **nie** przez `\b`. To istotne: `\b` w JS działa na ASCII, więc `śmietana`,
  `żółtko` i `masło` nie działałyby poprawnie.
- `wordExceptions` — wyjątki dla `words`, np. `masło` + `kakaowe`.

## Kalibracja na realnych danych

Reguły zostały dostrojone na siedmiu anchorach:

| anchor | produkt | faktur | pozycji | unikalnych partnerów | mediana pozycji/fakturę | lider |
|---|---|---|---|---|---|---|
| `0022850` | Delipasta PISTACJA PURE — FABBRI | 100 | 1089 | 408 | 9 | 31% |
| `0031629` | Krem pistacjowy z Kadayif — ZENTIS | 80 | 1480 | 538 | 14 | 41% |
| `0021269` | Orzech laskowy prażony Piemonte IGP 1kg | 100 | 1031 | 452 | 8 | **11%** |
| `0018835` | Orzech laskowy blanszowany prażony 1kg | 100 | 1326 | 582 | 10 | 15% |
| `0023103` | Krem orzechowo-mleczny Milky Hazelnut 4kg — ALFAPRO | 100 | 1568 | 534 | 10 | 20% |
| `0011265` | Prażynki Cacao Barry Paillete Feuilletine 2,5kg | **59** | 661 | 322 | 10 | 12% |
| `0031401` | Jogurt Skyr naturalny 5kg — Piątnica | 100 | 868 | 320 | **4** | 12% |

Dwa warianty orzecha laskowego (`0021269` i `0018835`) mają wspólne tylko **34%**
partnerów — mimo niemal identycznej nazwy produktu. Podobieństwo nazwy anchora
nie oznacza podobnego koszyka; nie warto zakładać, że warianty da się analizować
razem.

### Dlaczego głównym progiem jest `MIN_COUNT`, a nie `MIN_SHARE`

Historia zmian tego progu jest pouczająca i warto jej nie powtarzać:

- **25%** (pierwotna specyfikacja) → 1 kandydat. Przy 400-500 różnych partnerach
  żaden konkretny produkt nie osiąga wysokiego udziału; przechodził tylko cukier
  kryształ, czyli surowiec uniwersalny występujący obok wszystkiego.
- **10%** → 4 kandydatów dla obu pastyowych anchorów, ale **2 dla orzecha**.
- **`MIN_COUNT: 4` + `MIN_SHARE: 5`** → 4 dla wszystkich trzech.

Przyczyna jest strukturalna: **koncentracja koszyka zależy od roli produktu
w produkcji.** Krem pistacjowy ma wąskie zastosowanie, więc jego lider ma 41%.
Orzech laskowy jest wsadem do wielu różnych receptur, więc sygnał się rozprasza
i lider ma tylko 11%. Żadna stała wartość procentowa nie obsłuży obu przypadków.

Liczba wspólnych faktur jest stabilniejsza między produktami niż udział procentowy.
`MIN_SHARE` zostaje jako podłoga szumu — przy `N < 80` zaczyna wiązać mocniej niż
`MIN_COUNT` i chroni przed rekomendacjami z próby 20 faktur.

Odrzucone warianty: próg relatywny („≥25% udziału lidera") przepuszczał 32 pozycje
dla orzecha — za luźny, bo skaluje się razem z rozproszeniem, którego miał pilnować.

### Dlaczego gramatura mierzona jest z nazwy

ERP nie udostępnia przy produkcie informacji o sposobie przechowywania ani (na razie)
wagi opakowania w formie strukturalnej. Gramatura jest natomiast w nazwie
(„worek 25kg", „4200g", „5L”), więc `biggestPackKg()` wyciąga wszystkie liczby
z jednostką kg/g/L/ml i bierze największą. Liczby bez jednostki są ignorowane —
inaczej kod produktowy w „Mieszanka kulek 263004 2,5kg" zostałby odczytany jako waga.

**Znane ograniczenie:** kilogram jest słabym kryterium „hurtowości". 4200g brzoskwiń
w syropie to opakowanie roboczej wielkości, a 5kg proszku do pieczenia to już
zamówienie piekarni — bo proszku używa się w gramach, a brzoskwiń w puszkach.
Lepszym rozwiązaniem jest podstawianie wariantów (patrz roadmap).

Pomocniczy pomiar (kolumna „Ilość" w CSV jest **w kilogramach**, nie w sztukach,
więc `ilość / gramatura` = liczba opakowań):

| produkt | opak./fakturę (mediana) | % faktur z 1 opakowaniem |
|---|---|---|
| Olej rzepakowy 5L | 1,2 | 50% |
| Cukier puder 10kg | 2,0 | 47% |
| Proszek do pieczenia 5kg | 5,0 (=25kg) | 33% |
| Brzoskwinia w syropie 4200g | 1,4 | 13% |
| CUKIER KRYSZTAŁ 25kg | 2,0 (=50kg) | 22% |

### Pozycje, które nie są produktami

Na fakturach są też **usługi**: `KurierDPD` / „Dostawa - Kurier DPD". Nie ma ich
w katalogu produktów i nie da się ich polecić, ale w co-occurrence liczą się
normalnie.

Skala jest mała — 11 pozycji w 38 plikach — ale **rośnie przy niskim N**. Anchor
`0023990` (Płyn do przypaleń, N=10) miał dostawę na **pierwszym miejscu z 40%
udziału**, bo wszystkie realne produkty wystąpiły po jednej fakturze. Uratował nas
przypadek: filtr dostępności nie znalazł `KurierDPD` w katalogu i odrzucił ją.

Filtr jest **strukturalny, nie nazwowy** — `skuPattern` sprawdza format SKU
(6-8 cyfr + opcjonalny sufiks `-M`/`-R`/`-P`). Odporny na nazwy nowych usług,
bo nie zgaduje z treści. Sprawdzony na wszystkich 38 plikach: jedyne SKU
nienumeryczne to `KurierDPD`.

### Pułapki nazewnictwa, które kosztowały najwięcej

Warto o nich wiedzieć przed dopisywaniem reguł:

- **Odmiana polska łamie dopasowanie po pełnym słowie.** Reguła `śmietana` nie łapała
  ani „Śmietanka", ani formy „**Śmietano** pod. Kremówka" (bag-in-box 33%, czysta
  chłodnia). Dlatego rdzeń `śmietan` + lista `unless`, a nie pełne słowa.
  Analogicznie `twaróg` nie łapało „nadzienie twarogowe" → dodano rdzeń `twarog`.
- **Nazwy smaków wyglądają jak kategorie.** `masło` wykluczało „Polewa NUTTY Karmel
  solone masło" i „Delipasta PALONE SOLONE MASŁO" — produkty shelf-stable. Stąd
  wyjątki `delipasta` i `polewa`.
- **Nie matchuj po nazwach owoców.** „Delipasta Malinowa" nie jest mrożonką.
  Jedyny pewny keyword to rdzeń `mrożon`.
- **Liczba mnoga potrzebuje osobnego rdzenia.** `prefix: 'wafel'` nie łapało
  „Wafle płaskie… HANMART", bo `wafl` **nie jest** prefiksem `wafel` (między
  „waf" i „l" stoi „e"). Żaden z tych rdzeni nie zawiera drugiego — muszą być oba.
- **`serek` to nie `ser`.** „Serek kremowy 5kg — Piątnica" (nabiał świeży)
  przechodził, bo `ser` po granicy słowa go nie łapie, a `serow` też nie.
- **W nazwach z ERP trafiają się literówki bez diakrytyków.** „Krem **ro**s**linny**
  śnieżnobiały… MONNA LISA" — brak `ś` w jednym słowie, przy poprawnym
  „śnieżnobiały" w następnym, więc to literówka, nie konwencja ASCII. Reguła
  `allOf: krem+roślinn` tego nie łapała. Dlatego **wszystkie** dopasowania nazw
  idą przez `fold()`, które składa nazwę i wzorzec do postaci bez diakrytyków.
  Skala: 1 nazwa na 1401, ale był to przeciek produktu chłodniczego.
- **`\b` nie działa na polskich znakach** — patrz `wordRegex()`.
- **Znany przeciek, nierozwiązany:** „Kulinarna kremowa 18% 5kg — FIGAND" to
  śmietanka kulinarna (chłodnia), ale nazwa nie zawiera ani `śmietan`, ani `ser`,
  ani `krem`+`roślinn`. Wystąpiła 1× w czterech plikach, więc jest poniżej progu
  i nie wpływa dziś na wynik. Wyłapie ją grupa `Nabiał` po podłączeniu katalogu.
- **Produkty jajeczne wymagają trzech osobnych reguł**, bo dzielą się na
  chłodnicze i shelf-stable wzdłuż innej linii niż nazwa:
  `jajow` (masa jajowa pasteryzowana), `{ frag: 'jaja', unless: ['proszk'] }`
  (jaja gotowane OVOVITA — chłodnia; ale „Jaja kurze **w proszku** worek 10kg
  — OVOPOL" jest shelf-stable, analogicznie do mleka w proszku) oraz
  `allOf: ['białko','płynn']` (białko płynne BALTICOVO — chłodnia; białko
  w proszku i albumina przechodzą). Białko płynne miało 5 faktur przy anchorze
  `0021269`, czyli **powyżej progu** — nie był to przeciek teoretyczny.
  Status białka płynnego wywnioskowany z decyzji o masie jajowej i jajach
  gotowanych, nie potwierdzony wprost.
- **Do sprawdzenia:** „Marcepan 50% blok 5kg — BARIMA" przechodzi, a grupa
  `Dekorowanie\Dekoracje marcepanowe` jest na denyliście. Blok marcepanu to
  surowiec, nie dekoracja, więc prawdopodobnie słusznie — ale warto potwierdzić.
- Produkty mrożone, których nazwa nie zawiera „mrożon": croissanty
  (VANDEMOORTELE, EUROPASTRY). Wyłapane osobną regułą.

### Decyzje logistyczne podjęte przez właściciela produktu

- Mleko UHT (bag-in-box i kartony) — **chłodnia**, wykluczone (`allOf: mleko+uht`).
  Mleko w proszku i skondensowane zostają.
- Produkty i nadzienia serowe cukiernicze (Sermiks, Sernik Wiedeński, ProSer,
  „Serowe prod.") — **chłodnia**, wykluczone (rdzeń `serow`).
- Krem roślinny do bicia (Decor Up) — **chłodnia**, wykluczony
  (`allOf: krem+roślinn`). Warunek na „roślinn" jest konieczny: samo „krem"
  wyrzuciłoby połowę asortymentu, w tym typowe anchory (kremy pistacjowe,
  orzechowe, budyniowe).
- Mrożone pieczywo VANDEMOORTELE — **mroźnia**, wykluczone po marce.
  Wykluczenie po marce, a nie po typie produktu, bo asortyment nie ma wspólnego
  rdzenia w nazwie: croissanty, blaty z ciasta francuskiego, rogaliki, precle,
  ciabatty, briosze, muffiny, torty. Reguła na typ wymagałaby dopisywania bez końca.
  **Uwaga:** `europastry` i `panesco` dodane przeze mnie przez analogię — to ci sami
  dostawcy mrożonego pieczywa (Croissant XXL PANESCO, Chleb Brioche EUROPASTRY,
  Ciasto Tort miodowy PANESCO), ale właściciel produktu potwierdził tylko
  VANDEMOORTELE. Do weryfikacji.
- Marki, które **nie** są wykluczeniem, mimo że pojawiły się w pierwotnej
  specyfikacji: EKSTRA, Jaskółka Czerwona, LESAFFRE, Hirondell, MIRAN, GRODCONO,
  Palma BIELMAR, MILENA, Esperto ALFAPRO. Wykluczanie po marce wyrzucało za dużo.
  Zamiast tego: rdzeń `margaryn`, prefiks `wafel`, `allOf: drożdż+śwież`.

## Aktualny wynik

Wszystkie trzy policzone przy aktualnych progach (`MIN_COUNT: 4`, `MIN_SHARE: 5`)
i pełnym zestawie reguł. Każdy anchor daje pełne 4 pozycje.

```
anchor 0022850 (Delipasta PISTACJA):
  0004446  16%  Polewa TOPPING Czekoladowa - FABBRI
  0003246  15%  Pojemnik izotermiczny biały KA1000
  0012535  12%  Mini pianki 500g - MIRAN
  0004304  10%  Delipasta WANILIA SUPER - FABBRI

anchor 0031629 (Krem pistacjowy Kadayif):
  0020669  41%  Olej rzepakowy 5L
  0006418  15%  Cukier puder 10kg - A&W
  0000263  11%  Proszek do pieczenia - worek 5kg - BOWIKA   <-- sporne, patrz niżej
  0022485  10%  Brzoskwinia kostka w syropie 4200g - ALFAPRO

anchor 0021269 (Orzech laskowy prażony):
  0007650  11%  Migdały płatki 1kg
  0010839  10%  Pomidory suszone połówki w oleju 1600g/900g
  0007726   9%  Siemię lniane a 5kg
  0006418   8%  Cukier puder 10kg - A&W

anchor 0018835 (Orzech laskowy blanszowany prażony):
  0008168  15%  Orzech włoski a 1kg
  0020669  14%  Olej rzepakowy 5L
  0006418  12%  Cukier puder 10kg - A&W
  0005223  11%  Mleko Polfink skond słodz. 1000g pusz.

anchor 0023103 (Krem orzechowo-mleczny Milky Hazelnut):
  0021899  20%  Krem o smaku orzechowym Nutty Cream 4kg - ALFAPRO
  0020669  18%  Olej rzepakowy 5L
  0032222  14%  Czekolada biała Namur White 29% 10kg - ChocConcept
  0006418  13%  Cukier puder 10kg - A&W

anchor 0011265 (Prażynki Paillete Feuilletine) — N=59, remisy:
  0006418  12%  Cukier puder 10kg - A&W
  0000533  12%  Galaretka truskawkowa worek 5kg - BOWIKA
  0020669  12%  Olej rzepakowy 5L
  0022634   7%  Biszkopt ciemny 10kg - PANEM

anchor 0031401 (Jogurt Skyr) — POMINIĘTY przez bramkę anchora (word:jogurt)
```

Wyniki to zawartość schowka: `skusToText()` zwraca je jako `0004446,0003246,...`.

**`0011265` stoi na najsłabszej podstawie.** N=59 (jedyny anchor poniżej 100),
a trzy pierwsze pozycje mają identyczne 7 faktur — o kolejności decyduje wtedy
alfabet (`localeCompare` na nazwie), nie siła sygnału. Czwarty kandydat ma
dokładnie 4 faktury, czyli siedzi na progu `MIN_COUNT`. Przy niskim N remisy
zaczynają dominować i ranking staje się arbitralny.

**`0031401` pokazał, że koszyk zależy od typu odbiorcy, nie tylko od produktu.**
Skyr kupują odbiorcy gastronomiczni: w ogonie siedzą farsz kapuściano-pieczarkowy,
parówki, szpinak siekany, szynka gotowana w plastrach — po 5 faktur każdy.
Mediana pozycji na fakturę to 4, przy 8-14 w pozostałych plikach. Wykluczenia
były pisane pod asortyment cukierniczy, więc dla gastronomii miały dziury:
`szynka` nie miała żadnej reguły (`wędlina` i `kiełbasa` jej nie łapią).
Dodany rdzeń `szynk` (decyzja właściciela produktu: chłodnia).

Powtarzalne pozycje między anchorami: `0020669` (olej rzepakowy) w 3 z 5,
`0006418` (cukier puder) w 4 z 5. To dobra wiadomość dla cache katalogu —
kandydaci się powtarzają, więc cache szybko się nasyci.

### Wpływ `ONE_PER_FAMILY` — zmierzony

Sprawdzone na czterech anchorach przez porównanie z flagą `true` i `false`:

| anchor | efekt |
|---|---|
| `0022850` | usuwa drugi pojemnik izotermiczny (KA500 obok KA1000) |
| `0031629` | usuwa cukier wanilinowy obok cukru pudru |
| `0021269` | bez zmian |
| `0018835` | bez zmian |

Obawa, że rodzina `orzech` sklei różne orzechy (włoski / arachidowy / nerkowca /
pistacjowy) i zubozy listę dla anchora orzechowego, **nie potwierdziła się**:
pozostałe orzechy mają 5-9 wspólnych faktur i tak siedzą poniżej czwórki.

#### OTWARTE: rodzina `krem` jest za szeroka

Anchor `0023103` (Krem orzechowo-mleczny) ujawnił problem, którego nie było
w poprzednich czterech. Rodzina `krem` skleiła **6 różnych kremów smakowych**:

| odrzucony | faktur |
|---|---|
| Krem o smaku orzechowym z chrupkami Crocco Cream Nut 6kg | 15 |
| Krem biały mleczny z chrupkami Crocco Cream White 6kg | 13 |
| Krem o smaku solonego karmelu Salted Carmello 4kg | 9 |
| Krem do nadziewania pistacjowy 15% 4kg | 8 |
| Krem z białą czekoladą, ziarnami kakaowymi i waflami | 7 |
| Krem o smaku ciemnej czekolady Crocco Cream | 5 |

To nie warianty gramatury jednego produktu (jak cukier kryształ / puder), a różne
smaki, czyli osobne produkty. Ta sama wątpliwość dotyczy rodzin `polewa`,
`delipasta` i `czekolada` — w nich pierwszy wyraz nazwy jest **typem produktu**,
nie tożsamością produktu.

Skutek na tym anchorze jest jednak obronny, bo dedup wpuścił w zwolnione miejsca
pozycje z innych kategorii:

```
z dedupem:  Nutty Cream (20), Olej (18), Czekolada biała (14), Cukier puder (13)
bez dedupu: Nutty Cream (20), Olej (18), Crocco Nut (15),      Czekolada biała (14)
```

#### ROZSTRZYGNIĘTE: zostaje 1 na rodzinę

Cel biznesowy: **80% wzrost AOV klienta e-commerce, 20% klienta B2B**, który
korzysta z platformy, ale ma już swojego handlowca. To rozstrzyga sprawę:

- Sekcja „Często kupowane razem" jest slotem na **komplementy**. Pokazanie
  alternatyw (kolejnych kremów) zaprasza do ponownego rozważenia wyboru, który
  klient właśnie zrobił — to ryzyko dla konwersji, nie wzrost AOV. Warianty
  smakowe należą do osobnej sekcji „Podobne produkty".
- Klient e-commerce (80%) to mała cukiernia w self-service, która nie zna
  pełnego asortymentu. AOV rośnie u niej przez **przypomnienie o innej potrzebie**
  — oleju, białej czekoladzie, cukrze pudrze — czyli o pozycjach, o których
  zapomni albo kupi je gdzie indziej. Każda to dodatkowa linia w koszyku.
- Klient B2B (20%) asortyment zna, a do przypominania mu o smakach ma handlowca.

Obecne zachowanie samo z siebie daje **1 slot na rodzinę anchora** (najmocniejszy
przedstawiciel) i 3 na inne kategorie — czyli proporcję bliską zamierzonej,
bez żadnej dodatkowej konfiguracji.

Odrzucone: `FAMILY_NO_DEDUP` (idzie w stronę większej liczby alternatyw) oraz
limit 2 na rodzinę (oddaje połowę sekcji na warianty, przeserwowując te 20%).

**Do rozważenia na przyszłość:** `droppedByFamily` jest już wyliczane i zawiera
dokładnie te warianty smakowe. To gotowy, darmowy wsad do osobnej sekcji
„Inne smaki" / „Podobne produkty", która obsłuży klienta B2B bez rozcieńczania
sekcji komplementów.

`0000263` (proszek 5kg) przechodzi próg gramatury, ale mediana zakupu to 5 worków
(25kg) — to opakowanie przemysłowe. W katalogu istnieje `0008137`, ten sam proszek
w worku 1kg, ze stanem magazynowym. To wzorcowy przypadek dla podstawiania wariantów.

## Roadmap

Kroki 1-4 **zrobione** (v2.4.1-2.5.0), opis został jako uzasadnienie decyzji.
Otwarty jest krok „Podstawianie wariantów" oraz obserwacje w „Cache: stan faktyczny".

### 1. Odczyt katalogu produktów

Widok katalogu (`/pl/katalog/csitems/`) po wyszukaniu frazy zwraca siatkę z kolumnami:
`SYMBOL` (SKU), `BRAND`, `OPIS` (nazwa z gramaturą), `GRUPA PRODUKTU` (ścieżka
kategorii, np. `B2B\Kategorie\Dodatki spożywcze\Pozostałe`), `PRODUCT MANAGER`,
`STATUS`, `JM`, `DYS.` (stan dyspozycyjny), `REZ.`, `ILOŚĆ`, `CENA Ś.`, `WARTOŚĆ`.
Pod nazwą pojawiają się też podpisy w rodzaju „Market", „Towar nisko rotujący".

**Do zrobienia:** ustalić selektory tej siatki i pola wyszukiwania. Skrypt już umie
czytać siatki ERP przez `tr.cs-grid-data-row` i `td[data-datafield="..."]` —
trzeba poznać nazwy `data-datafield` dla kategorii i stanu.

### 2. Filtr dostępności (największy zysk, najmniejszy koszt)

Rekomendowanie produktu bez stanu magazynowego jest gorsze niż rekomendowanie worka
25kg. Wśród 6 wariantów proszku do pieczenia **trzy mają stan 0**. Dochodzi flaga
„Towar nisko rotujący" jako sygnał, czego nie promować.

Stan **nie może być cache'owany** — zmienia się codziennie.

### 3. Grupy produktów zamiast regex-ów

Lista grup jest już w konfiguracji (`EXCLUSIONS.groupDeny`) razem z dopasowaniem
po prefiksie ścieżki (`findGroupExclusion()`), ale **nieaktywna** — grupa nie jest
dostępna w widoku historii faktur, tylko w katalogu. Aktywuje się po kroku 1-2.

Grupy podane przez właściciela produktu jako te, w których jest **najwięcej**
produktów niewysyłkowych:

```
B2B\Kategorie\Dekorowanie\Dekoracje cukrowe
B2B\Kategorie\Dekorowanie\Dekoracje marcepanowe
B2B\Kategorie\Dekorowanie\Dekoracje opłatkowe
B2B\Kategorie\Nabiał
B2B\Kategorie\Lodziarskie produkty\Wafle
B2B\Kategorie\Dodatki spożywcze\Drożdże
B2B\Kategorie\Pieczywo, ciasta
B2B\Kategorie\Mięso, wędliny, ryby
B2B\Kategorie\Gastronomiczne produkty\Farsze
```

Dopasowanie po prefiksie, więc `...\Nabiał` łapie wszystkie podgrupy poniżej,
a `...\Lodziarskie produkty\Wafle` tylko ten liść. Normalizacja białych znaków
jest konieczna, bo komórka siatki zawija ścieżkę i potrafi powtórzyć nazwę liścia
pod spodem.

#### To NIE jest lista „wszystko tu jest niewysyłkowe"

Właściciel produktu określił te grupy jako zawierające **najwięcej** takich
produktów, nie wyłącznie takie. Odrzucenie całej grupy nadmiernie wyklucza.
Znane przypadki, sprzeczne z decyzjami podjętymi wcześniej:

| grupa | co zostanie błędnie odcięte | dlaczego to problem |
|---|---|---|
| `...\Dodatki spożywcze\Drożdże` | drożdże suche i instant | shelf-stable; reguła `allOf: drożdż+śwież` celowo je przepuszczała |
| `...\Nabiał` | mleko w proszku pełne i odtłuszczone, mleko skondensowane | świadomie zostawione w rankingu (`allOf: mleko+uht` celowo wymaga „uht") |
| `...\Dekorowanie\Dekoracje cukrowe` | posypki, dekoracje czekoladowe, lentilki | trwałe i drobne; występowały wśród realnych kandydatów |

Dlatego:

1. `skuAllow` wygrywa z `groupDeny` — to miejsce na te wyjątki.
2. Do logu trzeba dopisać, **co i przez którą grupę** zostało odrzucone, żeby dało
   się wyłapać cenne pozycje ginące hurtowo.
3. Docelowo lepszym rozwiązaniem może być denylista na **liściach**, nie na
   gałęziach nadrzędnych (np. `Nabiał\Śmietana` zamiast całego `Nabiał`) —
   do rozważenia, gdy będzie widać pełne drzewo podgrup.

#### Denylista działa w dwie strony

Nadmierne wykluczanie opisano wyżej. Odwrotne ryzyko: wszystko, czego **nie ma**
na liście, domyślnie jedzie kurierem — więc brakująca gałąź chłodnicza przejdzie
po cichu, bez żadnego sygnału.

Dlatego log musi zawierać **grupy występujące wśród kandydatów, których nie ma
na denyliście**. Wtedy przy każdym przebiegu widać listę gałęzi do przejrzenia,
a denylista rośnie świadomie.

Reguł nazwowych z `EXCLUSIONS` **nie usuwać** — zostają jako druga warstwa dla SKU,
których nie ma jeszcze w cache, i jako zabezpieczenie przed dziurami w denyliście.

### 4. Podstawianie wariantów

Jeśli sygnał trafia w duże opakowanie, a istnieje ten sam produkt w mniejszym
(i ze stanem) — podmień SKU. Rozwiązuje problem proszku 5kg systemowo.

**Decyzja do podjęcia:** oznacza to rekomendowanie SKU, które samo nie zapracowało
na sygnał co-occurrence (proszek 1kg ma 2 faktury i nigdy nie przeszedłby progu).

### 5. Cache katalogowy — ZROBIONY I USUNIĘTY (v2.6.0)

Historia warta zapamiętania, bo to był błąd projektowy w moim własnym zaleceniu.

Cache trzymał `SKU → { group, packKg, ts }` w GM storage pod kluczem
`savpol_catcache_v1`. Uzasadnienie brzmiało: kategoria i gramatura są stabilne,
więc można je cachować i oszczędzić zapytania do katalogu.

**Uzasadnienie było błędne.** Grupa i stan `DYS.` przychodzą z **tego samego
wiersza katalogu, w jednym zapytaniu**. Skoro stan musi być świeży przy każdym
uruchomieniu, zapytanie i tak leci — a wtedy grupa jest darmowa. Cache zapisywał
dane, których nikt nie czytał: `applyAvailabilityFilter()` zawsze pytał na żywo.

Dodatkowo `packKg` w cache nie wnosiło nic nowego, bo liczyła je ta sama
`biggestPackKg()` z nazwy, której używa filtr gramatury.

Usunięty w v2.6.0 razem z `@grant GM_setValue` / `GM_getValue`. Gdyby wracał
magazyn wyników (niżej), granty trzeba dopisać z powrotem.

**Wniosek do zapamiętania:** cache płaci się tylko wtedy, gdy pozwala **pominąć
zapytanie w całości**. Cachowanie jednego pola z odpowiedzi, po którą i tak
musimy pójść, nie oszczędza niczego.

Jedyne miejsce, gdzie ten cache mógłby zadziałać: produkt odrzucony przez grupę
nigdy nie potrzebuje stanu, więc cached group na denyliście = odrzucenie bez
zapytania. Nie zaimplementowane — patrz „Magazyn wyników" jako lepszy użytek
tego samego miejsca.

### Znane ograniczenie: pokrycie sprawdzania grup

`applyAvailabilityFilter()` przerywa pętlę po zebraniu `TOP_N` kandydatów, więc
grupy zna tylko dla części puli. Log „grupy spoza denylisty", który miał pilnować
dziur w denyliście, widzi zatem 4-8 SKU, nie cały ranking.

Od v2.5.0 log wypisuje jawnie `sprawdzono X z Y pozycji puli`, żeby pusta lista
nie wyglądała na potwierdzenie kompletności. Sprawdzanie całej puli dałoby lepszą
widoczność, ale kosztuje 11-26 zapytań zamiast 4-8 — do rozważenia, gdy cache
zacznie odcinać część lookupów (punkt 3 wyżej).

## Testowanie zmian w regułach## Testowanie zmian w regułach

Analiza jest czystą funkcją danych, więc da się ją odpalić lokalnie na zapisanych
CSV-kach bez ERP — wystarczy wyciąć fragment źródła i podać wiersze
`{doc, product, sku, qty}`. Tak były walidowane wszystkie reguły. Przy każdej
zmianie warto sprawdzić, że:

- „Deser czekoladowy" i „Serwetki papierowe" **przechodzą** (test word-boundary),
- „Masło kakaowe" i „Aromat śmietankowy" **przechodzą** (test wyjątków),
- „Drożdże suche instant" **przechodzą**, a „Drożdży świeżych karton" **wypada**,
- „Śmietano pod. Kremówka" **wypada** (test rdzenia),
- duplikat tej samej pozycji w jednej fakturze liczony **raz**,
- faktura bez anchora **nie** wchodzi do `N`.
