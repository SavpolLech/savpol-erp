// Stałe wartości dla kolumn csItems, których API karty produktu w ogóle nie
// zwraca (patrz mapowanie-wstepna.md — sekcja o 16 potwierdzonych brakach) —
// podane przez Michała Jankowskiego mailem 2026-09-14:
//
//   LastChangeDate = sysdatetime()   (bieżący czas, w momencie insertu)
//   DefSort        = 967128          (stała wartość)
//   IsPhoto        = 1               (stała wartość)
//   IsPhotoPrev    = 1               (stała wartość)
//   createdDate    = sysdatetime()   (bieżący czas, w momencie insertu)
//
// Ta sama logika co automatyzacje/wz/lib/fixed-values.js: to NIE jest
// zmiana schematu, tylko stałe/wyliczenia do wpisania przy każdym insercie,
// bo dla naszego zakresu danych wartość jest zawsze taka sama (albo liczona
// tak samo — "teraz").

// Kolumny ze stałą, JS-ową wartością — wiążemy jak zwykły parametr.
const ITEMS_FIXED_VALUES = {
  DefSort: 967128,
  IsPhoto: 1,
  IsPhotoPrev: 1
};

// Kolumny liczone w SQL w momencie insertu/update — NIE wiążemy jako
// parametr, wstawiamy dosłownie SYSDATETIME() w tekście zapytania.
const ITEMS_SQL_NOW_COLUMNS = ['LastChangeDate', 'createdDate'];

const ITEMS_FIXED_FIELDS = Object.keys(ITEMS_FIXED_VALUES).concat(ITEMS_SQL_NOW_COLUMNS);

module.exports = { ITEMS_FIXED_VALUES, ITEMS_SQL_NOW_COLUMNS, ITEMS_FIXED_FIELDS };
