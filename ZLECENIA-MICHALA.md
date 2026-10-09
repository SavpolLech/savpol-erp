# Rejestr zleceń Michała: scraping ERP → baza `worek`

Jedna lista tego, co Michał zlecił, i stanu każdego zlecenia (zadanie E-03 w
planie Lecha, cel A2). Statusy: **zlecone** (prace trwają) · **próbka**
(dane w `_test`, czekamy na Michała) · **działa** (codziennie przez
orkiestrator do tabel produkcyjnych) · **w utrzymaniu** (działa, wymaga
okresowej kontroli).

„Kiedy” to start prac według repo. Datę maila Michała dopisz tam, gdzie jest
znana.

| Zlecenie | Kiedy | Status | Gdzie trafia | Katalog |
|---|---|---|---|---|
| WZ (wydania zewnętrzne) | 2026-09-07 | działa, próbka zatw. 14.09 | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/wz/` |
| Produkty (karta towaru) | 2026-09-11 | do uzupełnienia | `csItems_test` | `automatyzacje/produkty/` |
| MM (przesunięcia magazynowe) | 2026-09-15 | działa, zatw. 29.09, backfill od 24.07 | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/mm/` |
| PZ (przyjęcia zewnętrzne) | 2026-09-17 | działa | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/pz/` |
| Kontrahenci | ok. 30.09 (mail) | wgrani 2.10 (820 nowych), brak automatu | `csCustomers` | `automatyzacje/kontrahenci/` |
| Faktury sprzedaży FA | 2026-10-02 | działa od 6.10 (bufor 14 dni), nadganianie 1.07–14.09 w toku | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Paragony PAR | 2026-10-02 | działa od 6.10, razem z FA | `csDocsHeaders`, `csDocsItemsPositions` | `automatyzacje/sprzedaz/` |
| Faktury zakupu FZ + FZ_KSEF (E-09) | mail 8.10 | próbka 9.10: 5 szt. z wpływem 1.07; czeka na decyzję, od jakiego statusu i po ilu dniach brać | `csDocsHeaders_test`, `csDocsItemsPositions_test` | `automatyzacje/zakup/` |

## W kolejce

Do ustalenia z Michałem (krok 2 zadania E-03): co jeszcze czeka.
