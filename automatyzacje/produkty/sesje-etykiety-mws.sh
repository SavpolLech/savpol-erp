#!/bin/bash
# Odpala kolejne sesje scrape-etykiety-mws.js, losowe 10-15 minut, z
# 1-2 minutowymi przerwami między nimi, dopóki starcza budżetu czasu.
# Każda sesja sama zapisuje swój CSV (etykiety-run-NNN.csv) i stan
# (state/etykiety-mws.json) na koniec — patrz main()/finally w skrypcie.
#
# Użycie: ./sesje-etykiety-mws.sh <budzet_minut>

cd "$(dirname "$0")"

BUDZET_MIN="${1:-100}"
END=$(( $(date +%s) + BUDZET_MIN * 60 ))
SESJA=1

echo "[orkiestracja] Start. Budżet: $BUDZET_MIN minut. Koniec ok. $(date -d "@$END" '+%H:%M:%S' 2>/dev/null || date -r "$END" '+%H:%M:%S')."

while true; do
  NOW=$(date +%s)
  POZOSTALO_S=$(( END - NOW ))
  POZOSTALO_MIN=$(( POZOSTALO_S / 60 ))

  # Poniżej 8 minut nie ma sensu startować nowej sesji (login + kilka
  # produktów to już kilkadziesiąt sekund, a nie chcemy przeciąć budżetu).
  if [ "$POZOSTALO_MIN" -lt 8 ]; then
    echo "[orkiestracja] Zostało $POZOSTALO_MIN min — za mało na kolejną sesję. Koniec."
    break
  fi

  LOSOWA_MIN=$(( (RANDOM % 6) + 10 ))  # 10-15
  # Nie przekraczaj budżetu: zostaw min. 1 minutę zapasu na zamknięcie sesji.
  if [ "$LOSOWA_MIN" -gt $(( POZOSTALO_MIN - 1 )) ]; then
    LOSOWA_MIN=$(( POZOSTALO_MIN - 1 ))
  fi

  echo ""
  echo "======================================================================"
  echo "[orkiestracja] Sesja $SESJA: $LOSOWA_MIN min (pozostało w budżecie: $POZOSTALO_MIN min)."
  echo "======================================================================"
  node scrape-etykiety-mws.js 100000 --minuty="$LOSOWA_MIN"
  KOD=$?
  if [ $KOD -ne 0 ]; then
    echo "[orkiestracja] Sesja $SESJA zakończona błędem (kod $KOD) — próbuję kontynuować kolejną sesją."
  fi

  SESJA=$((SESJA + 1))
  NOW=$(date +%s)
  if [ "$NOW" -ge "$END" ]; then
    echo "[orkiestracja] Budżet czasu wyczerpany. Koniec."
    break
  fi

  PRZERWA_S=$(( (RANDOM % 61) + 60 ))  # 60-120s
  POZOSTALO_S=$(( END - NOW ))
  if [ "$PRZERWA_S" -ge "$POZOSTALO_S" ]; then
    echo "[orkiestracja] Zostało za mało czasu na przerwę + kolejną sesję. Koniec."
    break
  fi
  echo "[orkiestracja] Przerwa: $PRZERWA_S s."
  sleep "$PRZERWA_S"
done

echo ""
echo "[orkiestracja] KONIEC. Wykonano $((SESJA - 1)) sesji."
