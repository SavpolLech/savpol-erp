# Zasady projektu

## Wersjonowanie userscriptu

`@version` w `savpol-historia-faktur.user.js` odpowiada na jedno pytanie:
„która kopia siedzi teraz w przeglądarce". Numer nadajemy według wagi zmiany,
nie jej rozmiaru:

- **główny** (3.0.0) — skrypt zaczyna robić rzecz innego rodzaju. Wejście
  w ZAPIS do ERP było takim momentem: dotąd wyłącznie czytał.
- **środkowy** (3.1.0) — nowa możliwość w dotychczasowej roli.
- **ostatni** (3.1.1) — poprawka.

Nad tym samym plikiem pracujemy w kilku rozmowach naraz, więc **przed nadaniem
numeru sprawdź `git log`** — 2.59.0 zostało raz nadane dwa razy i numer
przestał cokolwiek znaczyć.

Snippety w `diagnostyka/` mają własną konwencję (`RRRR-MM-DD.N`) — patrz
`diagnostyka/README.md`.

## Snippety diagnostyczne do konsoli

Każdy fragment kodu przeznaczony do wklejenia w konsolę przeglądarki, którego
wynik ma wrócić do Claude, MUSI sam kopiować ten wynik do schowka. Użytkownik
nie zaznacza i nie kopiuje niczego z konsoli ręcznie.

- Wynik składaj w jeden string (tekst, nie obiekty) i wrzucaj do schowka.
- Kolejność prób: `copy()` z DevTools (działa zawsze w konsoli, nie wymaga
  focusu strony) → `navigator.clipboard.writeText` → `textarea` +
  `document.execCommand('copy')`.
- W konsoli zostaw tylko krótkie potwierdzenie ("skopiowano, N znaków"),
  nie cały zrzut.
- Zrzut musi być samoopisujący się: nagłówek z URL i datą, żeby po wklejeniu
  było wiadomo, z jakiego widoku pochodzi.
- Ten sam wymóg dotyczy wyników w gotowych skryptach userscript: efekt pracy
  idzie do schowka jednym kliknięciem, nie przez zaznaczanie w DOM.
