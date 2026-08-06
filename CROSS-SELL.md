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

## Stan obecny (v2.20.0)

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
- **Nakładka z postępem i wynikiem** (`PROGRESS`) — pływające okno z etapem,
  paskiem, licznikiem `X / 100 faktur` i czasem trwania. Na koniec pokazuje SKU
  w polu z przyciskiem **Kopiuj** i **zostaje na ekranie** do zamknięcia
  krzyżykiem albo do kolejnego przebiegu (`HIDE_AFTER_MS: 0`). Panel jest
  nośnikiem wyniku, nie tylko postępu — autoukrywanie po 15 s zabierało go,
  zanim dało się użyć. Wartość > 0 przywraca samoukrycie.
  Wyłączenie timera samo nie wystarczyło: ERP przerysowuje widok (m.in. przy
  zamykaniu zakładki historii) i wyrzuca element z DOM, więc `progressKeepAlive`
  doczepia **ten sam węzeł** z powrotem co sekundę — nasłuchy i wpisane SKU
  zostają nienaruszone. Pilnowanie kończy się na krzyżyku lub nowym przebiegu.
- **Generator PDP** (`GENERATOR`) — przycisk „Otwórz generator PDP" w panelu
  wyniku otwiera `esavpol-pdp.vercel.app/?sku=<anchor>&cross=<SKU po przecinku>`.
  Generator sam dociąga dane produktu z esavpol.pl, więc krok z otwieraniem
  sklepu i przeklejaniem danych odpada. Wymaga `@grant GM_openInTab`
  (`window.open` jako zapas, gdy uprawnienie nie zostało przyznane po
  aktualizacji). Integracja opisana w `pdp-generator/docs/integracja-erp.md`.
- **Powrót katalogu na anchora** (`FINISH.SEARCH_ANCHOR`) — po sprawdzeniu
  kandydatów wyszukiwarka katalogu zostawała z SKU ostatniego z nich, więc widok
  pokazywał przypadkowy produkt z rekomendacji. Ostatnią czynnością w katalogu
  jest teraz ponowne wyszukanie produktu wyjściowego. Krok kosmetyczny
  i **nieblokujący** — wynik jest już policzony, awaria tutaj tylko loguje
  ostrzeżenie.
- **Przerywanie pracy** (`ABORT`) — przycisk „Przerwij" w nakładce albo ponowne
  kliknięcie przycisku w toolbarze. Przerwanie jest **kooperacyjne i miękkie**:
  patrz „Przerywanie i wyniki częściowe".
- Diagnostyka w konsoli (`console.table`): ranking, wykluczenia z nazwą reguły,
  duplikaty rodzin, wynik filtra dostępności, pokrycie sprawdzania grup.

Filtr dostępności, grupy i nakładka postępu wymagają DOM-u, więc **nie są
testowalne offline** —
analiza co-occurrence, reguły nazwowe i format schowka są. Patrz „Testowanie
zmian w regułach".

### Anchor dla generatora pochodzi z pipeline'u, nie z DOM

Instrukcja integracji proponowała odczyt anchora przez `getMainProductSku()`
w momencie kliknięcia przycisku. To by nie działało: ta funkcja czyta panel
filtrów **widoku historii produktu**, a ten jest zamykany na końcu przebiegu —
w chwili, gdy panel wyniku jest widoczny, jesteśmy już w katalogu.

Dlatego `ui.result(text, anchorSku)` dostaje SKU wprost z pipeline'u, gdzie
i tak je znamy. `getMainProductSku()` został jako zapas, na wypadek gdyby panel
historii jednak był otwarty.

### Przerywanie i wyniki częściowe

Przebieg trwa kilka minut i bez przerywania jedynym wyjściem było przeładowanie
strony, co gubi otwarte zakładki ERP.

**Kooperacyjne, nie natychmiastowe.** Flaga `ABORT.requested` jest sprawdzana
w bezpiecznych punktach: między fakturami, między stronami paginacji, między
kandydatami oraz w każdej iteracji `waitFor()` (tam siedzą najdłuższe
oczekiwania, do 10 s). Skrypt kończy bieżącą operację i wychodzi, zamiast urwać
się w środku klikania po DOM.

