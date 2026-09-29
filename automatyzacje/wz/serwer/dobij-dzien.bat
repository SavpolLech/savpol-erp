@echo off
REM ============================================================
REM  RECZNE dobicie jednego dnia jednego typu dokumentu do PRODUKCJI.
REM  Dla Tomka/Michala: gdy ERP pokazuje wiecej dokumentow niz jest w
REM  worku (bazie), mozna tu samemu dociagnac brakujace. Dwuklik,
REM  wpisz typ i date - reszta dzieje sie sama. Bezpieczne: bierze ten
REM  sam globalny lock co codzienny automat (nie wejdzie rownolegle na
REM  ERP), a dedup dopisuje TYLKO brakujace (nie duplikuje).
REM
REM  Dziala tak samo na serwerze i na maszynie Lecha.
REM ============================================================
setlocal
set REPO_ROOT=%~dp0\..\..\..

cd /d "%REPO_ROOT%"
echo [%date% %time%] git pull (najnowszy kod)...
git pull --no-edit

cd automatyzacje

echo.
set /p TYP=Jaki dokument? wpisz wz, mm albo pz:
set /p DATA=Ktora data? format RRRR-MM-DD (np. 2026-09-15):
echo.
echo Tryb:
echo   [Enter] szybki  - dobiera brakujace (najczestszy przypadek)
echo   p               - pelny: przeklikuje dzien OD ZERA (gdy szybki nie pomogl)
set /p TRYB=Wybor (Enter = szybki, p = pelny):

set FLAGA=
if /i "%TRYB%"=="p" set FLAGA=--pelny

echo.
echo [%date% %time%] Uruchamiam: node dobij-dzien.js %TYP% %DATA% %FLAGA%
node dobij-dzien.js %TYP% %DATA% %FLAGA%
set RC=%ERRORLEVEL%

echo.
echo [%date% %time%] Zakonczono, kod wyjscia: %RC%.
if %RC% EQU 3 echo   (kod 3 = inny bieg scraperow trwal - sprobuj pozniej)
echo Mozesz zamknac to okno.
pause
endlocal
exit /b %RC%
