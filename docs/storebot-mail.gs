// Google Apps Script: mail od userscriptu savpol-storebot.user.js (zamówienia bota Google w ERP).
// Wdrożenie: script.google.com → Nowy projekt → wklej → Wdróż → Nowe wdrożenie → Aplikacja internetowa,
// „Wykonaj jako: Ja”, „Kto ma dostęp: Każdy” → skopiuj adres URL aplikacji.
// Adres wpisuje się w ERP z konsoli: savpolStoreBotPowiadomienia('<adres>'), test: savpolStoreBotTest().
// Adres zostaje tylko w Tampermonkey (repo jest publiczne).

const ODBIORCA = 'l.dutkiewicz@savpol.pl';

function doPost(e) {
  const tresc = String(e && e.postData && e.postData.contents || '');
  // Przypadkowe wywołania (bez znanego nagłówka) ignorujemy.
  if (!/bota Google|StoreBot/.test(tresc)) return ContentService.createTextOutput('pominięto');
  const [temat, ...reszta] = tresc.split('\n');
  MailApp.sendEmail(ODBIORCA, 'ERP: ' + temat.slice(0, 120), reszta.join('\n') || temat);
  return ContentService.createTextOutput('ok');
}