**Miękkie — zebrane faktury nie przepadają.** Przerwanie w trakcie scrapowania
nie kasuje pracy: `collectAllInvoicesInterruptible()` zwraca to, co zebrano,
i pipeline **dokańcza analizę oraz eksport** na niepełnej próbie. Po przerwaniu
flaga jest zerowana, żeby sam fakt przerwania nie ubił analizy, dla której
faktury właśnie zebrano. Przerwanie przed pierwszą fakturą kończy przebieg bez
wyniku — nie ma czego analizować.

**Wynik częściowy jest oznaczany na każdym wyjściu**, bo po samej zawartości
jest nieodróżnialny od pełnego:

| wyjście | oznaczenie |
|---|---|
| nazwa pliku CSV | sufiks `_CZESCIOWE` |
| nakładka | „próba NIEPEŁNA (przerwana)" + pasek na czerwono |
| nakładka, szczegół | „Wynik z N faktur, nie z pełnej próby" |
| konsola | ostrzeżenie z liczbą zachowanych pozycji |

Skala różnicy jest realna — na anchorze `0022850` próba 40 z 100 faktur daje
`0003246,0004304,0010937,0020131` wobec `0004446,0003246,0012535,0004304`
z pełnej. Dwie pozycje wspólne z czterech.

**Zakładka historii zostaje otwarta po przerwaniu** — świadomie. W przerwanym
stanie nie wiadomo, w którym widoku jesteśmy, a zamykanie „aktywnej zakładki"
mogłoby zamknąć nie tę, o którą chodzi.

### Degradacja zamiast utraty przebiegu

Awaria odczytu katalogu **nie kasuje** wyniku. Wcześniej rzucała wyjątek i cała
praca przepadała — realny przebieg zescrapował 20 faktur, policzył ranking
59 partnerów i użytkownik nie dostał nic.

Ranking z `analyzeCrossSell()` jest wartościowy sam w sobie; brakuje mu tylko
weryfikacji stanu magazynowego i grupy. Więc gdy przełączenie na katalog
zawiedzie, skrypt ustawia `analysis.unverified` i **kończy normalnie**.

Oznaczenia obniżonej jakości wyniku, na każdym wyjściu:

| sytuacja | flaga | sufiks CSV | nakładka |
|---|---|---|---|
| przerwane przez użytkownika | `partial` | `_CZESCIOWE` | „próba NIEPEŁNA (przerwana)" |
| katalog niedostępny | `unverified` | `_BEZ_WERYFIKACJI` | „BEZ weryfikacji stanu i grupy" |

Oba mogą wystąpić razem — sufiksy się sklejają. Przy `unverified` w wyniku mogą
siedzieć produkty niedostępne lub niewysyłkowe, bo nie przeszły przez `DYS.`
ani przez `groupDeny`.

### OTWARTE: paginacja stanęła po pierwszej stronie

Zaobserwowane raz (anchor `0031018`): `pagerHasNextPage()` zwrócił `true`,
kliknięcie „następna strona" nie zmieniło numeru, przebieg skończył się na
20 fakturach. Wcześniej dla `0030078` zebrano 45 z 46 rekordów — możliwe, że to
ten sam problem.

**Nie wiadomo, czy pager naprawdę miał kolejną stronę, czy tylko nie oznaczył
przycisku jako nieaktywnego.** Zamiast zgadywać i zmieniać logikę, `describePager()`
loguje teraz stan pagera przy nieudanym przejściu: numer strony, liczbę stron,
liczbę rekordów i klasy przycisku. Uwaga: liczniki `.TotalPagesCount`
i `.ResultsCountValue` są znane z pokazywania błędnych wartości po zmianie
strony (dlatego pętla nigdy na nich nie polegała) — traktuj je jako wskazówkę,
nie jako prawdę.

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
5. Filtr dostępności w katalogu (`AVAILABILITY`), a po nim powrót wyszukiwarki
   katalogu na anchora (`FINISH.SEARCH_ANCHOR`).
