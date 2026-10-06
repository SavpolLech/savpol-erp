// WSPÓLNA logika "nadganiania" (catch-up) dla scraperów per typ dokumentu
// (wz/mm/pz/...). Wyciągnięta z wz/dobij-wczoraj.js, żeby nie żyły dwie kopie
// tej samej pętli. Katalog scrapera i prefiks stanu podaje wołający.
//
// CO ROBI: bierze każdy NIEKOMPLETNY dzień z okna wstecz (domyślnie 5 dni,
// od najstarszego do wczoraj) i scrapuje go WPROST do produkcji, powtarzając
// sesję scrape.js aż dzień będzie kompletny wg state/ (pełny dzień często nie
// mieści się w jednej sesji; pusty domyka się w jednej próbie). Zawieszona
// sesja jest ubijana po SESSION_TIMEOUT_MS i ponawiana — pojedynczy crash nie
// kładzie całego biegu.
//
// Dzięki oknu wstecz poniedziałkowy bieg sam dobiera piątek + sobotę +
// niedzielę (sob/nd BYWAJĄ niepuste) i nadrabia każdy przegapiony przebieg
// (self-heal).
//
//   const runCatchup = require('../lib-wspolne/catchup');
//   const wynik = runCatchup({ dir: __dirname, prefix: 'wz', label: 'WZ' });
//
// Stan (kompletność, licznik dokumentów) czytamy przez lib-wspolne/state —
// jedno miejsce, które zna nazewnictwo plików stanu (prefix_<zakres>.json).
//
// Powiadomienia toast są OPCJONALNE (callback onEvent) — lokalnie u Lecha
// podpina je wrapper dobij-wczoraj.js, na serwerze (headless) nikt nie patrzy,
// więc orkiestrator ich nie podaje.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function ymd(d) { return d.toISOString().slice(0, 10); }

