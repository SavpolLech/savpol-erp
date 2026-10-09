# Rejestr zleceń Michała: scraping ERP → baza `worek`

Jedna lista tego, co Michał zlecił, i stanu każdego zlecenia (zadanie E-03 w
planie Lecha, cel A2). Statusy: **zlecone** (prace trwają) · **próbka**
(dane w `_test`, czekamy na Michała) · **działa** (codziennie przez
orkiestrator do tabel produkcyjnych) · **w utrzymaniu** (działa, wymaga
okresowej kontroli).

„Mail” to pierwszy mail Michała w danym wątku (skrzynka Lecha, stan 9.10).
„Start” to pierwszy commit w repo.

| Zlecenie | Mail | Start | Zatw. przez Michała | Status | Gdzie trafia | Katalog |
|---|---|---|---|---|---|---|
| WZ (wydania zewnętrzne) | 4.09 („Dane do wyciągnięcia z CS”), pola 7.09 („Rozszerzony zestaw pól”) | 7.09 | 14.09 | działa | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/wz/` |
| Produkty (karta towaru) | 11.09 („produkty (Katalog)”) | 11.09 | 22.09 | działa od 10.10: codziennie w orkiestratorze dochodzą karty z dokumentów, których brak w `csItems` (9.10: 40 brakujących) | `csItems` | `automatyzacje/produkty/` |
| MM (przesunięcia magazynowe) | 14.09 | 15.09 | 29.09 | działa, backfill od 24.07 | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/mm/` |
| PZ (przyjęcia zewnętrzne) | 14.09 | 17.09 | 29.09 | działa | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/pz/` |
| Kontrahenci: nowi | 29.09 | 30.09 | 2.10 | wgrani 2.10 (820 nowych), brak automatu | `csCustomers` | `automatyzacje/kontrahenci/` |
| Kontrahenci: zmiany (np. status) | 6.10 (w wątku „kontrahenci”) | 6.10 | plan 6.10 | zlecone: przegląd tygodniowy gotowy w podglądzie, przed pierwszym biegiem | `csCustomers` + historia w `csCustomersZmiany` | `automatyzacje/kontrahenci/` |
| Faktury sprzedaży FA | 30.09 | 2.10 | 6.10 (bufor 14 dni, przegląd 45 dni w piątki) | działa od 6.10; nadganianie 1.07–14.09 w toku | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Paragony PAR | 30.09 | 2.10 | 6.10 | działa od 6.10, razem z FA | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Faktury zakupu FZ + FZ_KSEF (E-09) | 5.10, pola 8.10 (`FZ_pola_wymagane.xlsx`) | 9.10 | — | próbka 9.10: 5 szt. z wpływem 1.07; odpowiedź Michała 9.10 14:00 do przeczytania | `csDocsHeaders_test`, `csDocsItemsPositions_test` | `automatyzacje/zakup/` |

## Do decyzji Michała

1. FZ: od jakiego statusu brać faktury i po ilu dniach (odpowiedź z 9.10 14:00 do przeczytania).
2. Produkty: aktualizować zmienione karty jak kontrahentów (UPDATE + historia), czy wystarczy raport? ok. 196 rozbieżności w `automatyzacje/ROZBIEZNOSCI.md` (E-10).
3. Produkty: od 10.10 nowe karty dochodzą same, gdy towar pojawi się na dokumencie (zamiast ręcznej listy ID). Czy potrzebne są też karty, które nie były jeszcze na żadnym dokumencie?
4. MM: jednorazowa korekta 37 dokumentów w statusie „Do realizacji” (03–09.2026).
5. Kontrahenci: próbka kontrolna po pierwszym przeglądzie zmian.

## W kolejce

Do ustalenia z Michałem (krok 2 zadania E-03): co jeszcze czeka.

## Poza zleceniami Michała

Automaty ERP, które działają, ale nie są zleceniem Michała (nie liczą się do
rejestru A2): etykiety MWS dla Merchant Center (`automatyzacje/produkty/`,
codziennie, od 10.10 w soboty 9:00).