6. Zapis CSV, SKU do schowka i do panelu wyniku.
7. Zamknięcie zakładki historii.

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
- **Zakładek ERP nie da się szukać po nazwie — ani po fragmencie, ani dokładnie.**
  Dwie nieudane próby, obie potwierdzone realnym przebiegiem:
  `textContent.includes('Katalog')` trafiało w kartę produktu (`Katalog: 0030078`),
  która nie ma siatki ani wyszukiwarki; wymóg dokładnego `Katalog` nie trafiał
  w nic (log: 18 widocznych `li.k-item`, zero trafień). Etykiety zależą od tego,
  jak użytkownik nawigował, a `li.k-item` to w tym ERP także pozycje menu
  w lewym panelu.
  Rozwiązanie: **identyfikacja po zawartości panelu**, nie po nazwie.
  `listTabCandidates()` bierze tylko `li.k-item[aria-controls]` (pozycje menu
  nie mają tego atrybutu), a `panelLooksLikeCatalog()` szuka panelu
  z wyszukiwarką `.csDBEditSearch` i siatką z kolumną `QStockAv`. Obecność
  w DOM, nie widoczność — panel nieaktywnej zakładki jest ukryty, ale jego
  treść istnieje. Etykieta została jako ostatnia deska ratunku.
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

## Pusty wynik na koncie innego użytkownika (v2.11.1)

Objaw: skrypt otwierał historię, ustawiał filtry, po czym w konsoli leciało
`Nie udało się otworzyć faktury: <numer>`, a zaraz po tym `Nie znaleziono
wiersza dla <numer>` dla każdego kolejnego dokumentu. Wynik: zero danych.

Przyczyna łańcuchowa. `getVisibleInvoiceGrid()` wymagał dwóch kolumn: `Item`
(SKU) i `PositionItemDesc` (nazwa). **Układ kolumn w tym ERP jest konfigurowany
per użytkownik**, więc na innym koncie siatka pozycji może nie mieć kolumny
z opisem. Oczekiwanie na siatkę kończyło się timeoutem, a pętla robiła
`continue` **bez zamknięcia właśnie otwartej zakładki faktury**. Otwarta
zakładka przykrywała listę historii, więc `getFaRows()` od tej chwili nie
znajdował już nic — stąd lawina „Nie znaleziono wiersza". Pierwszy błąd był
prawdziwy, cała reszta to jego skutek.

Naprawa:

- `getVisibleInvoiceGrid()` wymaga już tylko kolumny `Item`. To jedyna, bez
  której nie da się nic policzyć; `extractInvoiceRows()` toleruje brak nazwy
  i ilości.
- Po nieudanym otwarciu skrypt **zamyka zakładkę i czeka na powrót listy**,
  zanim przejdzie do kolejnego dokumentu.
- `MAX_CONSECUTIVE_FAILURES = 3` — trzy nieudane otwarcia z rzędu kończą
  zbieranie z jawnym komunikatem, zamiast mielić 100 dokumentów na sucho.
- `describeVisibleGrids()` wypisuje przy błędzie liczbę wierszy i listę
  `data-datafield` każdej widocznej siatki. Bez tego diagnoza układu kolumn
  na cudzym koncie to zgadywanka — ten sam błąd popełniliśmy trzy razy przy
  wykrywaniu zakładki katalogu.
- Zero pozycji bez przerwania rzuca teraz błąd z opisem przyczyny, a nie
  „sygnał zbyt słaby". Ten komunikat sugerowałby, że dane są, tylko za rzadkie.

**Pułapka do zapamiętania:** brak kolumny `PositionItemDesc` nie blokuje już
przebiegu, ale wtedy `row.product` jest pusty i **wszystkie reguły nazwowe
w `EXCLUSIONS` przestają filtrować po cichu** — chłodnia i mroźnia trafiłyby
do rekomendacji. Dlatego skrypt raz na przebieg krzyczy w konsoli, gdy pozycje
przychodzą bez nazw. Zostaje wtedy tylko filtr po grupie produktu z katalogu.

