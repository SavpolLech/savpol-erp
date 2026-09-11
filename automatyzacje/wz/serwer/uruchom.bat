@echo off
REM ============================================================
REM  Automatyzacja WZ (Savpol) - uruchamiane przez Harmonogram Zadan,
REM  JEDEN raz dziennie o 7:00 (dni robocze). Harmonogram Zadan NIE
REM  odpala tego pliku co godzine - ten skrypt sam sobie powtarza
REM  sesje scrapowania przez caly dzien, w petli, az minie okno pracy.
REM  NIE trzeba tego nigdy recznie modyfikowac ani odpalac.
REM
REM  Przebieg:
REM    1) losowe opoznienie startu dnia: 0-15 min (zeby nie logowac sie
REM       do ERP zawsze punktualnie o 7:00 - wygladaloby to jak bot)
REM    2) PETLA, az zegar wskaze 17:00 lub pozniej:
REM         a) git pull            - najnowszy kod (Lech aktualizuje,
REM                                   ten plik go automatycznie
REM                                   podciaga, zero akcji Tomka)
REM         b) generate-test-tables.js - odswieza typy kolumn z bazy
REM                                       (baza bywa przebudowywana)
REM         c) scrape.js            - jedna sesja scrapowania (30-60 min,
REM                                    losowane wewnatrz scrape.js),
REM                                    pisze WPROST do bazy (nie CSV)
REM         d) przerwa 5-15 min (losowo) przed kolejna sesja
REM    3) scrape.js i tak sam odmawia startu poza godzinami 7-17 i w
REM       weekendy (niezaleznie od tej petli) - to tylko dodatkowe
REM       zabezpieczenie w samym skrypcie.
REM ============================================================

setlocal
set REPO_ROOT=%~dp0\..\..\..

cd /d "%REPO_ROOT%"

for /f %%i in ('powershell -NoProfile -Command "Get-Random -Minimum 0 -Maximum 900"') do set START_DELAY_SEC=%%i
set /a START_DELAY_MIN=%START_DELAY_SEC%/60
echo [%date% %time%] losowe opoznienie startu dnia: %START_DELAY_SEC% s (~%START_DELAY_MIN% min)...
timeout /t %START_DELAY_SEC% /nobreak >nul

:LOOP
cd /d "%REPO_ROOT%"

for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do set NOW_HOUR=%%h
if %NOW_HOUR% GEQ 17 (
  echo [%date% %time%] Godzina %NOW_HOUR% - po godzinach pracy, koncze na dzis.
  goto :EOF
)

echo [%date% %time%] git pull...
git pull --no-edit

cd automatyzacje\wz

echo [%date% %time%] odswiezam schemat bazy...
node generate-test-tables.js

set FILTER_DATE=wczoraj
set HEADLESS=true

echo [%date% %time%] node scrape.js (sesja scrapowania)...
node scrape.js

for /f %%i in ('powershell -NoProfile -Command "Get-Random -Minimum 300 -Maximum 900"') do set BREAK_SEC=%%i
set /a BREAK_MIN=%BREAK_SEC%/60
echo [%date% %time%] przerwa miedzy sesjami: %BREAK_SEC% s (~%BREAK_MIN% min)...
timeout /t %BREAK_SEC% /nobreak >nul

goto :LOOP
