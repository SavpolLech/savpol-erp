@echo off
REM Launcher dla Harmonogramu Zadan Windows (zadanie "Savpol - cross-sell baza powiazan",
REM pierwszy poniedzialek miesiaca 11:00). Przelicza baze powiazan cross-sell esavpol.pl:
REM   1. eksport-wz.js  - koszyki WZ z bazy worek (tylko odczyt) do %TEMP%\baza-powiazan
REM   2. odswiez.mjs    - zrzut katalogu sklepu, karty, flagi MWS, 3 warianty, commit bazy na
REM                       origin/main repo esavpol-pdp (endpoint v2 czyta ja na zywo = publikacja)
REM Worktree automatow (ten sam co mws-aktualizuj z joba esavpol_seo o 13:00) - przed startem na
REM swiezy origin/main, zeby odswiez.mjs tez byl aktualny. Log dopisywany do odswiez-baza.log obok.
setlocal
cd /d "%~dp0"
set "WT=C:\Users\l.dudkiewicz\Documents\claude_code\esavpol-pdp-baza-powiazan"
set "CSV=C:\Users\l.dudkiewicz\Documents\savpol-erp\savpol-erp\automatyzacje\produkty\wynik\etykiety-finalne.csv"
set "NODE=C:\Program Files\nodejs\node.exe"
REM Dzieci odswiez.mjs (buduj.mjs na 2,6 mln pozycji WZ) dziedzicza limit pamieci.
set "NODE_OPTIONS=--max-old-space-size=6000"
echo ==== %date% %time% start >> odswiez-baza.log
"%NODE%" eksport-wz.js >> odswiez-baza.log 2>&1 || (echo BLAD eksportu WZ - baza bez zmian >> odswiez-baza.log & exit /b 1)
git -C "%WT%" -c core.longpaths=true fetch -q origin main >> odswiez-baza.log 2>&1 || (echo BLAD git fetch >> odswiez-baza.log & exit /b 1)
git -C "%WT%" -c core.longpaths=true checkout -q --detach origin/main >> odswiez-baza.log 2>&1 || (echo BLAD checkout - worktree ma zmiany? >> odswiez-baza.log & exit /b 1)
"%NODE%" "%WT%\tools\pdp-generator\scripts\baza-powiazan\odswiez.mjs" --csv="%CSV%" --wz="%TEMP%\baza-powiazan\koszyki-wz.tsv" >> odswiez-baza.log 2>&1
set "RC=%ERRORLEVEL%"
echo ==== %date% %time% koniec kod=%RC% >> odswiez-baza.log
exit /b %RC%
