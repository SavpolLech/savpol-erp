@echo off
REM ============================================================
REM  Automatyzacja WZ (Savpol) - uruchamiane przez Harmonogram Zadan.
REM  NIE trzeba tego nigdy recznie modyfikowac ani odpalac -
REM  Harmonogram Zadan wskazuje wprost na ten plik.
REM
REM  Za kazdym razem:
REM    1) "git pull" - pobiera najnowsza wersje kodu z repo (Lech
REM       aktualizuje kod, ten plik go automatycznie podciaga, zero
REM       akcji ze strony Tomka)
REM    2) odswieza typy kolumn z bazy (schema-test-tables.json) -
REM       baza bywa przebudowywana, nie zakladamy ze jest stala
REM    3) CZEKA losowo 0-15 minut - Harmonogram Zadan odpala ten plik co
REM       godzine, punktualnie o pelnej godzinie. Bez tego kroku logowanie
REM       do ERP wygladaloby jak bot (dokladnie 8:00:00, 9:00:00, ...).
REM       Kroki 1-2 wyzej nie dotykaja ERP, moga isc od razu - czekamy
REM       tylko przed samym zalogowaniem. Przedzial celowo krotki - sesja
REM       scrapowania sama trwa do 60 min, dlugie opoznienie zjadaloby
REM       zbyt duzo okna pracy przed nastepnym odpaleniem.
REM    4) odpala scraper, ktory pisze WPROST do bazy (nie CSV)
REM ============================================================

setlocal
cd /d "%~dp0\..\..\.."

echo [%date% %time%] git pull...
git pull --no-edit

cd automatyzacje\wz

echo [%date% %time%] odswiezam schemat bazy...
node generate-test-tables.js

for /f %%i in ('powershell -NoProfile -Command "Get-Random -Minimum 0 -Maximum 900"') do set DELAY_SEC=%%i
set /a DELAY_MIN=%DELAY_SEC%/60
echo [%date% %time%] losowe opoznienie przed zalogowaniem do ERP: %DELAY_SEC% s (~%DELAY_MIN% min)...
timeout /t %DELAY_SEC% /nobreak >nul

set FILTER_DATE=wczoraj
set HEADLESS=true

echo [%date% %time%] node scrape.js (FILTER_DATE=wczoraj, zapis do bazy)...
node scrape.js

echo [%date% %time%] Zakonczono.
