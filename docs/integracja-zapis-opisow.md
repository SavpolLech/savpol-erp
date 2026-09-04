# Zapis opisów produktu przez API ERP

Ustalone 3 września 2026 przez nagranie ręcznych zapisów
(`diagnostyka/podglad-zapisu-erp.js`) i test uwierzytelnienia
(`diagnostyka/test-czy-haslo-potrzebne.js`).

## Endpoint

```
POST https://erp.savpol.pl/api/CommS_WCF_JSON.svc/OperatrionInvoke
Content-Type: application/json; charset=utf-8
X-Requested-With: XMLHttpRequest

{"DictIdent":"csItemsOneBro","Input":"<base64(JSON)>","Compress":false}
```

Literówka w `OperatrionInvoke` jest po stronie dostawcy — tak ma być.

## Uwierzytelnienie: wystarczy sesja

ERP dokleja do każdego żądania `LoginInfo` z `UserName` i **`Password`
otwartym tekstem**. Test wykazał, że serwer tego hasła **nie sprawdza** —
żądanie z pustym hasłem zostało przyjęte tak samo jak oryginalne. Liczy się
ciasteczko sesji.

Dwa wnioski:

1. **Skrypt nie musi przechowywać hasła** — zasada „skrypt nie trzyma żadnego
   sekretu" zostaje nienaruszona. Wysyłamy `Password: ""`.
2. Każdy zrzut diagnostyczny z tego ERP zawiera hasło. Snippety w
   `diagnostyka/` wycinają je automatycznie; przy ręcznym kopiowaniu
   z zakładki Network trzeba o tym pamiętać.

## `Compress` — ZIP jest opcjonalny

`Compress:true` oznacza, że `Input` to base64 ZIP-a (zapisanego **bez
kompresji**, więc JSON leży w nim otwartym tekstem). `Compress:false` oznacza
base64 samego JSON-a — i to działa.

Uwaga na pułapkę: `Compress:false` **nie** znaczy „przyjmij goły JSON".
Serwer i tak dekoduje `Input` z base64. Wysłanie czystego tekstu kończy się
błędem „dane wejściowe nie są prawidłowym ciągiem Base-64".

## Zapis opisu

W środku `Input` (po zdekodowaniu) operacja wygląda tak:

```jsonc
{
  "LoginInfo": { "UserName": "...", "Password": "", ... },
  "OperationInvokeInput": {
    "OperationName": "ActionExecute",
    "Params": {
      "DictIdent": "csItemsOneBro",
      "ActionIdent": "csItemsDesc4B2BPortalsChangeDesc",
      "DataSetTypeIdent": "csItemsDesc4B2BPortalsDescriptions",
      "DataSetSQLIdent": "csItemsDesc4B2BPortalsChangeDesc",
      "HasParams": "1",
      "ActionExecuteType": 0
    },
    "DataTableInitList": {
      "0": {
        "DataSetSQLIdent": "ActionParams_csItemsDesc4B2BPortalsChangeDesc",
        "DataTableInit": { "DataTable": { "FieldDefs": [...], "Rows": [[...]] } }
      }
    },
    "SID": "...", "SessionId": "...", "CompaniesId": 213217693,
    "AppNameSpaces": "...", "LanguageSuffix": "PL"
  }
}
```

Cały ładunek to **jeden wiersz o siedmiu polach**:

| Pole | Rola | Przykład |
|---|---|---|
| `csCompaniesId` | stała firmy | `213217693` |
| `csB2BPortalsId` | stała portalu (esavpol.pl) | `1234896834` |
| `csItemsId` | **produkt** | `1458477456` |
| `csB2BDescriptionTypesG` | **rodzaj opisu** (GUID) | `2519e05a-…` = „Nazwa produktu" |
| `csItemsDesc4B2BPortalsId` | **wiersz opisu** | `8761250361` |
| `csSupLangId` | język | `95` = Polski |
| `ItemDesc1` | **treść do zapisania** | tekst albo HTML |

Między produktami zmieniają się tylko `csItemsId` i `csItemsDesc4B2BPortalsId`.
Reszta to stałe firmy, portalu i języka.

## Trzy nagrane przebiegi (4 września 2026)

Nagrane snippetem `diagnostyka/podglad-zapisu-erp.js` na produkcie `0009905`
(`csItemsId = 218531445`), po jednej czynności na przebieg.

