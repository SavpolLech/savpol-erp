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
REM Kod 3 = lock zajety (np. reczny backfill z innej sesji). Zamiast odpuszczac
REM caly dzien (9.10 bieg 9:30 przepadl), ponawiaj co 15 min, max 32 razy (8 h).
set /a PROBA=0
:bieg
"C:\Program Files\nodejs\node.exe" dobij-wszystko.js >> dobij-wszystko.log 2>&1
if not errorlevel 3 goto po_biegu
if errorlevel 4 goto po_biegu
set /a PROBA+=1
if %PROBA% geq 32 goto po_biegu
echo [launcher] %DATE% %TIME% lock zajety - proba %PROBA%/32, ponowie za 15 min >> dobij-wszystko.log
powershell -NoProfile -Command "Start-Sleep -Seconds 900"
goto bieg
:po_biegu
REM Po biegu: przelicz strone statusu i wypchnij ja do repo (commit+push).
"C:\Program Files\nodejs\node.exe" status\generuj-status.js >> dobij-wszystko.log 2>&1
