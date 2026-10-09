# Ubija OSIEROCONE przegladarki Playwright (chrome-headless-shell), ktorych
# proces-rodzic (node scrape.js) juz nie zyje. Takie sieroty zostaja po
# zawieszonych/ubitych sesjach scrape i przez kilka dni zjadaja RAM - komputer
# zaczyna "mulic". Odpalane na koniec kazdego biegu (launcher / uruchom.bat).
#
# BEZPIECZENSTWO: celuje WYLACZNIE w "chrome-headless-shell.exe" (headless
# przegladarka Playwright). NIGDY nie dotyka zwyklej Chrome uzytkownika
# (to inny plik: "chrome.exe"). Dodatkowo rusza tylko te, ktorych rodzic juz
# nie zyje - wiec nie ubije przegladarki zywej, trwajacej sesji scrape (nawet
# gdyby jakims cudem leciala rownolegle).

$ErrorActionPreference = 'SilentlyContinue'

# Zbior zyjacych PID-ow (do sprawdzenia, czy rodzic jeszcze istnieje).
$live = @{}
Get-Process | ForEach-Object { $live[[int]$_.Id] = $true }

# "Korzenie" drzewa Playwright: chrome-headless-shell, ktorego rodzic NIE jest
# innym chrome-headless-shell (czyli byl odpalony przez node). Renderery (dzieci)
# ubije taskkill /T razem z korzeniem.
$shells = Get-CimInstance Win32_Process -Filter "Name='chrome-headless-shell.exe'"
$shellPids = @{}; $shells | ForEach-Object { $shellPids[[int]$_.ProcessId] = $true }

$ubite = 0
foreach ($p in $shells) {
  $ppid = [int]$p.ParentProcessId
  $rodzicToShell = $shellPids.ContainsKey($ppid)   # to jest renderer, nie korzen
  $rodzicZyje = $live.ContainsKey($ppid)
  if (-not $rodzicToShell -and -not $rodzicZyje) {
    & taskkill /PID $p.ProcessId /T /F | Out-Null   # ubij cale drzewo tej przegladarki
    if ($LASTEXITCODE -eq 0) { $ubite++ }
  }
}
Write-Output ("[sprzatanie] osierocone przegladarki Playwright ubite: " + $ubite)