// dir:       katalog scrapera (leży w nim scrape.js, state/, .scrape.lock)
// prefix:    prefiks stanu ('wz'/'mm'/'pz') — MUSI zgadzać się z tym, którym
//            scrape.js woła lib-wspolne/state, inaczej nie rozpoznamy kompletności
// label:     etykieta do logów/powiadomień (np. 'WZ')
// onEvent:   opcjonalny (kind, title, message) => void — best-effort, nie blokuje
// Zmienne środowiskowe (z domyślnymi jak w dawnym wz/dobij-wczoraj.js):
//   CATCHUP_WINDOW=5  MAX_ATTEMPTS=6  SESSION_TIMEOUT_MS=4500000 (75 min)
//   <PREFIX>_CATCHUP_WINDOW — okno tylko dla jednego typu (np. SPRZEDAZ_CATCHUP_WINDOW)
module.exports = function runCatchup(opts) {
  const { dir, prefix, label = prefix.toUpperCase(), onEvent } = opts;
  // Cel zapisu. DOMYŚLNIE 'prod' — codzienny orkiestrator ma pisać do produkcji.
  // 'test' (albo dowolna wartość != 'prod') kieruje scrape.js do tabel *_test
  // (np. jednorazowy backfill do weryfikacji). scrape.js: WRITE_TO_PROD = (SCRAPE_TARGET==='prod').
  const target = opts.target || 'prod';
  const targetLabel = target === 'prod' ? 'PRODUKCJA' : `TEST (${target})`;
  const { loadState } = require('./state')(dir, prefix);
  const LOCK = path.join(dir, '.scrape.lock');
  const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '6', 10);
  const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || String(75 * 60 * 1000), 10);
  const WINDOW = parseInt(process.env[prefix.toUpperCase() + '_CATCHUP_WINDOW'] || process.env.CATCHUP_WINDOW || '5', 10);

  // Per-typ MINIMALNY WIEK dnia (w dniach). Dzień młodszy NIE jest scrapowany w
  // biegu automatycznym (oknie) — wejdzie, gdy się zestarzeje. Dla MM = 3
  // (MM_MIN_AGE_DAYS): dokumenty MM bywają wycofywane ze statusu "Do realizacji"
  // do "W rejestracji" i modyfikowane (daty/wartości) zanim zostaną zaksięgowane
  // (~2-3 dni), więc scrapujemy je dopiero po ustabilizowaniu. Domyślnie 0
  // (WZ/PZ bez opóźnienia). Ręczny dobij-dzien (opts.days) IGNORUJE to opóźnienie.
  const MIN_AGE = parseInt(process.env[prefix.toUpperCase() + '_MIN_AGE_DAYS'] || '0', 10);
  if (MIN_AGE > 0 && WINDOW < MIN_AGE + 2) {
    console.warn(`[catchup ${label}] UWAGA: CATCHUP_WINDOW=${WINDOW} za małe dla ${prefix.toUpperCase()}_MIN_AGE_DAYS=${MIN_AGE} ` +
      `(potrzeba >= ${MIN_AGE + 2}). Dni ${label} mogą wypaść z okna zanim staną się eligible — podnieś CATCHUP_WINDOW.`);
  }

  const isComplete = (day) => { try { return !!loadState(day, day).complete; } catch { return false; } };
  const docCount = (day) => { try { return loadState(day, day).processedDocNumbers.length; } catch { return 0; } };
  const clearLock = () => { try { fs.unlinkSync(LOCK); } catch { /* nie ma */ } };
  const emit = (kind, title, message) => { try { if (onEvent) onEvent(kind, title, message); } catch { /* powiadomienie to dodatek */ } };

  // Dni do zrobienia. Domyślnie okno wsteczne (today-WINDOW .. wczoraj), tylko
  // niekompletne. opts.days (jawna lista, np. z ręcznego dobij-dzien.js) nadpisuje
  // okno — bierzemy dokładnie te dni, które są jeszcze niekompletne wg state/
  // (ręczny reset stanu sprawia, że dzień znów jest "niekompletny" i wejdzie).
  const targets = [];
  const explicit = Array.isArray(opts.days) && opts.days.length;
  // PRZEGLĄD (opts.przeglad): każdy podany dzień raz, także kompletny — scraper
  // ponownie czyta listę i dopisuje dokumenty wystawione później z datą wstecz
  // (sprzedaż: przegląd 45 dni, Michał 2026-10-06). Wynik = kod wyjścia.
  if (opts.przeglad) {
    targets.push(...(opts.days || []));
  } else if (explicit) {
    const today = new Date();
    for (const day of opts.days) {
      if (!isComplete(day)) targets.push(day);
      // Ręczny bieg świadomie wymusza dzień — min. wiek go NIE blokuje, ale logujemy.
      if (MIN_AGE > 0) {
        const ageDays = Math.round((today - new Date(day + 'T00:00:00Z')) / 86400000);
        if (ageDays < MIN_AGE) console.log(`[catchup ${label}] Ręczny bieg: wymuszono dzień ${day} młodszy niż MIN_AGE=${MIN_AGE} (wiek ${ageDays} dni).`);
      }
    }
  } else {
    const today = new Date();
    const tooYoung = [];
    for (let back = WINDOW; back >= 1; back--) {
      const d = new Date(today);
      d.setDate(d.getDate() - back);
      const day = ymd(d);
      if (back < MIN_AGE) { tooYoung.push(day); continue; } // za świeży — wejdzie, gdy się zestarzeje
      if (!isComplete(day)) targets.push(day);
    }
    if (tooYoung.length) {
      console.log(`[catchup ${label}] Pomijam ${tooYoung.length} dni młodszych niż MIN_AGE=${MIN_AGE} ` +
        `(wejdą w kolejnych biegach): ${tooYoung.join(', ')}`);
    }
  }

  const zakresOpis = explicit
    ? `zakres ${opts.days[0]}..${opts.days[opts.days.length - 1]} (${opts.days.length} dni)`
    : `okno ${WINDOW} dni`;
  console.log(`[catchup ${label}] ${new Date().toISOString()} ${zakresOpis} -> ${targetLabel}. ` +
    `Do zrobienia: ${targets.join(', ') || '(nic — wszystko kompletne)'}`);
  emit('start', `${label} scrape — start`, targets.length
    ? `Dobijam (${targetLabel}): ${targets.join(', ')}`
    : 'Nic do zrobienia — wszystko kompletne.');

  const done = [];
  const failed = [];
  // KONIEC_TS (ms, ustawia orkiestrator z DO_GODZINY): po tej chwili nie
  // zaczynamy nowej próby ani nowego dnia — bieg kończy się sam, a reszta
  // zostaje na następny raz (stan per dzień jest zachowany).
  const KONIEC = parseInt(process.env.KONIEC_TS || '0', 10);
  const poCzasie = () => KONIEC > 0 && Date.now() >= KONIEC;
  for (const day of targets) {
    if (poCzasie()) {
      console.log(`[catchup ${label}] Minęła godzina końca — ${day} i dalsze dni zostają na następny bieg.`);
      break;
    }
    const env = {
      ...process.env,
      FILTER_DATE: day,
      SCRAPE_TARGET: target,
      HEADLESS: 'true',
      ALLOW_WEEKEND: 'true',         // dzień z weekendu bywa niepusty
      IGNORE_BUSINESS_HOURS: 'true', // job "musi domknąć" niezależnie od pory
      // Wołający (orkiestrator, dobij-dzien) trzyma globalny lock ERP — scrapery,
      // które same go biorą (kontrahenci/, sprzedaz/), nie mogą go drugi raz zająć.
      SCRAPERY_LOCK_RODZIC: '1'
    };
    if (opts.przeglad) {
      if (poCzasie()) { failed.push(day); continue; }
      clearLock();
      console.log(`[catchup ${label}] przegląd ${day} @ ${new Date().toLocaleTimeString()}`);
      const r = spawnSync('node', ['scrape.js'], {
        cwd: dir, env: { ...env, PRZEGLAD: '1' }, stdio: 'inherit', timeout: SESSION_TIMEOUT_MS, killSignal: 'SIGKILL'
      });
      clearLock();
      (r.status === 0 ? done : failed).push(day);
      continue;
    }
    for (let a = 1; a <= MAX_ATTEMPTS && !isComplete(day) && !poCzasie(); a++) {
      clearLock();
      console.log(`[catchup ${label}] ${day} próba ${a}/${MAX_ATTEMPTS} @ ${new Date().toLocaleTimeString()}`);
      const r = spawnSync('node', ['scrape.js'], {
        cwd: dir, env, stdio: 'inherit', timeout: SESSION_TIMEOUT_MS, killSignal: 'SIGKILL'
      });
      clearLock();
      const timedOut = r.error && r.error.code === 'ETIMEDOUT';
      const crashed = timedOut || (r.status !== 0);
      if (crashed && !isComplete(day) && a < MAX_ATTEMPTS) {
        const why = timedOut ? `przekroczono limit ${Math.round(SESSION_TIMEOUT_MS / 60000)} min` : 'sesja padła';
        console.warn(`[catchup ${label}] ${day} próba ${a}: ${why} — wznawiam.`);
        emit('restart', `${label} — restart po błędzie`, `${day}: ${why}, wznawiam (próba ${a + 1}/${MAX_ATTEMPTS}). Zebrane: ${docCount(day)}.`);
      }
    }
    if (isComplete(day)) {
      console.log(`[catchup ${label}] ${day} KOMPLET.`);
      done.push(day);
      emit('day-ok', `${label} — dzień gotowy`, `${day}: ${docCount(day)} dok. -> ${targetLabel}.`);
    } else if (poCzasie()) {
      console.log(`[catchup ${label}] ${day} przerwany godziną końca (${docCount(day)} dok.) — dokończy następny bieg.`);
      failed.push(day);
    } else {
      console.warn(`[catchup ${label}] UWAGA: ${day} nie domknięty po ${MAX_ATTEMPTS} próbach — kolejny bieg dokończy ze stanu.`);
      failed.push(day);
      emit('day-fail', `${label} — dzień NIEdomknięty`, `${day}: ${docCount(day)} dok., nie ukończono po ${MAX_ATTEMPTS} próbach. Dokończy następny bieg.`);
    }
  }
  if (targets.length) {
    const parts = [];
    if (done.length) parts.push(`OK: ${done.join(', ')}`);
    if (failed.length) parts.push(`nieukończone: ${failed.join(', ')}`);
    emit('end', `${label} scrape — koniec`, parts.join(' | ') || 'brak zmian');
  }
  return { targets, done, failed };
};
