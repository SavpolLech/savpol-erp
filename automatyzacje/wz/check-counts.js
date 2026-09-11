// Sprawdza, dla KAŻDEGO dnia, który już mamy w state/, czy liczba dokumentów
// zgłaszana teraz przez ERP zgadza się z tym, co zapisaliśmy przy scrapowaniu.
// NIE otwiera żadnego dokumentu — tylko loguje się raz i czyta licznik
// pagera dla każdej daty. Szybkie, minimalny ruch wobec ERP.
//
// PO CO: podejrzenie, że ERP pozwala dopisywać dokumenty z datą wsteczną
// (WZ wystawiony dziś z DocDate sprzed tygodni) — to sprawdza, czy to
// systemowe zjawisko, czy jednorazowa anomalia na jednym dniu.
//
// Uruchomienie: node check-counts.js

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HEADLESS = process.env.HEADLESS === 'true';
const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const WZ_LIST_URL = process.env.WZ_LIST_URL ||
  'https://erp.savpol.pl/pl/wydania-zewnetrzne/csdocsheaders4goodsissue';
const LOGIN_SELECTORS = { username: 'input[name="username"]', password: 'input[name="password"]' };

const LOCK_PATH = path.join(__dirname, '.scrape.lock');
const LOCK_MAX_AGE_MS = 60 * 60 * 1000;

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < LOCK_MAX_AGE_MS) {
      throw new Error('Inna sesja (scraper albo ten skrypt) już trwa (blokada z ' + Math.round(age / 1000) + 's temu) — kończę bez startu.');
    }
    console.warn('[lock] Stara blokada — nadpisuję.');
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (e) { /* już nie ma */ }
}

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });
  const user = process.env.ERP_LOGIN;
  const pass = process.env.ERP_PASSWORD;
  if (!user || !pass) throw new Error('Brak ERP_LOGIN / ERP_PASSWORD w .env');
  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, user);
  await page.fill(LOGIN_SELECTORS.password, pass);
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 20000 });
  console.log('[login] Zalogowano.');
}

async function humanClickDelay(page) {
  await page.waitForTimeout(300 + Math.random() * 500);
}

async function readPagerCount(page) {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
    const e = p && p.querySelector('.ResultsCountValue');
    return e ? (e.value || e.textContent || '').trim() : null;
  });
}

async function readPagerCountStable(page, { tries = 15, intervalMs = 400 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const now = await readPagerCount(page);
    if (now && now !== '0' && now === last) return now;
    last = now;
    await page.waitForTimeout(intervalMs);
  }
  return last;
}

async function setDocTypeFilter(page, label) {
  await humanClickDelay(page);
  const advFilterBtn = page.locator('.csButtonAdvancedFilter:visible').first();
  await advFilterBtn.waitFor({ timeout: 10000 });
  await advFilterBtn.click();

  await humanClickDelay(page);
  const dropdown = page.locator('.FilterList.FilterListPopupCombo:visible, .FilterList:visible').first();
  await dropdown.waitFor({ timeout: 10000 });
  await dropdown.click();

  await humanClickDelay(page);
  const option = page.locator('li.k-item:visible', { hasText: label }).first();
  await option.waitFor({ timeout: 10000 });
  await option.click();

  await humanClickDelay(page);
  const applyBtn = page.locator('.caption[title="Zastosuj"]:visible').first();
  await applyBtn.waitFor({ timeout: 10000 });
  await applyBtn.click();
  await page.waitForTimeout(1000);
  console.log('[filtr-typ] Zastosowano zapisany filtr "' + label + '".');
}

async function setDateFilter(page, isoDate) {
  async function typeInto(placeholder, text) {
    const locator = page.locator('input[placeholder="' + placeholder + '"]');
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    await locator.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text, { delay: 20 + Math.random() * 30 });
    await page.keyboard.press('Tab');
  }
  await typeInto('Od', isoDate);
  await humanClickDelay(page);
  await typeInto('Do', isoDate);
  await humanClickDelay(page);

  const refreshBtn = page.locator('.ButtonRefresh:visible').first();
  await refreshBtn.waitFor({ timeout: 10000 });
  await refreshBtn.click();
  await page.waitForTimeout(800);
}

async function main() {
  acquireLock();
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => console.error('[błąd strony]', err.message));

  const results = [];
  try {
    await login(page);
    await page.goto(WZ_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });
    await setDocTypeFilter(page, 'WZ');

    const stateDir = path.join(__dirname, 'state');
    const dates = fs.readdirSync(stateDir)
      .filter(f => /^wz_(\d{4}-\d{2}-\d{2})_\1\.json$/.test(f))
      .map(f => f.match(/^wz_(\d{4}-\d{2}-\d{2})_/)[1])
      .sort();

    console.log('[check] Sprawdzam ' + dates.length + ' dni: ' + dates.join(', '));

    for (const date of dates) {
      const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'wz_' + date + '_' + date + '.json'), 'utf8'));
      const mamy = state.processedDocNumbers.length;

      await setDateFilter(page, date);
      const erpRaw = await readPagerCountStable(page);
      const erp = erpRaw ? parseInt(erpRaw.replace(/[\s ]/g, ''), 10) : null;

      const roznica = erp !== null ? erp - mamy : null;
      results.push({ date, mamy, erp, roznica });
      console.log('[check] ' + date + ': mamy=' + mamy + ', ERP teraz=' + erp +
        (roznica ? ' (różnica: ' + (roznica > 0 ? '+' : '') + roznica + ')' : ' (zgadza się)'));

      await humanClickDelay(page);
    }
  } finally {
    await browser.close();
    releaseLock();
  }

  console.log('\n[check] === PODSUMOWANIE ===');
  const zRoznica = results.filter(r => r.roznica);
  if (!zRoznica.length) {
    console.log('Wszystkie dni zgadzają się z ERP.');
  } else {
    console.log(zRoznica.length + ' dni z różnicą:');
    zRoznica.forEach(r => console.log('  ' + r.date + ': ' + (r.roznica > 0 ? '+' : '') + r.roznica));
  }
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