## Log diagnostyczny (v2.12.0)

**ERP renderuje DOM zależnie od uprawnień i konfiguracji widoku KONKRETNEGO
użytkownika.** Ta sama strona na dwóch kontach potrafi mieć inne kolumny
w siatce, inny zestaw zakładek i brak `.csButtonAction` w wierszu, gdy ktoś
widzi dokument, ale nie ma prawa go otworzyć. Selektor działający u jednej
osoby trafia wtedy w nic u drugiej — i tak właśnie wyglądała awaria opisana
wyżej. Diagnoza zdalna bez wglądu w cudzy DOM to zgadywanka; przy wykrywaniu
zakładki katalogu kosztowała trzy podejścia.

Skrypt zbiera więc bufor zrzutów struktury: zakładki `li.k-item[aria-controls]`
z sygnaturą panelu, wszystkie siatki z liczbą wierszy i **listą kolumn
`data-datafield`**, stan pagera, liczbę wyszukiwarek, wersję skryptu i user
agent. Zrzuty lecą na starcie przebiegu, przy pierwszej otwartej fakturze
i przy każdej awarii (nieudane otwarcie, brak wiersza, brak przycisku,
zablokowana paginacja, brak zakładki katalogu, błąd przebiegu). Przy serii
porażek pełny zrzut robi się tylko raz — kolejne są skutkiem pierwszej.

**Skrypt nie zapisze logu do repo sam** — działa w przeglądarce, bez dostępu
do dysku. Log wychodzi przez pobranie pliku: przycisk „Pobierz log
diagnostyczny" w panelu wyników (panel nie znika sam, więc jest czas nawet
po błędzie) albo z konsoli `savpolDiag()` / `savpolDiagDownload('<sku>')`.
Pliki wrzucamy ręcznie do `diagnostyka/` — instrukcja w `diagnostyka/README.md`.

W logu jest struktura, nie treść dokumentów. Numery faktur pojawiają się
w komunikatach o błędach; nazwy kontrahentów i kwoty nie.

## Przejście z ERP na stronę produktu w sklepie (v2.13.0)

