// Stałe wartości dla kolumn NOT NULL, których nie da się wyciągnąć z UI ERP
// (wewnętrzne flagi biznesowe zależne od TYPU dokumentu, nie od konkretnego
// dokumentu) — dla PRZESUNIĘĆ MAGAZYNOWYCH (MM) podane przez Michała jako
// zrzut z bazy (MM_pola_wymagane.xlsx, 2026-09-15).
//
// To NIE jest zmiana schematu (NOT NULL zostaje) — to stałe do wpisania przy
// każdym insertcie, bo dla danego typu dokumentu wartość jest zawsze taka sama.
//
// RÓŻNICE względem WZ (dla porównania, gdyby ktoś patrzył na oba pliki obok
// siebie) — wg zrzutu MM od Michała:
//   anaKind:                2 → 0
//   anaUse:                 1 → 0
//   csDocumentsGenType:     1 → 0
//   IsDocNumberExtVisible:  0 → 1
//   IsHeaderDimensionsRequired: 0 → 1
//   ShipmentType:           0 → NULL  (dla MM zostaje NULL — NIE ma go poniżej,
//                                       kolumna jest nullable, zostaje pusta)
//   Cor:                    0 → 0     (bez zmian)
// Reszta flag nagłówka i wszystkie flagi pozycji — identyczne jak dla WZ.

const HEADER_FIXED_VALUES = {
  Cor: 0,
  anaKind: 0, anaUse: 0, CAddressType: 0, csDocumentsGenType: 0,
  CUnitPriceGetMethod: 0, CVATMethod: 0, DAddressType: 0, DiscountGetMethod: 0,
  DocsHeadersPaymentsPaymentBalance: 0, DocsHeadersPaymentsPositionsPaymentBalance: 0,
  doNotAutoCalcByKSeF: 0, FVATMethod: 0, IsAcceptanceRequired: 0, IsAssetsDim: 1,
  IsCompanyCustomer: 0, IsConfidential: 0, IsCustomerOwnsStocks: 0, IsCustomerVisible: 1,
  IsDocNumberExtAdd2Visible: 0, IsDocNumberExtVisible: 1, IsDuplicate: 0,
  IsHeaderDimensionsRequired: 1, IsIncomeSettled: 0, IsManySettlements: 0,
  IsNot4TimeAndAttendance: 0, IsOfficeDoc: 0, IsOffInvoice: 0, IsPaidFull: 0,
  IsPaidFullDocsHeadersPaymentsPositions: 0, IsPositionDimensionsRequired: 0,
  IsProcessingPersonalDataByCeneoAccepted: 0, IsRelatedTransactionsDim: 0,
  IsRequestsDim: 0, isSplitPaymentRequired: 0, IsThreeWayTransaction: 0,
  IsTransactionWithinUE: 0, IsVATOnlyAccounting: 0, IsVerified: 0, NoCheckVATRate: 0,
  noSettlementGen: 0, PricesPrecision: 2, RAddressType: 2, ResStatus: 0,
  SAddressType: 0, updCount: 0, UseRecyclingFee: 0, Warehousing: 0
};

// createdDate NIE jest tutaj — to reguła (= DocDate nagłówka), liczona w
// scrape.js dla każdej pozycji osobno, nie stała wartość.
// Flagi pozycji dla MM = identyczne jak WZ (zrzut Michała, arkusz 2).
const POSITION_FIXED_VALUES = {
  IsFromDiscountCodes: 0, IsPosVat: 1, OperationKind: 0, SEZKind: 0, ShowAddInfo: 0
};

const HEADER_FIXED_FIELDS = Object.keys(HEADER_FIXED_VALUES);
const POSITION_FIXED_FIELDS = Object.keys(POSITION_FIXED_VALUES).concat(['createdDate']);

module.exports = { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES, HEADER_FIXED_FIELDS, POSITION_FIXED_FIELDS };