### A — dodanie opisu, którego jeszcze nie ma: DWA żądania

Sam `ChangeDesc` nie wystarcza, bo nie ma czego zmieniać. Najpierw powstaje
pusty wiersz, dopiero potem wpisuje się w niego treść:

1. `ActionIdent: csItemsDesc4B2BPortalsInsert`, `DataSetTypeIdent: csItemsDesc4B2BPortals`,
   `DataSetSQLIdent: csItemsDesc4B2BPortalsEdit`, zestaw
   `ActionParams_csItemsDesc4B2BPortalsEdit`. Wiersz niesie `csCompaniesId`,
   `csB2BPortalsId`, `csItemsId`, `csB2BDescriptionTypesG`, `csSupLangId`,
   `isExternalEditor = 1` oraz **`csItemsDesc4B2BPortalsG` wymyślony przez
   klienta** — ten sam GUID leci w `__SelectedRecords__`. Pola `ItemDesc1_*`
   są `null`: akcja zakłada wiersz, nie zapisuje treści.
2. `ActionIdent: csItemsDesc4B2BPortalsChangeDesc` — jak niżej, z
   `csItemsDesc4B2BPortalsId` **nadanym przez serwer** przy kroku 1.

### B — zmiana istniejącego opisu

Też dwa żądania, ale pierwsze to tylko otwarcie edytora:
`csItemsDesc4B2BPortalsUpdate` niesie wiersz ze **starą** treścią
(`ItemDesc1_PL`, `ItemTranslatedDesc1`). Zapis robi dopiero
`csItemsDesc4B2BPortalsChangeDesc`.

Rodzaje opisu (`csB2BDescriptionTypesG`):

| GUID | Rodzaj |
|---|---|
| `2519e05a-c86c-41c9-79d4-79023b9ef2e0` | Nazwa produktu |
| `95381861-9314-41ae-d36c-deca87152a68` | Opis produktu |

Stałe portalu esavpol.pl: `csB2BPortalsId = 1234896834`,
`csCompaniesId = 213217693`, `csSupLangId = 95` (polski).

W treści `ItemDesc1` przechodzi pełny HTML ze `<style>` — nagrany opis miał
ponad 20 000 znaków i nie był w żaden sposób oczyszczany.

### C — SEO: to NIE jest opis, to pola karty produktu

`SEOTitle_PL` i `SEODescription_PL` siedzą wprost w `csItems`, a zapisuje je
`ActionIdent: csItemsUpdate` (`DataSetTypeIdent: csItems`) z zestawem
`ActiveRecord`, wskazując rekord przez `csItemsG` w `__SelectedRecords__`.

**To jest przebieg niebezpieczny.** Żądanie odsyła **cały rekord produktu** —
około 130 pól: ceny, jednostki, grupy B2B, producenta, EAN, VAT, wagę,
wymiary, opiekuna. Serwer dostaje je wszystkie i wszystkie zapisze.

Wniosek dla implementacji: przy SEO **nie wolno budować wiersza samodzielnie**.
Trzeba wziąć `ActiveRecord` dokładnie taki, jaki ma strona, zmienić w nim
wyłącznie dwie kolumny i odesłać. To ta sama zasada, co przy załącznikach —
z tą różnicą, że tam pomyłka dawała pustą listę, a tu popsułaby kartotekę.

## Potwierdzone zapisem na żywym ERP (4 września 2026)

Pierwszy prawdziwy zapis przeszedł: „Nazwa produktu", 63 znaki, treść
odczytana z powrotem z ERP zgodziła się co do znaku.

Po drodze wyszły dwie rzeczy, obie o kodowaniu:

- **`btoa` nie przyjmuje polskich liter.** Wywala się wyjątkiem na pierwszym
  `ż`. Nie bolało, dopóki wysyłaliśmy same identyfikatory. Trzeba kodować do
  UTF-8 przed base64.
- **Odczyt wzorca musi dekodować UTF-8**, a nie brać bajt po bajcie. Inaczej
  przechwycona treść wraca do ERP zniekształcona, cicho.

Zakres zapisu jest **zamknięty do dwóch rodzajów**: „Nazwa produktu" i „Opis
produktu". Skład, przechowywanie przed i po otwarciu oraz opis skrócony
prowadzi człowiek — skrypt ich nie tyka, a próba podania innego pola kończy
się błędem, nie pominięciem.

