@echo off
REM ============================================================
REM  Automatyzacja WZ (Savpol) - PIERWSZA INSTALACJA na serwerze
REM  Odpalasz to RAZ (dwuklik). Zero znajomosci GitHuba potrzebne.
REM
REM  ZANIM ODPALISZ: na tym komputerze musi byc zainstalowane
REM    1) Node.js (LTS)  - https://nodejs.org  (instalator, zwykle "dalej dalej zakoncz")
REM    2) Git for Windows - https://git-scm.com/download/win (instalator, "dalej dalej zakoncz")
REM  Po instalacji obu programow - PONOWNIE ZALOGUJ SIE na komputer
REM  (albo zrestartuj), zanim odpalisz ten plik.
REM ============================================================

setlocal

REM Folder, w ktorym stanie caly projekt. Zmien jesli chcesz inne miejsce.
set INSTALL_DIR=C:\savpol-automatyzacje

REM !!! DO WYPELNIENIA PRZEZ LECHA PRZED WYSLANIEM TEGO PLIKU DO TOMKA !!!
REM Adres repo z wklejonym tokenem dostepu (patrz INSTRUKCJA-TOMEK.md,
REM sekcja "Skad ten adres" - Lech generuje token na GitHub i wkleja go
REM w miejsce WKLEJ_TUTAJ_TOKEN nizej, w SWOJEJ kopii tego pliku).
set REPO_URL=https://WKLEJ_TUTAJ_TOKEN@github.com/SavpolLech/savpol-erp.git

echo.
echo === Sprawdzam czy Node.js i Git sa zainstalowane ===
where node >nul 2>nul
if errorlevel 1 (
  echo BLAD: nie znaleziono "node". Zainstaluj Node.js (https://nodejs.org), zaloguj sie ponownie i sprobuj jeszcze raz.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo BLAD: nie znaleziono "git". Zainstaluj Git for Windows (https://git-scm.com/download/win), zaloguj sie ponownie i sprobuj jeszcze raz.
  pause
  exit /b 1
)
echo OK - obydwa znalezione.

if exist "%INSTALL_DIR%" (
  echo.
  echo UWAGA: folder %INSTALL_DIR% juz istnieje - pomijam klonowanie.
  echo Jesli to pierwsza instalacja i cos poszlo nie tak, usun ten folder recznie i odpal ten plik jeszcze raz.
) else (
  echo.
  echo === Pobieram kod (git clone) ===
  git clone --branch wz-deploy "%REPO_URL%" "%INSTALL_DIR%"
  if errorlevel 1 (
    echo BLAD: klonowanie sie nie udalo. Sprawdz polaczenie z internetem i czy token w tym pliku jest poprawny.
    pause
    exit /b 1
  )
)

cd "%INSTALL_DIR%\automatyzacje\wz"

echo.
echo === Instaluje zaleznosci (npm install) - moze to potrwac kilka minut ===
call npm install
if errorlevel 1 (
  echo BLAD: npm install sie nie udalo.
  pause
  exit /b 1
)

echo.
echo === Pobieram Chromium dla Playwright (headless) - moze to potrwac kilka minut ===
call npx playwright install chromium
if errorlevel 1 (
  echo BLAD: pobranie Chromium sie nie udalo.
  pause
  exit /b 1
)

if not exist ".env" (
  echo.
  echo === Tworze szablon .env ===
  copy .env.example .env >nul
)

echo.
echo ============================================================
echo  INSTALACJA ZAKONCZONA.
echo.
echo  DALSZE KROKI (recznie):
echo  1) Otworz plik:
echo       %INSTALL_DIR%\automatyzacje\wz\.env
echo     i wpisz do niego prawdziwe dane dostepowe (dostaniesz je od Lecha).
echo  2) Zarejestruj zadanie w Harmonogramie Zadan Windows wskazujace na:
echo       %INSTALL_DIR%\automatyzacje\wz\serwer\uruchom.bat
echo     - szczegolowa instrukcja krok po kroku jest w pliku:
echo       %INSTALL_DIR%\automatyzacje\wz\serwer\INSTRUKCJA-TOMEK.md
echo ============================================================
pause
