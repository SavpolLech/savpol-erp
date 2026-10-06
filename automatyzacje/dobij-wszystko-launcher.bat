@echo off
REM Launcher dla Harmonogramu Zadan Windows na LOKALNEJ maszynie Lecha.
REM Odpala orkiestrator wszystkich scraperow (WZ -> MM -> PZ, sekwencyjnie,
REM pod globalnym lockiem). TOAST=true wlacza powiadomienia Windows (widoczne
REM tylko przy zalogowanym userze, tryb "Interactive only"). Na SERWERZE do
REM tego sluzy wz\serwer\uruchom.bat (bez toastow, z git pull).
REM Log dopisywany do dobij-wszystko.log obok.
cd /d "%~dp0"
set TOAST=true
REM Zaleglosci sprzedazy (FA+PAR) po zwyklym biegu, max do 18:00 (Tomek 6.10).
REM Gdy wszystkie dni sa kompletne, krok nic nie robi - wtedy usun te 2 linie.
set ZALEGLOSCI=2026-07-01..2026-09-14
set ZALEGLOSCI_DO_GODZINY=18:00
"C:\Program Files\nodejs\node.exe" dobij-wszystko.js >> dobij-wszystko.log 2>&1
