// Jednorazowe: pokazuje przykładowy numer WZ z danego dnia, którego NIE MA
// w naszym state/ (czyli doszedł do ERP już PO tym, jak scrapowaliśmy ten
// dzień — dowód na dopisywanie dokumentów z datą wsteczną).
//
// Uruchomienie: node find-new-doc-example.js 2026-08-03

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
function acquireLock() {
  if (fs.existsSync(LOCK_PATH) && (Date.now() - fs.statSync(LOCK_PATH).mtimeMs) < 60 * 60 * 1000) {
    throw new Error('Inna sesja już trwa.');
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}
function releaseLock() { try { fs.unlinkSync(LOCK_PATH); } catch (e) {} }

async function login(page) {
  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(LOGIN_SELECTORS.username, { timeout: 15000 });
  await page.fill(LOGIN_SELECTORS.username, process.env.ERP_LOGIN);
  await page.fill(LOGIN_SELECTORS.password, process.env.ERP_PASSWORD);
  await page.press(LOGIN_SELECTORS.password, 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 20000 });
}

async function humanClickDelay(page) { await page.waitForTimeout(300 + Math.random() * 500); }

async function setDocTypeFilter(page, label) {
  await humanClickDelay(page);
  await page.locator('.csButtonAdvancedFilter:visible').first().click();
  await humanClickDelay(page);
  await page.locator('.FilterList.FilterListPopupCombo:visible, .FilterList:visible').first().click();
  await humanClickDelay(page);
  await page.locator('li.k-item:visible', { hasText: label }).first().click();
  await humanClickDelay(page);
  await page.locator('.caption[title="Zastosuj"]:visible').first().click();
  await page.waitForTimeout(1000);
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
  await page.locator('.ButtonRefresh:visible').first().click();
  await page.waitForTimeout(1200);
}

async function main() {
  const date = process.argv[2];
  if (!date) throw new Error('Podaj datę: node find-new-doc-example.js 2026-08-03');

  const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'state', 'wz_' + date + '_' + date + '.json'), 'utf8'));
  const known = new Set(state.processedDocNumbers);
  console.log('[find] Znamy ' + known.size + ' dokumentów z ' + date + ' ze scrapowania.');

  acquireLock();
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await (await browser.newContext()).newPage();
  try {
    await login(page);
    await page.goto(WZ_LIST_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('td[data-datafield="DocNumber"]', { timeout: 30000 });
    await setDocTypeFilter(page, 'WZ');
    await setDateFilter(page, date);

    const readRows = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('td[data-datafield="DocNumber"]')).map(td => td.getAttribute('title'))
    );

    let found = null;
    let pageNum = 1;
    const seen = new Set();
    while (pageNum <= 60) {
      const rows = await readRows();
      rows.forEach(r => r && seen.add(r));
      found = rows.find(r => r && !known.has(r));
      if (found) break;

      const pager = await page.evaluate(() => {
        const p = Array.from(document.querySelectorAll('.csDataPager')).find(el => el.offsetParent !== null);
        if (!p) return null;
        const next = p.querySelector('.NextPageButton');
        return next && !next.className.split(/\s+/).includes('inactive');
      });
      if (!pager) break;

      const before = rows.join('|');
      await page.locator('.csDataPager:visible .NextPageButton').first().click();
      await page.waitForFunction((b) => {
        const now = Array.from(document.querySelectorAll('td[data-datafield="DocNumber"]')).map(td => td.getAttribute('title')).join('|');
        return now !== b;
      }, before, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400 + Math.random() * 400);
      pageNum++;
    }

    console.log('[find] Przejrzano ' + pageNum + ' stron, ' + seen.size + ' unikalnych numerów widzianych.');
    if (found) {
      console.log('[find] PRZYKŁAD nowego dokumentu (jest w ERP teraz, nie ma go w naszym state z ' + date + '):');
      console.log('   DocNumber: ' + found);
    } else {
      console.log('[find] Nie znaleziono — wszystkie przejrzane numery już znamy (ale mogło być więcej stron niż limit).');
    }
  } finally {
    await browser.close();
    releaseLock();
  }
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
