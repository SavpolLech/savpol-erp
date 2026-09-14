// Jednorazowa pomoc: sprawdza, czy kolumny zdjęć w "worek" są faktycznie
// wypełnione danymi, czy są NULL/puste — dla jednego testowego produktu
// (Item = '0000031') i ogólnie w całej tabeli.
//
// Nie czyta samych bajtów (varbinary) do konsoli — tylko DATALENGTH(), żeby
// sprawdzić rozmiar, bez zaśmiecania konsoli binarnym śmieciem.
//
// Uruchomienie: node sprawdz-zdjecia-wypelnienie.js [nazwa_bazy]

require('dotenv').config();
const sql = require('mssql');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD } = process.env;
  const database = process.argv[2] || 'worek';

  const config = {
    server: DB_HOST,
    port: parseInt(DB_PORT || '1433', 10),
    user: DB_USER,
    password: DB_PASSWORD,
    database,
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15000
  };

  console.log('[db] Łączę z bazą "' + database + '" ...');
  const pool = await sql.connect(config);

  // 1. Testowy produkt 0000031.
  const jeden = await pool.request().query(`
    SELECT Item, IsPhoto, IsPhotoPrev, PhotoVersion, PhotoSmallVersion,
           DATALENGTH(Photo) AS PhotoBytes,
           DATALENGTH(PhotoSmall) AS PhotoSmallBytes
    FROM dbo.csItems
    WHERE Item = '0000031'
  `);
  console.log('\n[1] Produkt 0000031:');
  console.log(jeden.recordset);

  // 2. Statystyka na całej tabeli csItems — ile wierszy ma faktycznie
  // niepuste Photo/PhotoSmall.
  const staty = await pool.request().query(`
    SELECT
      COUNT(*) AS wszystkie,
      SUM(CASE WHEN Photo IS NOT NULL AND DATALENGTH(Photo) > 0 THEN 1 ELSE 0 END) AS zPhoto,
      SUM(CASE WHEN PhotoSmall IS NOT NULL AND DATALENGTH(PhotoSmall) > 0 THEN 1 ELSE 0 END) AS zPhotoSmall,
      SUM(CASE WHEN IsPhoto = 1 THEN 1 ELSE 0 END) AS zIsPhoto1
    FROM dbo.csItems
  `);
  console.log('\n[2] Statystyka całej tabeli csItems:');
  console.log(staty.recordset);

  // 3. To samo dla tabeli csPhotos (osobna galeria) powiązanej z tym
  // produktem (csSourceId = csItemsId produktu 0000031).
  const foto = await pool.request().query(`
    SELECT p.csPhotosId, p.csSourceId, p.Ord, p.DoNotShow4Items,
           DATALENGTH(p.Photo) AS PhotoBytes,
           DATALENGTH(p.PhotoMed) AS PhotoMedBytes,
           DATALENGTH(p.PhotoSmall) AS PhotoSmallBytes,
           DATALENGTH(p.PhotoWatermark) AS PhotoWatermarkBytes
    FROM dbo.csPhotos p
    INNER JOIN dbo.csItems i ON i.csItemsId = p.csSourceId
    WHERE i.Item = '0000031'
  `);
  console.log('\n[3] Rekordy csPhotos dla produktu 0000031:');
  console.log(foto.recordset);

  // 4. Statystyka całej tabeli csPhotos.
  const fotoStaty = await pool.request().query(`
    SELECT
      COUNT(*) AS wszystkie,
      SUM(CASE WHEN Photo IS NOT NULL AND DATALENGTH(Photo) > 0 THEN 1 ELSE 0 END) AS zPhoto,
      SUM(CASE WHEN PhotoSmall IS NOT NULL AND DATALENGTH(PhotoSmall) > 0 THEN 1 ELSE 0 END) AS zPhotoSmall
    FROM dbo.csPhotos
  `);
  console.log('\n[4] Statystyka całej tabeli csPhotos:');
  console.log(fotoStaty.recordset);

  await pool.close();
}

main().catch(err => {
  console.error('[BŁĄD]', err.message);
  process.exit(1);
});
