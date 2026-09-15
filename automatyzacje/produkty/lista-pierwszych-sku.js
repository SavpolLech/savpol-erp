// Jednorazowa pomoc: loguje się do ERP, otwiera katalog (bez filtrowania) i
// wypisuje pierwsze N SKU widocznych w siatce — do testowego zescrapowania
// paczki produktów bez potrzeby wcześniejszego wskazywania konkretnych SKU.
//
// Uruchomienie: node lista-pierwszych-sku.js [N]  (domyślnie 10)

const path = require('path');
function req(name) {
  try { return require(name); }
  catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); }
}
const { chromium } = req('playwright');
const dotenv = req('dotenv');
const fs = require('fs');
const localEnv = path.join(__dirname, '.env');
dotenv.config({ path: fs.existsSync(localEnv) ? localEnv : path.join(__dirname, '..', '.env') });

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://erp.savpol.pl/';
const CATALOG_URL = process.env.CATALOG_URL || 'https://erp.savpol.pl/pl/katalog/csitems/';

async function main() {
  const n = parseInt(process.argv[2] || '10', 10);
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  await page.goto(ERP_BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[name="username"]', { timeout: 15000 });
  await page.fill('input[name="username"]', process.env.ERP_LOGIN);
  await page.fill('input[name="password"]', process.env.ERP_PASSWORD);
  await page.press('input[name="password"]', 'Enter');
  await page.waitForFunction(() => !location.href.includes('/logowanie/'), { timeout: 20000 });

  await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });
  await page.waitForTimeout(500);

  const skus = await page.evaluate((n) => {
    const cells = Array.from(document.querySelectorAll('td[data-datafield="Item"]'));
    return cells.slice(0, n).map(c => c.getAttribute('title'));
  }, n);

  console.log(skus.join(' '));
  await browser.close();
}

main().catch(err => { console.error('[BŁĄD]', err.message); process.exit(1); });
