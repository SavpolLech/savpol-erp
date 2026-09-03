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

## Jedno żądanie wystarczy

Kliknięcie w PDF wywołuje w ERP akcję
`csAttachmentsSaveToFileLastVersion` (`ActionExecute`, `DataSetTypeIdent:
"csAttachments"`), która oddaje `RemoteFileInfoList` z `FileIdent` i `FileName`.
**Ta akcja jest jednak zbędna**: `FileIdent` to dokładnie `RemoteIdent`
z siatki `csAttachments` zapisany wielkimi literami — sprawdzone znak w znak.

Wystarczy więc odczytać listę załączników produktu i złożyć URL samemu.
`DownloadUrl` w odpowiedzi jest zawsze `null`, nie ma co na nie liczyć.

## Który załącznik to specyfikacja

Produkt ma zwykle kilka załączników (w nagraniu obok specyfikacji był „Atest").
Rozstrzyga typ:

```
csAttachmentsTypesG = 1b5d6bfc-8585-4056-c57d-1a89ab4b3fd0
                      „Specyfikacja i wartość energetyczna produktu"
```

Wiersz łączy się z produktem przez `SourceId` = `csItemsId`.

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

## Rzecz do sprawdzenia przy implementacji

W adresie nazwa pliku brzmi `CM_CAL_E4_U70.pdf`, a w siatce `LocalFileName`
to `CM-CAL-E4-U70.pdf` — **myślniki zamienione na podkreślniki**. Nie wiadomo,
czy serwer tego pilnuje, czy nazwa jest tylko kosmetyką dla `Content-Disposition`.
Zakładamy to drugie, ale przy pierwszym uruchomieniu warto sprawdzić, czy
oryginalna nazwa też przechodzi. Jeśli nie — zamieniamy znaki spoza
`[A-Za-z0-9._]` na `_`.
