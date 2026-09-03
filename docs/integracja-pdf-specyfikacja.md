# Pobieranie PDF-a ze specyfikacją produktu

Ustalone 3 września 2026 z nagrania ręcznego pobrania
(`diagnostyka/podglad-zapisu-erp.js`) i adresu skopiowanego z `chrome://downloads`.

Powód: dziś jedyny ręczny krok w budowaniu opisu to wklejenie tego PDF-a do
apki generatora. Specyfikacja siedzi w ERP doklejona do produktu, ale jej URL
nie był znany.

## Adres pliku

```
https://erp.savpol.pl/api/attachment/get/{CPG}/OpenFileIdent/{base64(FileIdent)}/{FileName}?SID={SID}
```

Przykład:

```
https://erp.savpol.pl/api/attachment/get/72203914-A31D-4B25-7735-F18BE44421C2
  /OpenFileIdent/RkQyMzZBRDgtQjI1OS00RjMxLUM4RkYtRDY5MDc3QTkwQjUx
  /CM_CAL_E4_U70.pdf?SID=563fce634b740563d85bb1f94b0ad9d9
```

Gdzie:

| Element | Skąd | Uwagi |
|---|---|---|
| `CPG` | `LoginInfo.CPG` w każdym payloadzie | stała firmy |
| `FileIdent` | `RemoteIdent` z wiersza załącznika, **wielkimi literami** | potem base64 |
| `FileName` | `LocalFileName` z tego samego wiersza | patrz niżej |
| `SID` | `SID` z payloadu | identyfikator sesji |

## Po `FileIdent` idziemy akcją, nie skrótem

Kliknięcie w PDF wywołuje w ERP akcję `csAttachmentsSaveToFileLastVersion`
(`ActionExecute`, `DataSetTypeIdent: "csAttachments"`), która oddaje
`RemoteFileInfoList` z `FileIdent` i `FileName`. `DownloadUrl` jest przy tym
zawsze `null`, nie ma co na nie liczyć.

W jedynej nagranej próbce `FileIdent` okazał się równy `RemoteIdent` z siatki
zapisanemu wielkimi literami, więc kusiło, żeby akcję pominąć i składać URL
prosto z listy załączników. **Nie robimy tego.**

Powód: **załącznik ma wiele wersji** (w ERP widać kolumnę „WERSJA", wartości
rzędu 9 czy 24), a akcja nazywa się `…LastVersion` — czyli jej zadaniem jest
wskazać wersję NAJNOWSZĄ. Nie wiemy, czy `RemoteIdent` w wierszu siatki zawsze
pokazuje właśnie ją. Jedna zgodna próbka tego nie dowodzi, a cena pomyłki jest
wysoka i cicha: skrypt pobrałby starą specyfikację i nikt by się nie zorientował,
bo plik by się otworzył normalnie.

Jedno dodatkowe żądanie jest tańsze niż opis produktu zbudowany ze
nieaktualnych danych.

## Który załącznik to specyfikacja

Produkt ma zwykle kilka załączników (w nagraniu obok specyfikacji był „Atest").
Rozstrzyga typ:

```
csAttachmentsTypesG = 1b5d6bfc-8585-4056-c57d-1a89ab4b3fd0
                      „Specyfikacja i wartość energetyczna produktu"
```

Wiersz łączy się z produktem przez `SourceId` = `csItemsId`.

**Typ nie zawsze wystarcza.** Zdarza się kilka wierszy tego samego typu
„Specyfikacja" — człowiek wybiera wtedy ten o najnowszej dacie dodania.
Odwzorowanie: po odfiltrowaniu po typie bierzemy wiersz o największym
`AddDate`, a dopiero z niego akcję „ostatnia wersja".

Czyli pełna reguła wyboru, w dwóch krokach:

1. **który załącznik** — typ = specyfikacja, a przy remisie najnowszy `AddDate`;
2. **która wersja** — zawsze najnowsza, czym zajmuje się akcja.

Gdy po filtrze nie ma ani jednego wiersza, przerywamy i mówimy o tym wprost.
Produkt bez specyfikacji to normalna sytuacja, nie błąd — ale opis budowany
bez niej byłby gorszy, a milczenie by to ukryło.

Przydatne pola wiersza `csAttachments`:

| Pole | Przykład | Rola |
|---|---|---|
| `SourceId` | `218527505` | `csItemsId` produktu |
| `csAttachmentsTypesG` | `1b5d6bfc-…` | rodzaj załącznika |
| `RemoteIdent` | `fd236ad8-b259-…` | po zamianie na wielkie litery = `FileIdent` |
| `LocalFileName` | `CM-CAL-E4-U70.pdf` | nazwa, jaką widzi człowiek |
| `RemoteFileName` | `fd236ad8-….pdf` | nazwa na dysku serwera |
| `IsFile` | `1` | czy to plik, a nie link |
| `VersionId` | `2` | wersja; akcja bierze ostatnią |

## Potwierdzone na żywym ERP (3 września 2026)

Sonda przeszła cały łańcuch na produkcie `0004288`, który ma trzy załączniki,
w tym **dwie** specyfikacje — czyli dokładnie przypadek wymagający wyboru po
dacie:

```
wierszy załączników: 3
  Specyfikacja … | wersja=1   | dodano=2017-02-01
  Specyfikacja … | wersja=1   | dodano=2019-05-30
  Atest          | wersja=108 | dodano=2026-08-17
kandydatów: 2, biorę najnowszy (2019-05-30)
HTTP 200 | typ: application/pdf | bajtów: 796457 | sygnatura "%PDF-"
```

**Nazwę pliku bierzemy z odpowiedzi akcji (`FileName`), nie z siatki.** Serwer
oddaje ją już oczyszczoną i to ona pasuje do adresu. W tym przypadku
`LocalFileName` i `FileName` były zgodne, ale w nagraniu z `0011347` różniły
się myślnikami i podkreślnikami — po co zgadywać, skoro serwer podaje gotową.

**Skrót „FileIdent = RemoteIdent wielkimi literami" znowu się potwierdził**,
ale zostajemy przy akcji. Obie specyfikacje miały wersję 1, więc ten przebieg
w ogóle nie sprawdził przypadku wielu wersji — a Atest obok ma ich 108.

## Rzecz do sprawdzenia przy implementacji

W adresie nazwa pliku brzmi `CM_CAL_E4_U70.pdf`, a w siatce `LocalFileName`
to `CM-CAL-E4-U70.pdf` — **myślniki zamienione na podkreślniki**. Nie wiadomo,
czy serwer tego pilnuje, czy nazwa jest tylko kosmetyką dla `Content-Disposition`.
Zakładamy to drugie, ale przy pierwszym uruchomieniu warto sprawdzić, czy
oryginalna nazwa też przechodzi. Jeśli nie — zamieniamy znaki spoza
`[A-Za-z0-9._]` na `_`.
