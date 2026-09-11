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
REM    3) odpala scraper, ktory pisze WPROST do bazy (nie CSV)
REM ============================================================

setlocal
cd /d "%~dp0\..\..\.."

echo [%date% %time%] git pull...
git pull --no-edit

cd automatyzacje\wz

echo [%date% %time%] odswiezam schemat bazy...
node generate-test-tables.js

set FILTER_DATE=wczoraj
set HEADLESS=true

echo [%date% %time%] node scrape.js (FILTER_DATE=wczoraj, zapis do bazy)...
node scrape.js

echo [%date% %time%] Zakonczono.
