@echo off
REM Launcher dla Harmonogramu Zadan Windows (maszyna Lecha, rozwiazanie
REM przejsciowe zanim stanie serwer). Wchodzi do katalogu wz i odpala
REM node dobij-wczoraj.js, ktory dobija WCZORAJSZY dzien do PRODUKCJI.
REM Log dopisywany do dobij-wczoraj.log obok.
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" dobij-wczoraj.js >> dobij-wczoraj.log 2>&1