## Brak kontroli równoległych zmian

W odpowiedziach **nie ma `RowVersion`, `ETag` ani znacznika wersji**. Zapis
działa na zasadzie „ostatni wygrywa": jeśli ktoś edytuje opis w tym samym
czasie, nadpiszemy go bez ostrzeżenia i bez śladu.

Dlatego zapamiętanie poprzedniej treści przed zapisem nie jest wygodą, tylko
warunkiem — to jedyna droga powrotu.

## Jak wywołać API ze skryptu (potwierdzone 3 września 2026)

Sprawdzone na żywym ERP sondą `diagnostyka/sonda-pobierz-specyfikacje.js`
(cały łańcuch odczyt → akcja → pobranie pliku przeszedł).

**Dane sesji bierzemy z żywego żądania.** `SID`, `SessionId`, `CompaniesId`,
`CPG` i `ParentUniqName` (identyfikator widoku) da się przechwycić, podpinając
się pod `XMLHttpRequest`, i serwer je przyjmuje. `ParentUniqName` zmienia się
między sesjami, więc nic z tego nie wolno wpisać na sztywno.

**Żądania odczytu odtwarzamy z wzorca strony, nie składamy sami.** Próba
złożenia własnego zapytania o siatkę kończyła się kolejnymi odmowami
(„Brakujący: cssuplangmasterdata", potem „Brakujący: csitems"), a gdy dołożono
komplet zestawów — wyjątkiem po stronie serwera. Skuteczna okazała się metoda
prostsza: złapać żądanie, które strona wysyła sama przy wejściu na daną
zakładkę, i powtórzyć je, podmieniając wyłącznie `DelegateIdent` i `QueryUID`
(te są jednorazowe).

**Uwaga na kartoteki.** Jeden produkt bywa kilkoma kartotekami (`0004288`
i `0004288-M`), a wyszukiwanie zwraca obie. Wiersz `csItems` trzeba wybierać
po SKU z adresu strony, nie brać ostatniego widzianego.

## Kształt ODPOWIEDZI różni się od żądania

To kosztowało kilka podejść, bo objawiało się jako „zero wierszy" przy
poprawnym zapytaniu — czyli wyglądało na brak danych w ERP, a było błędem
czytania.

Siatki w odpowiedzi leżą w:

```
Result.RefreshObjectReturnList[N].DataTable
```

i mają `DataSetSQLIdent` równe **`null`**. Szukanie ich po nazwie zestawu nie
zadziała. **Rozpoznajemy je po kolumnach** — np. siatka załączników to ta,
która ma `csAttachmentsId`.

Sama odpowiedź jest w `JSONResult`: base64 ZIP-a spakowanego **deflate**
(w żądaniach ZIP jest bez kompresji — to nie to samo). W przeglądarce
rozpakowuje to `DecompressionStream('deflate-raw')` po ręcznym odcięciu
nagłówka ZIP-a.

## Czego jeszcze nie wiemy

1. **GUID-y pozostałych rodzajów opisu.** Znamy tylko „Nazwa produktu".
   Opis PDP, meta title i meta description mają własne `csB2BDescriptionTypesG`
   — do odczytania przez jednorazową edycję każdego z tych pól z włączonym
   nagraniem (nagrania A, B, C).
2. **`csItemsDesc4B2BPortalsId` dla nowego opisu** — gdy produkt jeszcze nie ma
   wiersza danego typu. Zapewne osobna akcja „dodaj", nie „zmień".
3. **Przełącznik WYSIWYG → textarea** (`isExternalEditor`?) — czy przy zapisie
   przez API trzeba go ustawiać razem z treścią.

## Zasady zapisu (obowiązują niezależnie od transportu)

1. **Nie pisz „na karcie, która jest otwarta".** Wyszukaj SKU, odczytaj je
   z karty z powrotem i porównaj z anchorem. Niezgodność = przerwij.
2. **Domyślnie wypełniaj tylko puste pola.** Nadpisanie ręcznie pisanego opisu
   wymaga świadomej decyzji człowieka.
3. **Zapamiętaj poprzednią treść** przed każdym zapisem (patrz wyżej).
4. **Na początku człowiek zatwierdza zapis.** Automat dopiero po serii
   bezbłędnych przebiegów.
