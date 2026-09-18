// Pobiera i parsuje feed Google Merchant Center (produkcyjny, eksportowany
// przez ERP pod stały adres) — jedno źródło prawdy o tym, które SKU (a
// właściwe: które csItemsId, bo tyle ma pole <g:id>) w ogóle idą do GMC.
//
// Feed NIE ma SKU, tylko <g:id> (= csItemsId, ten sam numer co w adresie
// produktu na esavpol.pl i w kolumnie ukrytej "Identyfikator wew." w
// katalogu ERP — patrz docs/dane-z-erp.md) i <g:mpn> (EAN kartoteki).
// Dlatego produkty szukamy w ERP PO EAN, nie po SKU — katalog ERP obsługuje
// wyszukiwanie po EAN tak samo jak savpol-historia-faktur.user.js
// (EAN_TOOL), tylko że tu logika dopasowania wiersza jest przeniesiona do
// Playwrighta (patrz scrape-etykiety-mws.js, pickRowByEanInPage).
//
// Płaski regex zamiast parsera XML — feed ma jeden poziom <item>...</item>
// bez zagnieżdżeń, więc parser byłby przerostem formy nad treścią.

const https = require('https');

const FEED_URL = 'https://esavpol.pl/download4External/GoogleFeedFiles/NG_GoogleMerchantCenterFeedFile_213217693_1234896834.xml';

function pobierzFeedXml(url) {
  return new Promise((resolve, reject) => {
    https.get(url || FEED_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('Feed GMC: HTTP ' + res.statusCode));
        res.resume();
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function wyciagnijPole(blok, tag) {
  const m = blok.match(new RegExp('<g:' + tag + '>([\\s\\S]*?)</g:' + tag + '>'));
  return m ? decodeXmlEntities(m[1].trim()) : null;
}

// Zwraca [{ id, ean, title, productType, availability }, ...] — jeden wpis
// na <item>. Pomija pozycje bez <g:id> albo bez <g:mpn> (EAN) — bez EAN-u
// nie mamy jak ich znaleźć w katalogu ERP.
function sparsujFeed(xml) {
  const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/g) || [];
  const wynik = [];
  let bezMpn = 0;
  for (const blok of items) {
    const id = wyciagnijPole(blok, 'id');
    const ean = wyciagnijPole(blok, 'mpn');
    if (!id) continue;
    if (!ean) { bezMpn++; continue; }
    wynik.push({
      id,
      ean,
      title: wyciagnijPole(blok, 'title'),
      productType: wyciagnijPole(blok, 'product_type'),
      availability: wyciagnijPole(blok, 'availability')
    });
  }
  return { wpisy: wynik, lacznieWFeedzie: items.length, bezMpn };
}

async function pobierzListeGmc(url) {
  const xml = await pobierzFeedXml(url);
  return sparsujFeed(xml);
}

module.exports = { FEED_URL, pobierzFeedXml, sparsujFeed, pobierzListeGmc };
