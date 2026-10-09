# Faktury zakupu: FZ i FZ_KSEF — mapowanie pól (ustalenia z 2026-10-09)

Zlecenie Michała (2026-10-08): faktury zakupu z okna **Dokumenty zakupu**
(`https://erp.savpol.pl/pl/dokumenty-zakupu/csdocsheaders4purchase/213217693`),
na początek typy FZ i FZ_KSEF, ładowane jak sprzedaż do `csDocsHeaders` /
`csDocsItemsPositions`. Wzorcowe wiersze: `FZ_pola_wymagane.xlsx` (arkusz
„FZ + FZ_KSeF” = 273 pola nagłówka; u góry 2026/FZ/RZS1/PISNAT/000656, u dołu
2026/FZ_KSEF/GLS1/PREMAR/002058; DH/DIP = flagi nagłówka/pozycji).

| Typ | csDocsTypesId |
|---|---|
| FZ | 213217937 |
| FZ_KSEF | 27484898580 |

Lista miesza je z innymi typami zakupu (np. `Ko/…` — 27484898724, 275455092),
tych nie bierzemy.

**Status: mapowanie KOMPLETNE, 0 pól „do ustalenia”, 0 stałych.**

## Skąd dane — karta API, nie siatka

Jak `sprzedaz/`: podsłuchujemy odpowiedź API karty i dekodujemy ją.

| Źródło | DataSetSQLIdent | Co daje |
|---|---|---|
| Karta `csDocsHeaders_Purchase` | `csdocsheaders` | 1 wiersz, 462 pola — **wszystkie 273 kolumny `csDocsHeaders`** |
| ta sama odpowiedź | `csdocsitemspositions` | wszystkie pozycje, 156 pól — **wszystkie 120 kolumn `csDocsItemsPositions`** |
| ta sama odpowiedź | `csdocsheadersvatrates` | stawki VAT — poza zakresem |
| Lista `csDocsHeaders4Purchase` | `csdocsheaders4purchase` | 152 pola/wiersz, 21 wierszy/stronę — tylko do zebrania id z dnia |

Karta otwiera się wprost z URL (slug dowolny):
`https://erp.savpol.pl/pl/faktura-zakupu/csdocsheaders_purchase-213217693,<id>/213217693`.
Pełne listy pól: `info/pola-karta-csDocsHeaders_Purchase.txt`.

Flagi z arkuszy DH (50) i DIP (5) **nie są potrzebne jako stałe** — karta
oddaje je z prawdziwymi wartościami per faktura. Różnią się od FA (np.
CVATMethod/FVATMethod = 1, PricesPrecision = 6), FZ i FZ_KSEF różnią się
tylko ShipmentType (0 / NULL).

## Dzień = „Wpływ” = DocReceiptDate

Okno ma dwa zakresy dat: „Wpływ” i „Wystawiono”. Lista dnia ustawia „Wpływ”.
Sprawdzone na 1.07: 254 rekordy, wszystkie z DocReceiptDate = 1.07, a DocDate
bywa inna (np. 1.08, a w próbce Michała FZ: DocDate 11.06).

## Kalibracja 2026-10-09 (5 szt. z wpływem 1.07, tabele `_test`)

Porównanie z produkcją (`node sprzedaz/porownaj-z-prod.js <id…>`):

- **2 dokumenty Michała** (FZ 000656, FZ_KSEF 002058) — zgodne 1:1 poza
  płatnościami zapłaconymi po kopii bazy (3 pola `…PaymentsPositions…`)
  i milisekundami w datach (ERP podaje sekundy) — jak przy sprzedaży.
- **3 FZ_KSEF** (WLS1/000107, SZTR/000014, RZS1/000687) — w kopii bazy były
  jeszcze **przed rejestracją** (status 27511476384, bez DocNumber, DocDate
  i Wpływ 2.06, pozycje bez csItemsId, z opisem i jednostką dostawcy).
  W ERP zarejestrowano je 4–7.08: dostały numer, Wpływ 1.07, status
  ZAKSIĘGOWANE (213217724), pozycje podpięte pod nasze kartoteki, przeliczone
  ilości i ceny. To zmiana w ERP po kopii, nie błąd scrapera.

Wniosek do decyzji Michała: faktura KSeF wpada do ERP przed rejestracją,
a rejestracja zmienia jej dane (łącznie z datą Wpływu). Do bazy tylko
dopisujemy, więc trzeba ustalić, od jakiego statusu (np. tylko ZAKSIĘGOWANE)
i po ilu dniach bierzemy fakturę.
