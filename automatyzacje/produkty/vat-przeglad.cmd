@echo off
rem Comiesieczny przeglad stawek VAT (esavpol.pl, blok netto + VAT). Skrypt i opis: esavpol-pdp
rem tools/pdp-generator/scripts/baza-powiazan/vat-przeglad.mjs, uruchamiany z osobnego worktree
rem esavpol-pdp-vat. Harmonogram: "esavpol - przeglad VAT (miesiecznie)", 1. dnia miesiaca 08:00.
rem Raport: wynik\vat-przeglad-<data>.txt, log: wynik\vat-przeglad.log.
echo ===== %date% %time% >> "%~dp0wynik\vat-przeglad.log"
"C:\Program Files\nodejs\node.exe" "C:\Users\l.dudkiewicz\Documents\claude_code\esavpol-pdp-vat\tools\pdp-generator\scripts\baza-powiazan\vat-przeglad.mjs" >> "%~dp0wynik\vat-przeglad.log" 2>&1
