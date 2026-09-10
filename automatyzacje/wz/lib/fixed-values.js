// Stałe wartości dla kolumn NOT NULL, których nie da się wyciągnąć z UI ERP
// (wewnętrzne flagi biznesowe zależne od TYPU dokumentu, nie od konkretnego
// dokumentu) — podane przez Michała mailem 2026-09-09, dla WZ konkretnie.
// Jeśli kiedyś dojdą inne typy dokumentów (FA, ZO...), Michał ma osobny
// zestaw wartości per typ (tabela w tym samym mailu) — TYLKO_WZ poniżej
// trzeba wtedy zamienić na wybór wg typu dokumentu.
//
// To NIE jest zmiana schematu (NOT NULL zostaje) — to stałe do wpisania przy
// każdym insertcie, bo dla danego typu dokumentu wartość jest zawsze taka sama.

const HEADER_FIXED_VALUES = {
  // Cor i ShipmentType dopisane na wyraźną prośbę Michała (mail 2026-09-10) —
  // wcześniej nie blokowały insertu (kolumny nullable), więc nie były w tej
  // liście, ale wolał jawne 0 niż NULL dla WZ.
  Cor: 0, ShipmentType: 0,
  anaKind: 2, anaUse: 1, CAddressType: 0, csDocumentsGenType: 1,
  CUnitPriceGetMethod: 0, CVATMethod: 0, DAddressType: 0, DiscountGetMethod: 0,
  DocsHeadersPaymentsPaymentBalance: 0, DocsHeadersPaymentsPositionsPaymentBalance: 0,
  doNotAutoCalcByKSeF: 0, FVATMethod: 0, IsAcceptanceRequired: 0, IsAssetsDim: 1,
  IsCompanyCustomer: 0, IsConfidential: 0, IsCustomerOwnsStocks: 0, IsCustomerVisible: 1,
  IsDocNumberExtAdd2Visible: 0, IsDocNumberExtVisible: 0, IsDuplicate: 0,
  IsHeaderDimensionsRequired: 0, IsIncomeSettled: 0, IsManySettlements: 0,
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
const POSITION_FIXED_VALUES = {
  IsFromDiscountCodes: 0, IsPosVat: 1, OperationKind: 0, SEZKind: 0, ShowAddInfo: 0
};

const HEADER_FIXED_FIELDS = Object.keys(HEADER_FIXED_VALUES);
const POSITION_FIXED_FIELDS = Object.keys(POSITION_FIXED_VALUES).concat(['createdDate']);

module.exports = { HEADER_FIXED_VALUES, POSITION_FIXED_VALUES, HEADER_FIXED_FIELDS, POSITION_FIXED_FIELDS };
