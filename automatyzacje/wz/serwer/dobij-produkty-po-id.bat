@echo off
REM ============================================================
REM  NA ZADANIE: doscrapowanie produktow po ID (identyfikatory od
REM  Michala) i zapis do PRODUKCJI. Uzywasz, gdy Michal przysle liste
REM  ID brakujacych produktow. Bezpieczne: bierze ten sam globalny lock
REM  co codzienny automat (nie wejdzie rownolegle na ERP).
REM
REM  Jak uzyc:
REM    1. Wklej ID (jeden pod drugim albo po przecinku) do pliku
REM         automatyzacje\produkty\lista-id.txt
REM       (jesli go nie ma, ten skrypt go utworzy i otworzy w Notatniku).
REM    2. Zapisz plik i odpal ten .bat jeszcze raz.
REM ============================================================
setlocal
set REPO_ROOT=%~dp0\..\..\..

cd /d "%REPO_ROOT%"
echo [%date% %time%] git pull (najnowszy kod)...
git pull --no-edit

cd automatyzacje
set LISTA=produkty\lista-id.txt

if not exist "%LISTA%" (
  echo. > "%LISTA%"
  echo Utworzylem pusty plik na ID: %CD%\%LISTA%
  echo Wklej do niego identyfikatory od Michala, zapisz, i odpal ten skrypt ponownie.
  notepad "%LISTA%"
  pause
  exit /b 0
)

REM Sprawdz, czy plik ma jakies znaki niepuste (poza bialymi).
for /f "usebackq delims=" %%L in ("%LISTA%") do (
  set MA_TRESC=1
  goto :HAS
)
echo Plik %LISTA% jest pusty. Wklej ID, zapisz i odpal ponownie.
notepad "%LISTA%"
pause
exit /b 0

:HAS
echo [%date% %time%] Uruchamiam: node dobij-produkty-po-id.js --plik=%LISTA%
node dobij-produkty-po-id.js --plik=%LISTA%
set RC=%ERRORLEVEL%
echo.
echo [%date% %time%] Zakonczono, kod wyjscia: %RC%.
if %RC% EQU 3 echo   (kod 3 = inny bieg scraperow trwal - sprobuj pozniej)
echo Mozesz zamknac to okno.
pause
endlocal
exit /b %RC%
