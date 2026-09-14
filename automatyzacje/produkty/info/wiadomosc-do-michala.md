# Szkic wiadomości do Michała (2026-09-14)

---

Cześć Michał,

Sprawdziliśmy, jak dobrze da się zmapować pola widoczne na karcie produktu
w ERP na Twoją listę 141 kolumn `csItems`. W skrócie: udało się dopasować
**105 z 141 kolumn** z konkretnym polem/nazwą po stronie API ERP. W
załączeniu dwa pliki CSV z prawdziwym produktem (`0000031`):

1. `produkt_0000031_dopasowane-kolumny.csv` — tylko te 105 dopasowanych pól.
2. `produkt_0000031_wszystkie-pola-api.csv` — komplet, wszystkie ~314 pól,
   które karta produktu faktycznie zwraca (żeby było widać, co jeszcze jest
   dostępne poza Twoją listą).

Mamy jednak kilka otwartych pytań, zanim ruszymy dalej ze scraperem:

1. **Skąd rozjazd 141 vs 314?** Twoja lista ma 141 kolumn, ale samo
   zapytanie karty produktu zwraca 314 różnych nazw pól (część to
   duplikaty ID+Desc dla tego samego, ale reszta wygląda na dodatkowe,
   prawdziwe kolumny — np. `csItemsAddId`/`Atr01`…`AtrInt09`,
   `groupsInfo01`–`04`, `EANType`, `CRecyclingFee`,
   `csProducersIdNew`/`csSupplierIdNew`). Czy Twoja lista to celowo
   podzbiór, czy to miał być cały zrzut kolumn `csItems`, a te dodatkowe
   pola siedzą w innej tabeli?
2. **`purchaseLastPrice` vs `CPurchasePrice`** — Twoja lista ma
   `purchaseLastPrice`, ale na karcie w polu „Zakupu” widzimy
   `CPurchasePrice`. Ta sama wartość pod dwiema nazwami, czy dwie różne
   kolumny (np. jedna ręczna, druga wyliczana z historii zakupów)?
3. **Pola bez pokrycia w Twojej liście**: `EANType`, `isFractionalQuantity`,
   `groupsInfo01XML`–`04XML`, `CRecyclingFee` (KGO), `validTo`,
   `expireDays` — nie widzimy ich w 141 kolumnach pod żadną rozpoznawalną
   nazwą. Są w `csItems` pod inną nazwą, czy to coś innego?
4. **Wciąż nieznalezione pola z UI**: Grupa, Klasa, Symbol PCN, radiogroup
   „Swobodne korzystanie / Kontrola jakości” — nie widać ich ani w
   szablonie karty, ani w zapytaniu SQL karty produktu. Możliwe, że to
   inna tabela.
5. **Zakres zadania** — sprawdziliśmy też katalog produktów i pozostałe
   zakładki karty (Zapasy, Zdjęcia, Załączniki, Grupy, Opisy w B2B,
   Powiązane, Jednostki, Referencje, Kontrahenci, Do użycia w
   magazynach, Limity cen produktów, Stany MWS, Towary w drodze) — każda
   z nich to osobna tabela/relacja (własne ID, nie kolumny `csItems`), nie
   dodały nic nowego do listy 141 kolumn. Chcesz, żebyśmy też to
   scrapowali, czy interesuje Cię wyłącznie `csItems`?
6. **Pola SEO per język** — w Twojej liście kolumn `SEOTitle`/
   `SEODescription`/`SEOCanonical` istnieją tylko dla PL/EN/HR, ale w UI
   karty produktu pole „Tytuł” i „Robots” pokazuje się też dla
   DE/FR/NL/ES/PT/UK/RU. Czy to zapisuje się gdzieś indziej (np. do
   `ItemDesc_XX`), czy Twoja lista 141 kolumn po prostu nie ma tych
   dodatkowych `SEOTitle_XX`? Osobno: strona nigdy nie była tłumaczona na
   inne języki niż polski, więc pewnie w 99% te pola będą puste — czy
   mimo to mamy je scrapować?

Jak odpowiesz na te punkty, możemy zacząć pisać docelowy scraper.

Pozdrawiam,
Lech

---

**Uwaga dla mnie / do usunięcia przed wysyłką:** przy zbieraniu tych danych
w trakcie testów przypadkowo zobaczyliśmy w ruchu sieciowym ERP hasło do
konta w postaci niemal czystego tekstu (klient ERP wysyła je przy każdym
zapytaniu API) — to osobny temat bezpieczeństwa, wart zgłoszenia do
dostawcy ERP niezależnie od tego projektu, ale nie mieszałbym go w tę samą
wiadomość o mapowaniu kolumn.
