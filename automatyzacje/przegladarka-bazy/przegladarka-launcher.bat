@echo off
REM Otwiera lokalna przegladarke bazy worek (tylko odczyt) w przegladarce.
REM Zamkniecie tego okna wylacza przegladarke.
cd /d "%~dp0"
if not exist node_modules (
  echo Pierwsze uruchomienie - instaluje zaleznosci...
  call npm install --omit=dev
)
"C:\Program Files\nodejs\node.exe" server.js
pause
