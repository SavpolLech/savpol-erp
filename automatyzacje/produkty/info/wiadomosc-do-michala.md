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

1. **`purchaseLastPrice` vs `CPurchasePrice`** — Twoja lista ma
   `purchaseLastPrice`, ale na karcie w polu „Zakupu” widzimy
   `CPurchasePrice`. Ta sama wartość pod dwiema nazwami, czy dwie różne
   kolumny (np. jedna ręczna, druga wyliczana z historii zakupów)?
2. **36 kolumn z Twojej listy, których nie widzimy w danych karty** —
   większość to warianty językowe (`KeyWords_DE/ES/FR/NL/PT/RU/UK/IT/SK/CZ`
   i `KeyWordsAuto_*`), które pewnie po prostu nie są uzupełnione, bo
   produkt nigdy nie był tłumaczony. Ale czy rozpoznajesz po nazwie, gdzie
   się liczą te pozostałe: `DefSort`, `LastChangeDate`, `createdDate`,
   `isEOL`, `csUNSPSCCommodityId`, `csProducersIdAgr`, `NameA1Agr`,
   `NameL1Agr`? (Pełną listę wszystkich 36 mogę dosłać, jeśli przyda się
   w całości.)
3. **Pola SEO per język** — w Twojej liście kolumn `SEOTitle`/
   `SEODescription`/`SEOCanonical` istnieją tylko dla PL/EN/HR, ale w UI
   karty produktu pole „Tytuł” i „Robots” pokazuje się też dla
   DE/FR/NL/ES/PT/UK/RU. Wiesz, gdzie się to zapisuje dla tych
   dodatkowych języków? Osobno: strona nigdy nie była tłumaczona na inne
   języki niż polski, więc pewnie w 99% te pola będą puste — czy mimo to
   mamy je scrapować?

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
