// WSPÓLNE powiadomienie o ROZBIEŻNOŚCIACH ERP↔worek dla scraperów (wz/mm/pz).
//
// Kontekst (decyzja Lecha 2026-09-30): do worka TYLKO dopisujemy — nigdy nie
// zmieniamy istniejących rekordów. Gdy scrape pokaże, że dane w ERP różnią się
// od tego, co już jest w bazie, rozbieżność trafia do logu + run-log.jsonl, a
// dodatkowo (jeśli skonfigurowano) idzie ZBIORCZY mail (jeden na bieg) na adres
// z POWIADOM_TO (domyślnie l.dutkiewicz@savpol.pl).
//
// BEZPIECZEŃSTWO/ZASADY:
//   - Dane SMTP WYŁĄCZNIE z .env (repo jest de facto publiczne — nigdy nie
//     commituj sekretów). Wymagane: SMTP_HOST, SMTP_USER, SMTP_PASS. Opcjonalne:
//     SMTP_PORT (587), SMTP_SECURE (true=465), SMTP_FROM (domyślnie SMTP_USER),
//     POWIADOM_TO (domyślnie l.dutkiewicz@savpol.pl).
//   - Bez kompletu SMTP w .env: NIE wysyła, tylko loguje, że mail pominięto.
//   - nodemailer jest doładowywany leniwie; jeśli go nie ma w node_modules,
//     logujemy i pomijamy (bez wywalania biegu).
//   - Funkcja NIGDY nie rzuca wyjątku dalej — powiadomienie to dodatek, nie może
//     wywalić scrapowania, które już się udało.
//
// Użycie (z scrape.js danego typu):
//   const powiadom = require('../lib-wspolne/powiadom');
//   await powiadom('mm', rozbieznosci, { label: '2026-09-29..2026-09-29' });
// gdzie rozbieznosci = [{ docNumber, csDocsHeadersId,
//   zmianyNaglowka:[{pole,baza,erp}],
//   zmianyPozycji:[{id,pole,baza,erp}]  // pole=null => cała pozycja; baza=null => nowa w ERP, erp=null => brak w ERP
// }]

function opiszZmianePozycji(z) {
  if (z.pole) return '    · pozycja ' + z.id + ' — ' + z.pole + ': ' + z.baza + ' -> ' + z.erp;
  if (z.erp === null) return '    · pozycja ' + z.id + ' — brak w ERP';
  return '    · pozycja ' + z.id + ' — nowa w ERP';
}

function opiszRozbieznosc(r) {
  const linie = ['- ' + (r.docNumber || r.csDocsHeadersId || '(?)') + ':'];
  if (r.zmianyNaglowka && r.zmianyNaglowka.length) {
    linie.push('  nagłówek: ' + r.zmianyNaglowka.map(z => z.pole + ': ' + z.baza + ' -> ' + z.erp).join('; '));
  }
  if (r.zmianyPozycji && r.zmianyPozycji.length) {
    linie.push('  pozycje:');
    r.zmianyPozycji.forEach(z => linie.push(opiszZmianePozycji(z)));
  }
  return linie.join('\n');
}

module.exports = async function powiadomORozbieznosciach(scraper, rozbieznosci, opts = {}) {
  try {
    if (!rozbieznosci || !rozbieznosci.length) return { sent: false, reason: 'brak rozbieżności' };

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE } = process.env;
    const to = process.env.POWIADOM_TO || 'l.dutkiewicz@savpol.pl';

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      console.log('[powiadom] ' + rozbieznosci.length + ' rozbieżności ERP↔worek — mail POMINIĘTY ' +
        '(brak SMTP_HOST/SMTP_USER/SMTP_PASS w .env). Szczegóły są w logu i run-log.jsonl.');
      return { sent: false, reason: 'brak konfiguracji SMTP' };
    }

    // nodemailer leniwie. Ten plik leży w lib-wspolne (bez własnego node_modules),
    // więc gdy zwykły require zawiedzie, próbujemy z node_modules katalogu, z
    // którego uruchomiono scrape.js (cwd = automatyzacje/<typ>). Dodaj nodemailer
    // do package.json danego typu, gdy Lech poda SMTP.
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch (e1) {
      try {
        nodemailer = require(require('path').resolve(process.cwd(), 'node_modules', 'nodemailer'));
      } catch (e2) {
        console.warn('[powiadom] SMTP skonfigurowany, ale brak modułu "nodemailer" (npm i nodemailer w katalogu typu). ' +
          'Mail pominięty; ' + rozbieznosci.length + ' rozbieżności jest w logu/run-log.jsonl.');
        return { sent: false, reason: 'brak nodemailer' };
      }
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587', 10),
      secure: SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const naglowek = '[' + String(scraper).toUpperCase() + '] Rozbieżności ERP↔worek: ' +
      rozbieznosci.length + ' dok.' + (opts.label ? ' (' + opts.label + ')' : '');
    const tresc = [
      'Wykryto rozbieżności między ERP a bazą (worek). Rekordy w bazie NIE zostały zmienione —',
      'to tylko zgłoszenie (do worka dopisujemy, nie modyfikujemy istniejących).',
      '',
      'Format: pole: wartość_w_bazie -> wartość_w_ERP.',
      '',
      rozbieznosci.map(opiszRozbieznosc).join('\n')
    ].join('\n');

    await transporter.sendMail({ from: SMTP_FROM || SMTP_USER, to, subject: naglowek, text: tresc });
    console.log('[powiadom] Wysłano zbiorczy mail o ' + rozbieznosci.length + ' rozbieżnościach do ' + to + '.');
    return { sent: true };
  } catch (err) {
    console.warn('[powiadom] UWAGA: nie udało się wysłać maila (' + (err && err.message) + '). ' +
      'Bieg kontynuowany — rozbieżności są w logu/run-log.jsonl.');
    return { sent: false, reason: err && err.message };
  }
};
