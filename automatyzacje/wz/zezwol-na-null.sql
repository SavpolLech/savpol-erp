-- Do przekazania Michałowi. Dotyczy WYŁĄCZNIE tabel testowych w bazie "worek"
-- (dbo.csDocsHeaders_test / dbo.csDocsItemsPositions_test) — NIE rusza cs06
-- ani docelowych tabel produkcyjnych csDocsHeaders/csDocsItemsPositions.
--
-- Po co: te tabele testowe mają pełny schemat 1:1 z cs06, łącznie z NOT NULL
-- na dziesiątkach wewnętrznych flag biznesowych ERP (IsOffInvoice, IsPaidFull,
-- anaKind, itd.), których scraper WZ nie wypełnia (nie da się ich odczytać
-- z UI ERP — patrz automatyzacje/wz/mapowanie-pol.md). Bez tej zmiany każdy
-- INSERT wywala się na pierwszej takiej kolumnie.
--
-- Alternatywa (jeśli Michał woli): zamiast ALTER COLUMN, dodać DEFAULT (np. 0)
-- na tych kolumnach. Wybrałem NULL, nie zgadane 0/1, żeby nie sugerować
-- fałszywej wartości biznesowej dla pola, którego nie scrapujemy.

USE worek;
GO

-- dbo.csDocsHeaders_test (47 kolumn)
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN anaKind tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN anaUse bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN CAddressType tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN csDocumentsGenType tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN CUnitPriceGetMethod tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN CVATMethod tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN DAddressType tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN DiscountGetMethod tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN DocsHeadersPaymentsPaymentBalance numeric(18,4) NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN DocsHeadersPaymentsPositionsPaymentBalance numeric(18,4) NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN doNotAutoCalcByKSeF bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN FVATMethod tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsAcceptanceRequired tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsAssetsDim bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsCompanyCustomer bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsConfidential tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsCustomerOwnsStocks bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsCustomerVisible bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsDocNumberExtAdd2Visible bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsDocNumberExtVisible bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsDuplicate bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsHeaderDimensionsRequired bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsIncomeSettled bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsManySettlements bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsNot4TimeAndAttendance tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsOfficeDoc bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsOffInvoice bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsPaidFull bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsPaidFullDocsHeadersPaymentsPositions bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsPositionDimensionsRequired bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsProcessingPersonalDataByCeneoAccepted bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsRelatedTransactionsDim bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsRequestsDim bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN isSplitPaymentRequired bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsThreeWayTransaction bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsTransactionWithinUE bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsVATOnlyAccounting bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN IsVerified smallint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN NoCheckVATRate bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN noSettlementGen bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN PricesPrecision tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN RAddressType tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN ResStatus bit NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN SAddressType tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN updCount int NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN UseRecyclingFee tinyint NULL;
ALTER TABLE dbo.csDocsHeaders_test ALTER COLUMN Warehousing bit NULL;
GO

-- dbo.csDocsItemsPositions_test (6 kolumn)
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN createdDate datetime NULL;
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN IsFromDiscountCodes bit NULL;
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN IsPosVat bit NULL;
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN OperationKind smallint NULL;
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN SEZKind tinyint NULL;
ALTER TABLE dbo.csDocsItemsPositions_test ALTER COLUMN ShowAddInfo bit NULL;
GO
