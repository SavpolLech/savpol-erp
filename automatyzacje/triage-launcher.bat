@echo off
REM Launcher dla Harmonogramu Zadan Windows: tygodniowy triage rozbieznosci
REM ERP<->worek (piatek 7:30, przed orkiestratorem o 8:00). Bez ERP i locka -
REM czyta ROZBIEZNOSCI.md, pisze DO-SPRAWDZENIA.md i sam robi commit+push.
REM Najpierw git pull, zeby liczyc na najnowszych zgloszeniach z serwera.
cd /d "%~dp0"
git pull --ff-only -q >> triage-rozbieznosci.log 2>&1
"C:\Program Files\nodejs\node.exe" triage-rozbieznosci.js >> triage-rozbieznosci.log 2>&1
