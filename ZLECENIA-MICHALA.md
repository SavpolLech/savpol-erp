# Rejestr zleceń Michała: scraping ERP → baza `worek`

Jedna lista tego, co Michał zlecił, i stanu każdego zlecenia (zadanie E-03 w
planie Lecha, cel A2). Statusy: **zlecone** (prace trwają) · **próbka**
(dane w `_test`, czekamy na Michała) · **działa** (codziennie przez
orkiestrator do tabel produkcyjnych) · **w utrzymaniu** (działa, wymaga
okresowej kontroli).

„Mail” to pierwszy mail Michała w danym wątku (skrzynka Lecha, stan 9.10).
„Start” to pierwszy commit w repo. Statusy aktualne na **16.10** (przegląd L-11).

| Zlecenie | Mail | Start | Zatw. przez Michała | Status | Gdzie trafia | Katalog |
|---|---|---|---|---|---|---|
| WZ (wydania zewnętrzne) | 4.09 („Dane do wyciągnięcia z CS”), pola 7.09 („Rozszerzony zestaw pól”) | 7.09 | 14.09 | działa, aktualne (25.07–15.10 komplet) | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/wz/` |
| Produkty (karta towaru) | 11.09 („produkty (Katalog)”) | 11.09 | 22.09 | działa od 10.10: codziennie w orkiestratorze dochodzą karty z dokumentów, których brak w `csItems` (16.10: 8 brakujących) | `csItems` | `automatyzacje/produkty/` |
| MM (przesunięcia magazynowe) | 14.09 | 15.09 | 29.09 | działa, aktualne (24.07–13.10 komplet, celowo 3 dni z tyłu); 9.10 korekta 17 szkiców zaksięgowanych po wgraniu | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/mm/` |
| PZ (przyjęcia zewnętrzne) | 14.09 | 17.09 | 29.09 | działa; nadrabia luki 28.08–01.09 i 07.09–24.09, komplet ok. 20.10 | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/pz/` |
| Kontrahenci: nowi | 29.09 | 30.09 | 2.10 | działa od 14.10: nowi codziennie w orkiestratorze (16.10: baza 58 255, ERP 58 253, bilans −2 do wyjaśnienia) | `csCustomers` | `automatyzacje/kontrahenci/` |
| Kontrahenci: zmiany (np. status) | 6.10 (w wątku „kontrahenci”) | 6.10 | plan 6.10 | działa od 14.10: przegląd w środy, pierwszy pełny 21.10 | `csCustomers` + historia w `csCustomersZmiany` | `automatyzacje/kontrahenci/` |
| Faktury sprzedaży FA | 30.09 | 2.10 | 6.10 (bufor 14 dni, przegląd 45 dni w piątki) | działa od 6.10; nadganianie: 1.07–9.09 komplet, 10.09–14.09 w toku, komplet ok. 19.10 | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Paragony PAR | 30.09 | 2.10 | 6.10 | działa od 6.10, razem z FA | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Faktury zakupu FZ + FZ_KSEF (E-09) | 5.10, pola 8.10 (`FZ_pola_wymagane.xlsx`) | 9.10 | 13.10: tylko zaksięgowane, 2 dni po wpływie, przegląd 8 tygodni wstecz | w orkiestratorze od 14.10 (po teście 13.10); 5.10–14.10 komplet, zaległości 28.07–4.10 ok. 22.10; 66 faktur z 5–14.10 czeka na zaksięgowanie w ERP (przegląd 8 tyg. je dobierze) | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/zakup/` |

## Do decyzji Michała

1. Produkty: aktualizować zmienione karty jak kontrahentów (UPDATE + historia), czy wystarczy raport? ok. 196 rozbieżności w `automatyzacje/ROZBIEZNOSCI.md` (E-10).
2. Produkty: od 10.10 nowe karty dochodzą same, gdy towar pojawi się na dokumencie (zamiast ręcznej listy ID). Czy potrzebne są też karty, które nie były jeszcze na żadnym dokumencie?
3. Kontrahenci: próbka kontrolna po pierwszym przeglądzie zmian (21.10).
4. Sprzedaż: 8 szkiców FA bez numeru w bazie — gdy ERP nada numer, w bazie zostaje szkic (tylko dopisujemy). Poprawić je, czy zostawić jako znaną rozbieżność? Lista w `automatyzacje/ROZBIEZNOSCI.md`.
5. Sprzedaż: scraper bierze tylko FA i PAR. Korekty (FAK, ok. 20–50 dziennie), FM (ok. 70–100 dziennie), FAUE i rzadsze typy są tylko liczone. Czy któryś z nich też ma trafiać do bazy?

## W kolejce

Do ustalenia z Michałem (krok 2 zadania E-03): co jeszcze czeka.

## Poza zleceniami Michała

Automaty ERP, które działają, ale nie są zleceniem Michała (nie liczą się do
rejestru A2): etykiety MWS dla Merchant Center (`automatyzacje/produkty/`,
codziennie, od 10.10 w soboty 9:00).
