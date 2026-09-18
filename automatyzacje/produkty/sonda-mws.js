const path = require('path');
const fs = require('fs');
function req(name) { try { return require(name); } catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); } }
const { chromium } = req('playwright');
const dotenv = req('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const { login, CATALOG_URL, decodeJsonResult, extractCardRecord, openProductCardInPage } = require('./scrape');

async function main() {
  const sku = process.argv[2] || '0006456';
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const captured = [];
  page.on('response', async (resp) => {
    try {
      if (resp.request().method() !== 'POST') return;
      const body = await resp.text();
      if (!body || body.indexOf('JSONResult') === -1) return;
      const decoded = decodeJsonResult(body);
      if (!decoded) return;
      const rec = extractCardRecord(decoded);
      if (rec && rec.records.length) captured.push(rec);
    } catch (e) {}
  });

  await login(page);
  await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('td[data-datafield="Item"]', { timeout: 30000 });

  const wynik = await page.evaluate(openProductCardInPage, { sku });
  console.log('otwarcie karty:', JSON.stringify(wynik));
  await page.waitForTimeout(2000);

  const zakladki = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('li.k-item[title]'))
      .filter(li => li.offsetParent !== null)
      .map(li => li.getAttribute('title'));
  });
  console.log('ZAKLADKI WIDOCZNE NA KARCIE:', JSON.stringify(zakladki));

  const kliknieto = await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('li[title]')).find(li =>
      li.offsetParent !== null && /mws/i.test(li.getAttribute('title') || ''));
    if (!tab) return null;
    const title = tab.getAttribute('title');
    tab.click();
    return title;
  });
  console.log('kliknieto zakladke:', kliknieto);
  await page.waitForTimeout(2000);

  console.log('--- WSZYSTKIE PRZECHWYCONE ZESTAWY ---');
  captured.forEach((c, i) => {
    console.log(i, c.dataSetIdent, 'pol=' + c.fieldNames.length, 'wierszy=' + c.records.length,
      'ma StorageLocationType=' + c.fieldNames.includes('StorageLocationType'));
    const rec = c.records.find(r => String(r.Item) === sku);
    if (rec && 'StorageLocationType' in rec) console.log('   StorageLocationType =', rec.StorageLocationType, ' Desc_PL=', rec.StorageLocationTypeDesc_PL);
  });

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
