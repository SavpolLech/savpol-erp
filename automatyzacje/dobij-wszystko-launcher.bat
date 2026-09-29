@echo off
REM Launcher dla Harmonogramu Zadan Windows na LOKALNEJ maszynie Lecha.
REM Odpala orkiestrator wszystkich scraperow (WZ -> MM -> PZ, sekwencyjnie,
REM pod globalnym lockiem). TOAST=true wlacza powiadomienia Windows (widoczne
REM tylko przy zalogowanym userze, tryb "Interactive only"). Na SERWERZE do
REM tego sluzy wz\serwer\uruchom.bat (bez toastow, z git pull).
REM Log dopisywany do dobij-wszystko.log obok.
cd /d "%~dp0"
set TOAST=true
"C:\Program Files\nodejs\node.exe" dobij-wszystko.js >> dobij-wszystko.log 2>&1
