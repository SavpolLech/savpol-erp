// WSPÓLNE powiadomienie o ROZBIEŻNOŚCIACH ERP↔worek dla scraperów (wz/mm/pz).
//
// Kontekst (decyzja Lecha 2026-09-30): do worka TYLKO dopisujemy — nigdy nie
// zmieniamy istniejących rekordów. Gdy scrape pokaże, że dane w ERP różnią się
// od tego, co już jest w bazie, rozbieżność jest ZGŁASZANA (baza nie jest
// ruszana). Zgłoszenie idzie trzema kanałami, wszystkie best-effort:
//
//   1. PLIK w repo: automatyzacje/ROZBIEZNOSCI.md — dopisywana sekcja z listą
//      checkboxów; commit + push tym samym mechanizmem co logi (git-log-push).
//   2. TOAST Windows — tylko lokalnie (TOAST=true; serwer headless pomija).
//   3. GITHUB ISSUE w SavpolLech/savpol-erp — przez REST (wbudowany fetch);
//      token WYŁĄCZNIE z .env (GITHUB_TOKEN). Bez tokenu: grzecznie pominięte.
//
// Funkcja NIGDY nie rzuca wyjątku dalej — powiadomienie to dodatek, nie może
// wywalić scrapowania, które już się udało.
//
// Użycie (z scrape.js danego typu, sygnatura BEZ zmian):
//   const powiadom = require('../lib-wspolne/powiadom');
//   await powiadom('mm', rozbieznosci, { label: '2026-09-29..2026-09-29' });
// gdzie rozbieznosci = [{ docNumber, csDocsHeadersId,
//   zmianyNaglowka:[{pole,baza,erp}],
//   pozycjeBaza, pozycjeErp,               // opcjonalnie: liczności pozycji
//   zmianyPozycji:[{id,pole,baza,erp}]     // pole=null => cała pozycja; baza=null => nowa w ERP; erp=null => brak w ERP
// }]

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pushFile } = require('./git-log-push');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PLIK_ABS = path.join(REPO_ROOT, 'automatyzacje', 'ROZBIEZNOSCI.md');
const PLIK_REL = 'automatyzacje/ROZBIEZNOSCI.md';
const TOAST_SCRIPT = path.join(__dirname, '..', 'wz', 'toast.ps1');
const REPO = 'SavpolLech/savpol-erp';

function opiszZmianePozycji(z) {
  if (z.pole) return 'pozycja ' + z.id + ' — ' + z.pole + ': ' + z.baza + ' -> ' + z.erp;
  if (z.erp === null) return 'pozycja ' + z.id + ' — brak w ERP';
  return 'pozycja ' + z.id + ' — nowa w ERP';
}

// Jedna linia-checkbox na KAŻDĄ różnicę (można odhaczać pojedynczo w Markdown/issue).
function checkboxy(rozbieznosci) {
  const linie = [];
  for (const r of rozbieznosci) {
    const kto = (r.docNumber || r.csDocsHeadersId || '(?)') +
      (r.csDocsHeadersId && r.docNumber ? ' (id=' + r.csDocsHeadersId + ')' : '');
    if (r.zmianyNaglowka && r.zmianyNaglowka.length) {
      for (const z of r.zmianyNaglowka) {
        linie.push('- [ ] ' + kto + ': ' + z.pole + ': ' + z.baza + ' -> ' + z.erp);
      }
    }
    if (typeof r.pozycjeBaza === 'number' && typeof r.pozycjeErp === 'number' && r.pozycjeBaza !== r.pozycjeErp) {
      linie.push('- [ ] ' + kto + ': liczba pozycji: ' + r.pozycjeBaza + ' -> ' + r.pozycjeErp);
    }
    if (r.zmianyPozycji && r.zmianyPozycji.length) {
      for (const z of r.zmianyPozycji) linie.push('- [ ] ' + kto + ': ' + opiszZmianePozycji(z));
    }
    if (!(r.zmianyNaglowka && r.zmianyNaglowka.length) && !(r.zmianyPozycji && r.zmianyPozycji.length) &&
        !(typeof r.pozycjeBaza === 'number' && typeof r.pozycjeErp === 'number' && r.pozycjeBaza !== r.pozycjeErp)) {
      linie.push('- [ ] ' + kto + ': (rozbieżność bez szczegółów)');
    }
  }
  return linie;
}

