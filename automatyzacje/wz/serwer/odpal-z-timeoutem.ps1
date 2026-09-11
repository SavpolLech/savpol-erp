# Odpala "node scrape.js" z limitem czasu. Normalna sesja trwa 30-60 min
# (losowane wewnatrz scrape.js) - jesli proces nie zakonczy sie w
# TimeoutSec, uznajemy go za zawieszony (np. ERP przestal odpowiadac,
# element na stronie nigdy sie nie pojawil) i ubijamy CALA galaz
# procesow (node + jego dziecko - przeglarke Chromium spod Playwright).
#
# Kod wyjscia:
#   0    - scrape.js zakonczyl sie sam, normalnie
#   inny - scrape.js zakonczyl sie sam, z bledem (np. blokada sesji)
#   2    - MY go ubilismy, bo przekroczyl limit czasu (zawieszony)
param(
  [int]$TimeoutSec = 4500
)

$workDir = Join-Path $PSScriptRoot ".."
$proc = Start-Process -FilePath "node" -ArgumentList "scrape.js" -WorkingDirectory $workDir -PassThru -NoNewWindow

try {
  Wait-Process -Id $proc.Id -Timeout $TimeoutSec -ErrorAction Stop
  exit $proc.ExitCode
} catch {
  Write-Host "[timeout] Sesja scrapowania (PID $($proc.Id)) nie zakonczyla sie w $TimeoutSec s - uznaje za zawieszona, ubijam cala galaz procesow (node + Chromium)."
  try { & taskkill /PID $proc.Id /T /F | Out-Null } catch {}
  exit 2
}
