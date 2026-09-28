@echo off
REM Launcher dla Harmonogramu Zadan Windows (zadanie "SavpolMWS-tydzien", maszyna Lecha,
REM poniedzialek 07:00). Odswieza flagi chlodnia/mroznia/kruche z ERP i baze cross-sellu.
REM Log dopisywany do tydzien-mws.log obok. Szczegoly: tydzien-mws.js.
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" tydzien-mws.js >> tydzien-mws.log 2>&1
