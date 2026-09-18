// Sonda: wchodzi na "Grupowania produktów" (csitemsgroups) i przechwytuje
// SUROWĄ odpowiedź API z drzewem kategorii — sprawdzamy, czy cały tree
// (wszystkie poziomy) ładuje się jednym zapytaniem (client-side rendering
// zwiniętych węzłów), czy trzeba klikać każdy węzeł osobno (lazy-load).
const path = require('path');
const fs = require('fs');
function req(name) { try { return require(name); } catch (e) { return require(path.join(__dirname, '..', 'wz', 'node_modules', name)); } }
const { chromium } = req('playwright');
const dotenv = req('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
const { login, decodeJsonResult, extractCardRecord } = require('./scrape');

const GROUPS_URL = 'https://erp.savpol.pl/pl/grupowania-produktow/csitemsgroups/213217693';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const captured = [];
  const surowe = [];
  page.on('response', async (resp) => {
    try {
      if (resp.request().method() !== 'POST') return;
      const url = resp.url();
      const body = await resp.text();
      if (!body) return;
      surowe.push({ url, dlugosc: body.length, tresc: body });
      const decoded = decodeJsonResult(body);
      if (!decoded) return;
      // Zamiast tylko RefreshObjectReturnList[0] (jak extractCardRecord),
      // przejdź WSZYSTKIE wpisy — drzewo kategorii może zwracać kilka
      // zestawów naraz (np. drzewo + panel produktów).
      const list = decoded && decoded.Result && decoded.Result.RefreshObjectReturnList;
      if (Array.isArray(list)) {
        for (const refresh of list) {
          if (!refresh || !refresh.DataTable || !refresh.DataTable.FieldDefs) continue;
          const dt = refresh.DataTable;
          const nazwyPol = dt.FieldDefs.map(f => f.FieldName);
          const wiersze = dt.Records || dt.Rows || dt.Data || dt.records || dt.rows || dt.data || [];
          captured.push({ dataSetIdent: refresh.DataSetIdent || refresh.DataSetSQLIdent || null, fieldNames: nazwyPol, wierszy: wiersze.length, wiersze });
        }
      }
    } catch (e) {}
  });

  await login(page);
  await page.goto(GROUPS_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  console.log('--- surowe odpowiedzi POST (' + surowe.length + ') ---');
  surowe.forEach((s, i) => console.log(i, s.url, 'dlugosc=' + s.dlugosc));

  console.log('--- WSZYSTKIE PRZECHWYCONE ZESTAWY (po samym wejsciu na strone, bez klikania) ---');
  captured.forEach((c, i) => {
    console.log(i, c.dataSetIdent, 'pol=' + c.fieldNames.length, 'wierszy=' + c.wierszy);
  });

  if (!fs.existsSync(path.join(__dirname, 'wynik'))) fs.mkdirSync(path.join(__dirname, 'wynik'));
  fs.writeFileSync(path.join(__dirname, 'wynik', 'sonda-grupy-mws.json'),
    JSON.stringify(captured, null, 2), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'wynik', 'sonda-grupy-mws-surowe.json'),
    JSON.stringify(surowe, null, 2), 'utf8');
  console.log('Zapisano: wynik/sonda-grupy-mws.json i sonda-grupy-mws-surowe.json');

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