// --- Kanał 1: plik w repo ---
function zapiszDoPliku(typ, label, liczbaDok, linie, nagID) {
  try {
    const naglowek = '## ' + nagID + ' · ' + String(typ).toUpperCase() +
      (label ? ' · ' + label : '') + ' · ' + liczbaDok + ' dok.';
    const sekcja = '\n' + naglowek + '\n\n' + linie.join('\n') + '\n';
    if (!fs.existsSync(PLIK_ABS)) {
      fs.writeFileSync(PLIK_ABS,
        '# Rozbieżności ERP↔worek\n\n' +
        'Dokumenty, których dane w ERP różnią się od tego, co JUŻ jest w bazie ' +
        '(worek). Baza NIE jest zmieniana — do worka tylko dopisujemy. To lista ' +
        'do ręcznego przejrzenia; odhacz pozycję, gdy ją obsłużysz.\n', 'utf8');
    }
    fs.appendFileSync(PLIK_ABS, sekcja, 'utf8');
    pushFile(PLIK_REL, 'Rozbieżności ERP↔worek: ' + String(typ).toUpperCase() +
      (label ? ' ' + label : '') + ' (' + liczbaDok + ' dok.)');
    return true;
  } catch (err) {
    console.warn('[powiadom] UWAGA: nie zapisano ROZBIEZNOSCI.md (' + (err && err.message) + ').');
    return false;
  }
}

// --- Kanał 2: toast (tylko lokalnie) ---
function toast(typ, liczbaDok) {
  if (process.env.TOAST !== 'true') return;
  try {
    spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOAST_SCRIPT,
      'Rozbieżności ERP↔worek: ' + String(typ).toUpperCase() + ' ' + liczbaDok + ' dok.',
      'Zobacz automatyzacje/ROZBIEZNOSCI.md'], { timeout: 20000 });
  } catch { /* toast to dodatek */ }
}

// --- Kanał 3: GitHub issue (token tylko z .env) ---
async function githubIssue(typ, label, liczbaDok, linie) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[powiadom] GitHub issue pominięte — brak GITHUB_TOKEN w .env. ' +
      'Rozbieżności są w ROZBIEZNOSCI.md i logu.');
    return false;
  }
  if (typeof fetch !== 'function') {
    console.warn('[powiadom] GitHub issue pominięte — brak globalnego fetch (Node < 18).');
    return false;
  }
  try {
    const title = 'Rozbieżności ERP↔worek: ' + String(typ).toUpperCase() +
      (label ? ' ' + label : '') + ' (' + liczbaDok + ' dok.)';
    const body = 'Dane w ERP różnią się od tego, co jest w bazie (worek). Baza NIE ' +
      'została zmieniona — to zgłoszenie do przejrzenia.\n\nFormat: `pole: wartość_w_bazie -> ' +
      'wartość_w_ERP`.\n\n' + linie.join('\n') + '\n';
    const res = await fetch('https://api.github.com/repos/' + REPO + '/issues', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'savpol-erp-scraper',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body, labels: ['rozbieznosci-erp'] })
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log('[powiadom] GitHub issue utworzone: ' + (data.html_url || '(?)'));
      return true;
    }
    const txt = await res.text().catch(() => '');
    console.warn('[powiadom] GitHub issue nieutworzone (HTTP ' + res.status + '): ' + txt.slice(0, 300));
    return false;
  } catch (err) {
    console.warn('[powiadom] GitHub issue — błąd (' + (err && err.message) + '). Bieg kontynuowany.');
    return false;
  }
}

module.exports = async function powiadomORozbieznosciach(scraper, rozbieznosci, opts = {}) {
  try {
    if (!rozbieznosci || !rozbieznosci.length) return { ok: true, reason: 'brak rozbieżności' };

    const label = opts.label || '';
    const liczbaDok = rozbieznosci.length;
    const linie = checkboxy(rozbieznosci);
    const nagID = new Date().toISOString();

    console.log('[powiadom] ' + liczbaDok + ' dok. z rozbieżnościami ERP↔worek (' +
      String(scraper).toUpperCase() + (label ? ' ' + label : '') + ') — zgłaszam.');

    const plik = zapiszDoPliku(scraper, label, liczbaDok, linie, nagID);
    toast(scraper, liczbaDok);
    const issue = await githubIssue(scraper, label, liczbaDok, linie);

    return { ok: true, plik, issue };
  } catch (err) {
    console.warn('[powiadom] UWAGA: zgłoszenie rozbieżności nie powiodło się (' +
      (err && err.message) + '). Bieg kontynuowany — dane scrapowania są bezpieczne.');
    return { ok: false, reason: err && err.message };
  }
};
