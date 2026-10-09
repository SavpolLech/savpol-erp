@echo off
REM ============================================================
REM  Orkiestrator scraperow ERP (Savpol) - WZ + MM + PZ.
REM  Uruchamiane przez Harmonogram Zadan JEDEN raz dziennie w dni
REM  robocze (pon-pt). NIE trzeba tego nigdy recznie modyfikowac.
REM
REM  Co robi:
REM    1) git pull  - najnowszy kod (Lech aktualizuje, ten plik go
REM                   sam podciaga; zero akcji Tomka)
REM    2) node automatyzacje\dobij-wszystko.js  - przechodzi typy PO
REM       KOLEI [wz, mm, pz]. Dla kazdego "nadgania" kazdy niekompletny
REM       dzien z okna wstecz (domyslnie 5 dni) az do kompletu, POTEM
REM       przechodzi do nastepnego typu. NIGDY dwa naraz - ERP znosi
REM       tylko jedna sesje logowania. Pisze WPROST do tabel PROD.
REM
REM  Weekend: zadanie odpala sie pon-pt, ale okno wstecz sprawia, ze
REM  poniedzialkowy bieg sam dobiera piatek+sobote+niedziele (sob/nd
REM  bywaja niepuste). StartWhenAvailable w Harmonogramie dobija tez
REM  przegapiony bieg.
REM
REM  Limit czasu pojedynczej sesji (75 min, ubicie zawieszonej) i pauzy
REM  robi juz sam dobij-wszystko.js / lib-wspolne/catchup.js - tu NIE ma
REM  petli calodniowej. Serwer jest headless: zadnych toastow.
REM ============================================================

setlocal
REM %~dp0 = ...\automatyzacje\wz\serwer\  -> repo root to trzy katalogi wyzej
set REPO_ROOT=%~dp0\..\..\..

cd /d "%REPO_ROOT%"

echo [%date% %time%] git pull...
git pull --no-edit

cd automatyzacje

echo [%date% %time%] node dobij-wszystko.js (WZ -> MM -> PZ, sekwencyjnie)...
node dobij-wszystko.js
set RC=%ERRORLEVEL%

echo [%date% %time%] Orkiestrator zakonczony, kod wyjscia: %RC%.
REM  RC=0 wszystko domkniete | RC=1 jakis dzien niedomkniety (dokonczy
REM  nastepny bieg) | RC=3 lock zajety (inny bieg trwal - to OK).

echo [%date% %time%] Przeliczam strone statusu i wypycham do repo...
node status\generuj-status.js

echo [%date% %time%] Sprzatanie osieroconych przegladarek Playwright...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\..\sprzataj-przegladarki.ps1"

endlocal
exit /b %RC%
