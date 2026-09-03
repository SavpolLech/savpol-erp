# Zasady projektu

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
