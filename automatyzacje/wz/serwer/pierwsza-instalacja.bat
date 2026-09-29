@echo off
REM ============================================================
REM  Orkiestrator scraperow ERP (Savpol: WZ + MM + PZ) - PIERWSZA
REM  INSTALACJA na serwerze. Odpalasz to RAZ (dwuklik). Zero
REM  znajomosci GitHuba potrzebne.
REM
REM  ZANIM ODPALISZ: na tym komputerze musi byc zainstalowane
REM    1) Node.js (LTS)  - https://nodejs.org  (instalator, "dalej dalej zakoncz")
REM    2) Git for Windows - https://git-scm.com/download/win (instalator, "dalej dalej zakoncz")
REM  Po instalacji obu programow - PONOWNIE ZALOGUJ SIE na komputer
REM  (albo zrestartuj), zanim odpalisz ten plik.
REM ============================================================

setlocal

REM Folder, w ktorym stanie caly projekt. Zmien jesli chcesz inne miejsce.
set INSTALL_DIR=C:\savpol-automatyzacje

REM !!! DO WYPELNIENIA PRZEZ LECHA PRZED WYSLANIEM TEGO PLIKU DO TOMKA !!!
REM Adres repo z wklejonym tokenem dostepu (Lech wkleja token recznie w swojej
REM kopii na dysku sieciowym; w repo zostaje placeholder ponizej).
REM Lech generuje token na GitHub i wkleja go w miejsce WKLEJ_TUTAJ_TOKEN
REM w SWOJEJ kopii tego pliku (na dysku sieciowym) - NIGDY w repo.
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
  echo === Pobieram kod (git clone galezi main - zawiera WZ, MM i PZ) ===
  git clone "%REPO_URL%" "%INSTALL_DIR%"
  if errorlevel 1 (
    echo BLAD: klonowanie sie nie udalo. Sprawdz polaczenie z internetem i czy token w tym pliku jest poprawny.
    pause
    exit /b 1
  )
)

REM Zaleznosci per scraper - kazdy ma wlasny node_modules. Chromium dla
REM Playwright pobieramy RAZ (jest wspolny dla calego systemu).
for %%T in (wz mm pz) do (
  echo.
  echo === [%%T] npm install - moze potrwac kilka minut ===
  pushd "%INSTALL_DIR%\automatyzacje\%%T"
  call npm install
  if errorlevel 1 (
    echo BLAD: npm install dla %%T sie nie udalo.
    popd
    pause
    exit /b 1
  )
  popd
)

echo.
echo === Pobieram Chromium dla Playwright (headless) - raz dla wszystkich, kilka minut ===
pushd "%INSTALL_DIR%\automatyzacje\wz"
call npx playwright install chromium
if errorlevel 1 (
  echo BLAD: pobranie Chromium sie nie udalo.
  popd
  pause
  exit /b 1
)
popd

REM Jeden WSPOLNY plik sekretow dla wszystkich trzech scraperow.
if not exist "%INSTALL_DIR%\automatyzacje\.env" (
  echo.
  echo === Tworze szablon wspolnego .env ===
  copy "%INSTALL_DIR%\automatyzacje\.env.example" "%INSTALL_DIR%\automatyzacje\.env" >nul
)

echo.
echo ============================================================
echo  INSTALACJA ZAKONCZONA.
echo.
echo  DALSZE KROKI (recznie):
echo  1) Otworz plik:
echo       %INSTALL_DIR%\automatyzacje\.env
echo     i wpisz do niego prawdziwe dane dostepowe (dostaniesz je od Lecha).
echo     To JEDEN wspolny plik dla WZ, MM i PZ.
echo  2) Zarejestruj zadanie w Harmonogramie Zadan Windows wskazujace na:
echo       %INSTALL_DIR%\automatyzacje\wz\serwer\uruchom.bat
echo     - szczegolowa instrukcja krok po kroku jest w pliku:
echo       %INSTALL_DIR%\automatyzacje\wz\serwer\INSTALACJA.md
echo     - jak potem korzystac (reczne dobicie dnia, produkty po ID):
echo       %INSTALL_DIR%\automatyzacje\wz\serwer\OBSLUGA.md
echo ============================================================
pause
