@echo off
REM ============================================================
REM  Automatyzacja PZ / przyjecia zewnetrzne (Savpol) -
REM  uruchamiane przez Harmonogram Zadan, JEDEN raz dziennie o 7:00
REM  (dni robocze). Harmonogram Zadan NIE odpala tego pliku co godzine -
REM  ten skrypt sam sobie powtarza sesje scrapowania przez caly dzien,
REM  w petli, az minie okno pracy. NIE trzeba tego nigdy recznie
REM  modyfikowac ani odpalac.
REM
REM  UWAGA: godzina 17:00 to granica ZACZYNANIA nowej sesji, nie jej
REM  przerywania. Sesja, ktora juz trwa o 17:00, dokoncza sie normalnie.
REM  Sprawdzenie godziny jest tylko na starcie petli, przed odpaleniem
REM  KOLEJNEJ sesji.
REM
REM  Przebieg:
REM    1) losowe opoznienie startu dnia: 0-15 min
REM    2) PETLA - kolejna sesja startuje tylko, jesli jest przed 17:00:
REM         a) git pull            - najnowszy kod
REM         b) generate-test-tables.js - odswieza typy kolumn z bazy
REM         c) scrape.js            - jedna sesja (odpalana przez
REM                                    odpal-z-timeoutem.ps1, limit 75 min)
REM         d) przerwa 5-15 min (losowo) przed kolejna sesja
REM    3) scrape.js i tak sam odmawia startu poza 7-17 i w weekendy.
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
  echo [%date% %time%] Godzina %NOW_HOUR% - nie zaczynam kolejnej sesji po godzinach pracy. Koniec na dzis.
  goto :EOF
)

echo [%date% %time%] git pull...
git pull --no-edit

cd automatyzacje\pz

echo [%date% %time%] odswiezam schemat bazy...
node generate-test-tables.js

set FILTER_DATE=wczoraj
set HEADLESS=true

echo [%date% %time%] node scrape.js (sesja scrapowania, limit 75 min)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0odpal-z-timeoutem.ps1" -TimeoutSec 4500
set SESSION_EXIT=%ERRORLEVEL%
if %SESSION_EXIT% EQU 2 (
  echo [%date% %time%] UWAGA: sesja zawiesila sie i zostala ubita po limicie czasu. Usuwam blokade, jade dalej.
  del /f /q ".scrape.lock" 2>nul
) else (
  echo [%date% %time%] Sesja zakonczona sama, kod wyjscia: %SESSION_EXIT%.
)

for /f %%i in ('powershell -NoProfile -Command "Get-Random -Minimum 300 -Maximum 900"') do set BREAK_SEC=%%i
set /a BREAK_MIN=%BREAK_SEC%/60
echo [%date% %time%] przerwa miedzy sesjami: %BREAK_SEC% s (~%BREAK_MIN% min)...
timeout /t %BREAK_SEC% /nobreak >nul

goto :LOOP
