# Logi diagnostyczne

Skrypt działa w przeglądarce i nie ma dostępu do dysku, więc nie zapisze tu
niczego sam. Log powstaje przez pobranie pliku i trafia tu ręcznie.

## Jak zebrać log od innego użytkownika

1. Odpal skrypt normalnie (przycisk „Historia faktur" w katalogu).
2. Po zakończeniu — udanym albo błędnym — kliknij w panelu wyników
   **„Pobierz log diagnostyczny"**. Panel nie znika sam, więc jest czas.
3. Plik `savpol_diagnostyka_<SKU>.txt` ląduje w Pobranych. Prześlij go.
4. Wrzuć go do tego katalogu pod nazwą `<data>_<kto>_<SKU>.txt`.

Gdyby panel zniknął (przeładowana strona), log da się jeszcze wyciągnąć
z konsoli:

```javascript
copy(savpolDiag())        // do schowka
savpolDiagDownload('0031018')   // albo od razu do pliku
```

## Co jest w środku

Struktura DOM, nie treść dokumentów: lista zakładek `li.k-item[aria-controls]`
wraz z sygnaturą panelu, wszystkie siatki `.cs-grid-data-table` z liczbą wierszy
i **listą kolumn `data-datafield`**, stan pagera, liczba wyszukiwarek, wersja
skryptu i user agent. Zrzuty robione są na starcie przebiegu, przy pierwszej
otwartej fakturze i przy każdej awarii.

Numery dokumentów pojawiają się w komunikatach o błędach. Nazwy kontrahentów
i kwoty — nie.

## Po co to

Ten ERP renderuje widoki zależnie od **uprawnień i konfiguracji widoku
konkretnego użytkownika**. Ten sam ekran na dwóch kontach potrafi mieć inne
kolumny w siatce, inne zakładki i brak przycisku akcji w wierszu. Selektor
działający u jednego pracownika trafia wtedy w nic u drugiego. Zgadywanie,
czym się różnią, kosztowało już trzy podejścia przy wykrywaniu zakładki
katalogu — log zastępuje zgadywanie.