ERP nie zna adresu produktu w e-commerce, a slug w URL sklepu
(`/nazwa-produktu-123456`) nie da się zbudować z samego SKU. Droga jest więc
dwuetapowa — ta sama, co w [savpol-sku-harvester](https://github.com/SavpolLech/savpol-sku-harvester):

1. Przycisk **„🛒 Otwórz w esavpol"** w pasku katalogu zapisuje SKU zaznaczonego
   produktu przez `GM_setValue` i otwiera `esavpol.pl/produkty?searchtext=<SKU>`.
2. Ten sam skrypt — rozszerzony o `@match https://esavpol.pl/*` — działa już
   na stronie sklepu, znajduje w wynikach kartę z **dokładnie tym** SKU
   i przechodzi na nią.

Dlaczego `GM_setValue`, a nie `sessionStorage`: to przejście między domenami,
a storage jest per origin. Dlaczego kształt adresu, a nie klasa CSS: klasy
w sklepie się zmieniają, wzorzec `slug + co najmniej 6 cyfr` nie.

Dopasowanie SKU idzie po treści całej karty z granicą cyfrową
(`(^|[^0-9])SKU([^0-9]|$)`) — karta nie ma osobnego pola z SKU, a bez granicy
`123456` trafiłoby w `1234567`. Gdy dokładnego trafienia brak, skrypt otwiera
pierwszy wynik i mówi o tym w konsoli. Wyniki dociągają się asynchronicznie,
więc próba jest ponawiana 20 razy co 500 ms.

**Skąd bierze się SKU** (v2.13.2): najpierw z **wyszukiwarki katalogu**, o ile
wpisano w nią SKU, a nie nazwę. To odpowiada temu, jak ten widok jest naprawdę
używany — SKU wpisuje się w pole szukania i patrzy na wynik. Pierwsza wersja
opierała się na zaznaczeniu wiersza i nie działała: zaznaczenia zwyczajnie
nie ma, a ERP oznacza je różnie zależnie od widoku.

Dalsze źródła w kolejności: zaznaczony wiersz (cztery warianty klasy),
jedyny wiersz na liście wyników, panel filtrów historii. Gdy żadne nie zadziała,
przycisk mówi „Wpisz SKU w wyszukiwarkę" i robi zrzut DOM do logu.

Przycisk główny nazywa się teraz **„🧩 Zbuduj opis"**: cross-selling i tak
był tylko etapem, a wynikiem pracy jest opis produktu.

## Historia faktur trafia do repo, nie na dysk (v2.15.0)

Pobieranie CSV wyłączone (`EXPORT_RAW_HISTORY`, `EXPORT_CROSS_SELL_CSV` — flagi
zostają, bo przy dostrajaniu reguł surowa historia bywa potrzebna). Powód nie
jest kosmetyczny: nad opisami pracują trzy osoby równolegle i pliki w cudzych
Pobranych po prostu się gubiły. Nie dało się odpowiedzieć, które produkty są
zrobione ani na jakich danych powstała rekomendacja.

Historia idzie do **prywatnego** repo `esavpol-pdp`, ale nie bezpośrednio.
Ten skrypt nie trzyma żadnego sekretu — wysyła dane do apki generatora,
a ona commituje swoim serwerowym `GITHUB_PAT`. Alternatywa (PAT w Tampermonkey
u każdej z trzech osób) była gorsza pod każdym względem.

**Wysyłka idzie prosto z ERP, zaraz po przebiegu** (zmiana w v2.17.0).

Pierwotnie skrypt czekał z wysyłką na otwarcie generatora, żeby żądanie było
same-origin. W praktyce kolejka rosła i nie wysyłała się nigdy — a użytkownik
nie miał jak się o tym dowiedzieć, bo komunikaty leciały do konsoli karty,
której nikt nie otwierał. Założenie było zresztą błędne: sprawdzanie duplikatu
działało od początku tą samą drogą, przez `GM_xmlhttpRequest`, który omija CORS
i dokłada ciasteczka domeny docelowej. Skoro `GET` przechodził, `POST` też
przechodzi.

Kolejka w `GM_setValue` (`invoice_history_queue`) **została**, ale w swojej
właściwej roli: bufor na nieudane wysyłki, opróżniany przy następnym przebiegu.
Gdy coś w niej zostanie, użytkownik widzi to w panelu wyników, nie w konsoli.
Strona generatora próbuje dosłać zaległości jako zapas — tam sesja jest świeża.

Obsługa odpowiedzi wynika z tego, czy ponowienie ma sens:

| Kod | Zachowanie |
|---|---|
| `200` | wpis znika z kolejki |
| `401` | **cała** kolejka zostaje, przerywamy — sesja wygasła, po zalogowaniu pójdzie za jednym razem |
| `400`, `413` | wpis znika — dane są trwale odrzucone, ponawianie tylko zablokowałoby kolejkę |
| reszta / błąd sieci | wpis zostaje |

Do kolejki trafia też przebieg **bez kandydatów**: „sygnał zbyt słaby" jest
wynikiem, a bez zapisu ktoś powtórzy tę samą trzyminutową robotę.

**Sprawdzenie duplikatu przed startem** (`GET /api/invoice-history?sku=`) idzie
z ERP, więc cross-origin — stąd `GM_xmlhttpRequest` (omija CORS, dowozi
ciasteczko) i `@connect esavpol-pdp.vercel.app`. Gdy historia już jest, skrypt
**pyta**, zamiast decydować: przebieg `partial` albo `unverified` warto powtórzyć,
kompletny raczej nie. Każda awaria sprawdzenia jest ignorowana — to udogodnienie,
nie warunek pracy.

Kontrakt endpointu: `docs/integracja-historia-faktur.md` oraz
`docs/integracja-erp.md` w repo `esavpol-pdp`.

## Komunikaty pisane dla marketingu, nie dla programisty (v2.16.0)

Ze skryptu korzysta dział marketingu, nie osoby techniczne. Komunikaty niosły
słownictwo, które dla nich nic nie znaczy — „repo", „N=87", „sygnał zbyt słaby",
„kandydaci", „SKU w schowku", „próba NIEPEŁNA", „BEZ weryfikacji stanu i grupy",
„zobacz konsolę". Konsola i logi zostają techniczne; zmieniło się wyłącznie to,
co widzi użytkowniczka.

Zasady, którymi się kierowałem:

- **Nazywaj rzecz, nie mechanizm.** „Produkty do sekcji »Często kupowane razem«"
  zamiast „SKU do cross-sellingu". „Generator opisów" zamiast „generator PDP".
- **Powiedz, co robić dalej.** Każdy komunikat kończący pracę mówi, jaki jest
  następny krok — wkleić, kliknąć, zrobić opis bez tej sekcji, wysłać plik.
- **Brak wyniku to nie awaria.** „Sygnał zbyt słaby (N=10)" brzmiało jak błąd
  skryptu. Teraz: ten produkt nie ma stałych towarzyszy, zrób opis bez tej sekcji.
- **Czas z góry.** „To potrwa około 3 minut" na starcie i w pytaniu o powtórzenie —
  bez tego trzyminutowa cisza wygląda na zawieszenie.
- **Błąd wskazuje drogę wyjścia,** a nie konsolę: „Zapisz szczegóły błędu
  i wyślij plik osobie, która opiekuje się skryptem". Techniczna treść zostaje,
  ale na końcu.

Liczba faktur nadal się pojawia, bo mówi o wiarygodności wyniku — ale jako
„na podstawie 87 faktur", nie „N=87".

## Pierwsze uruchomienie kończyło się na jednej fakturze (v2.16.1)

Objaw: pierwszy przebieg po wejściu na stronę zbierał jedną „fakturę"
z kilkunastoma pozycjami, sypał lawiną „Nie znaleziono wiersza" i kończył się
zerowym rankingiem. Drugie kliknięcie działało poprawnie.

Regresja po v2.11.1. Naprawiając awarię u innego pracownika rozluźniłem
`getVisibleInvoiceGrid()` do jedynego warunku „ma kolumnę `Item`". Za mocno:
**lista historii też ma kolumnę `Item`**, obok `DocNumber` i danych kontrahenta
(widać to w logu diagnostycznym: `[Warehouse, DocType, DocNumber, …, Item,
PartNo, ItemDesc, …]`). Funkcja dopasowywała więc listę historii i wiersze listy
trafiały do analizy jako pozycje faktury.

Dlaczego dopiero za pierwszym razem: to wyścig. Po `btn.click()` skrypt czeka na
siatkę pozycji, ale przy pierwszym otwarciu zakładka faktury renderuje się
wolniej i lista historii jest jeszcze widoczna — zostaje dopasowana. Za drugim
razem widok jest już w pamięci ERP, otwiera się natychmiast i trafienie jest
poprawne. Stąd „działa dopiero za drugim kliknięciem".

Naprawa: siatka pozycji musi mieć `Item`, ale **nie może** mieć `DocNumber`
ani `CustomerDesc` — to dane nagłówka dokumentu, których pozycje nie niosą.
Warunek jest niezależny od czasu, więc usuwa wyścig zamiast go tylko skracać.

**Wniosek na przyszłość:** rozpoznawanie siatki po jednej kolumnie jest zbyt
słabe w ERP, gdzie kilka widoków dzieli te same nazwy pól. Rozpoznawaj po
kombinacji „ma X i nie ma Y" — tak samo działa `panelLooksLikeCatalog()`.

## Znów „dopiero za drugim razem", tym razem po filtrach (v2.17.1)

Inna przyczyna niż w v2.16.1, ten sam objaw. Log diagnostyczny z konta
pracownika: przebieg kończył się błędem po **3,2 sekundy**, a w zrzucie widać
`Pagery: … strona=1 | stron=0 | rekordow=0` — lista faktur była jeszcze
w trakcie przeładowania, gdy skrypt już próbował z niej czytać.

Winny warunek w `setFilters()`:

```javascript
await waitFor(() => {
  const rows = …querySelectorAll('tr.cs-grid-data-row')
    .filter(row => row.offsetParent !== null);
  return rows.length > 0;
}, 40, 300);
```

„Jakikolwiek widoczny wiersz" spełniała **siatka katalogu**, która w tym
momencie jest jeszcze widoczna (w logu: siatka #52, 16 wierszy, widoczna=true).
Warunek był więc spełniony natychmiast i w praktyce nie czekał na nic. Drugie
uruchomienie działało, bo lista historii była już załadowana z poprzedniej próby.

Naprawa dwustopniowa:

1. `setFilters()` czeka na `getFaRows().length > 0` — czyli na wiersze faktur,
   nie na cokolwiek. Gdy się nie doczeka, zapisuje stan pagera i zrzut DOM.
2. `collectAllInvoices()` traktuje pustą **pierwszą** stronę jako „jeszcze się
   ładuje" i czeka do 6 sekund, zamiast od razu kończyć przebieg zerem.

**Powtarzalny wzorzec, wart zapamiętania:** warunki oczekiwania w tym ERP nie
mogą być formułowane jako „czy w dokumencie jest cokolwiek" — kilkadziesiąt
siatek żyje równolegle (w tym logu 63) i zawsze któraś pasuje. Warunek musi
wskazywać **konkretne dane, na które czekamy**. Ta sama pomyłka co przy
rozpoznawaniu siatki po jednej kolumnie (v2.16.1) i przy szukaniu zakładki
katalogu po nazwie (v2.9.1).

## Ile faktur to za mało — pomiar zamiast przeczucia (v2.18.0)

Nowe produkty mają zero, jedną albo dwie faktury, a marketing chce ich opisywać
najwięcej. Pytanie „przy ilu fakturach to jeszcze szum" dało się rozstrzygnąć
danymi, bo mamy dziewięć skalibrowanych historii.

Metoda: dla ośmiu anchorów losowo przycinamy próbę do K faktur (40 losowań na
kombinację) i sprawdzamy, ile z top-4 z pełnej próby wraca w wyniku.
Skrypt: `stability.js` (nie w repo, do odtworzenia z tego opisu).

| Faktur | Trafień z pełnego top-4 | Przebiegów bez wyniku |
|---|---|---|
| 10 | 5% | 78% |
| 15 | 11% | 55% |
| 20 | 22% | 32% |
| 30 | 44% | 7% |
| 40 | 57% | 2% |
| 50 | 68% | 0% |
| 60 | 74% | 0% |
| 80 | 85% | 0% |

Przy 20 fakturach **trzy z czterech rekomendacji byłyby inne**, gdyby próba
była pełna. Stąd progi:

- `MIN_INVOICES: 30` — poniżej nie liczymy wcale. Kandydaci są kasowani
  świadomie: lista z 15 faktur wygląda jak rekomendacja, a jest losowaniem.
- `LOW_CONFIDENCE_BELOW: 50` — między 30 a 49 wynik zostaje, ale jest oznaczony
  jako niepewny (44–68% trafień to jeszcze informacja, tyle że wymaga oka).

Podłoga na 30, nie na 50, bo przy 30 mamy 44% trafień i tylko 7% pustych
przebiegów — to niesie treść, choć wymaga obejrzenia.

**Ścieżka dla produktu bez sprzedaży:** zamiast błędu skrypt odczytuje z katalogu
**grupę produktu** i otwiera generator z `?sku=…&group=…` bez `cross`. Grupa jest
tam jedyną przesłanką, bo `cross-sell-map.md` po tamtej stronie jest indeksowana
kategorią. Flaga `conf=low` jedzie w URL dla przypadku 30–49, a `tooFewInvoices`
i `lowConfidence` trafiają do metadanych archiwum.

## Bestsellery udające cross-sell — ZNANE, NIENAPRAWIONE

Przy okazji pomiaru wyszło coś ważniejszego niż próg. Częstość SKU w top-4
ośmiu różnych anchorów:

```
0006418: 7/8 anchorów
0020669: 6/8 anchorów
wszystkie pozostałe: 1/8
```

To nie są produkty „kupowane razem z tym" — to bestsellery kupowane **ze
wszystkim**. Współwystępują, bo są w połowie faktur w firmie, nie dlatego, że
pasują do orzecha laskowego czy jogurtu Skyr. **Dwa z czterech miejsc w każdej
rekomendacji idą dziś na produkty, które i tak trafiłyby do koszyka.**

Lekarstwo: **lift** zamiast surowego udziału — udział produktu w fakturach
anchora podzielić przez jego udział we wszystkich fakturach. Produkt obecny
w 40% faktur anchora i w 38% wszystkich → brak afinity, wypada. Obecny w 12%
faktur anchora i w 2% wszystkich → prawdziwy sygnał, choć liczbowo słabszy.

Wymaga oszacowania tła, czyli udziału każdego SKU w ogóle faktur — i to jest
brakujący argument za gromadzeniem historii w repo. Im więcej plików w archiwum,
tym lepsze tło. Do zrobienia po tym, jak archiwum urośnie.

## Pole z SKU i przycisk „Kopiuj" usunięte (v2.19.0)

Lista SKU w schowku była przez wiele wersji **głównym wynikiem pracy** — stąd
pole do kopiuj-wklej w nakładce i cała konfiguracja `CLIPBOARD`. Odkąd generator
dostaje SKU w URL (`&cross=`), nikt tych numerów stamtąd nie przepisywał.
W panelu zostaje sam przycisk „Otwórz generator opisów".

Kopiowanie do schowka (`deliverSkus`) **zostaje**, ale po cichu: nic nie kosztuje,
a jest drogą awaryjną, gdy otwarcie generatora zawiedzie. Numery lecą też do
konsoli, jak dotąd.

Warto to zapamiętać jako wzorzec: interfejs narastał wokół pośredniego wyniku
(SKU do przeklejenia), który przestał być potrzebny, gdy powstało połączenie
z generatorem. Element nie zniknął sam — trzeba było zauważyć, że nikt go już
nie używa.

## Fakt zamiast oceny: `invoices=N` (v2.20.0)

Kontrakt uzgodniony z sesją rozwijającą generator. Zamiast flagi `conf=low`
skrypt przekazuje **liczbę faktur**, na których oparta jest rekomendacja.

Powód jest praktyczny, nie estetyczny: **próg trzyma teraz generator**, więc
jego zmiana nie wymaga aktualizacji userscriptu u każdego pracownika z osobna.
Moje pierwotne `conf=low` zamrażało decyzję po złej stronie — w kodzie, który
najtrudniej zaktualizować.

Wynika z tego coś, czego pierwotny kontrakt nie mówił wprost, a co jest
konieczne, żeby działał: **skrypt nie wycina już kandydatów przy małej próbie.**
Gdyby wycinał, generator nigdy by ich nie zobaczył i nie mógłby progu obniżyć —
decyzja wróciłaby do skryptu tylnymi drzwiami. `MIN_INVOICES`
i `LOW_CONFIDENCE_BELOW` sterują wyłącznie komunikatem dla użytkownika.

Zmieniło się też rozgałęzienie w pipeline: sprawdzanie dostępności i komunikat
końcowy zależą od tego, **czy są kandydaci**, a nie od progu. Przy 12 fakturach
i jednym kandydacie nadal chcemy sprawdzić jego dostępność w katalogu.

Po stronie generatora łańcuch źródeł wygląda tak (od najmocniejszego):
faktury → `cross-sell-map.md` → ta sama kategoria co anchor. Kandydaci
z dwóch ostatnich trafiają do formularza **w osobnej, oznaczonej grupie**,
nie mieszają się z tymi z faktur. Kandydaci pochodzą wyłącznie z `skus.jsonl`,
więc model nie ma jak wymyślić nieistniejącego produktu — dostaje gotową listę
i pisze do niej tylko nagłówki kart.

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
