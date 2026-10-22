const assert = require("assert");
const audit = require("./formula-audit.js");

assert.strictEqual(
  audit.normalizeFormula("IF(D2>=2,F2*2,0)", "G2"),
  "IF(R[0]C[-3]>=2,R[0]C[-1]*2,0)"
);
assert.strictEqual(
  audit.normalizeFormula("IF(D8>=2,F8*2,0)", "G8"),
  "IF(R[0]C[-3]>=2,R[0]C[-1]*2,0)"
);
assert.strictEqual(
  audit.normalizeFormula("$A$1+D2", "F2"),
  "R$1C$1+R[0]C[-2]"
);

const sheet = {
  A1: { v: "직원ID" },
  B1: { v: "시간" },
  C1: { v: "금액" },
  A2: { v: "A001" }, B2: { v: 2 }, C2: { f: "IF(B2>=2,9000,0)" },
  A3: { v: "A002" }, B3: { v: 3 },
  A4: { v: "A003" }, B4: { v: 4 }, C4: { v: 9000 },
  A5: { v: "A004" }, B5: { v: 2 }, C5: { f: "IF(B5>=3,9000,0)" },
  A6: { v: "A005" }, B6: { v: 2 }, C6: { f: "IF(B6>=2,9000,0)" },
  "!ref": "A1:C6",
};

const result = audit.auditWorksheet(sheet, {
  range: { s: { r: 0, c: 0 }, e: { r: 5, c: 2 } },
  headerRow: 1,
  startRow: 2,
  endRow: 6,
  keyColumn: 0,
  formulaColumns: [2],
  checkPattern: true,
  checkHardcode: true,
});

assert.strictEqual(result.scannedRows, 5);
assert.strictEqual(result.checkedCells, 5);
assert.deepStrictEqual(result.issues.map((item) => item.type), ["MISSING", "HARDCODE", "MISMATCH"]);
assert.deepStrictEqual(result.issues.map((item) => item.address), ["C3", "C4", "C5"]);

const regulationSheet = {
  A1: { v: "직원ID" }, B1: { v: "인정시간" }, C1: { v: "출장식비 지급" }, D1: { v: "특근매식비" },
  A2: { v: "A001" }, B2: { v: 3 }, C2: { v: "N" }, D2: { v: 9000 },
  A3: { v: "A002" }, B3: { v: 3 }, C3: { v: "Y" }, D3: { v: 9000 },
  A4: { v: "A003" }, B4: { v: 1 }, C4: { v: "N" }, D4: { v: 9000 },
  "!ref": "A1:D4",
};
const regulationResult = audit.auditRegulations(regulationSheet, {
  range: { s: { r: 0, c: 0 }, e: { r: 3, c: 3 } },
  headerRow: 1,
  startRow: 2,
  endRow: 4,
  keyColumn: 0,
  columns: { hours: 1, travelMeal: 2, specialAmount: 3, tripType: -1, tripHours: -1, travelAmount: -1 },
  mealMinHours: 2,
  mealRate: 9000,
  localShortRate: 10000,
  localLongRate: 20000,
  publicVehicleDeduction: 10000,
});
assert.strictEqual(regulationResult.issues.length, 2);
assert.deepStrictEqual(regulationResult.issues.map((item) => item.expected), ["0원", "0원"]);
assert(regulationResult.issues.every((item) => item.ruleCitation.includes("가. 지급대상자")));

const travelSheet = {
  A1: { v: "직원ID" }, B1: { v: "출장구분" }, C1: { v: "출장시간" }, D1: { v: "출장여비" }, E1: { v: "공용차량" },
  A2: { v: "T001" }, B2: { v: "근무지내" }, C2: { v: 5 }, D2: { v: 10000 }, E2: { v: "N" },
  A3: { v: "T002" }, B3: { v: "근무지내" }, C3: { v: 5 }, D3: { v: 20000 }, E3: { v: "Y" },
};
const travelResult = audit.auditRegulations(travelSheet, {
  range: { s: { r: 0, c: 0 }, e: { r: 2, c: 4 } },
  headerRow: 1, startRow: 2, endRow: 3, keyColumn: 0,
  columns: { hours: -1, specialAmount: -1, tripType: 1, tripHours: 2, travelAmount: 3, publicVehicle: 4 },
  localShortRate: 10000, localLongRate: 20000, publicVehicleDeduction: 10000,
});
assert.strictEqual(travelResult.issues[0].ruleCitation, "제18조제1항 본문");
assert.strictEqual(travelResult.issues[1].ruleCitation, "제18조제1항 본문 및 단서");

const mixedSheet = {
  A1: { v: "직원ID" }, B1: { v: "인정시간" }, C1: { v: "특근매식비" }, D1: { v: "출장구분" }, E1: { v: "출장시간" }, F1: { v: "출장여비" },
  A2: { v: "X001" }, B2: { v: 3 }, C2: { v: 8000 }, D2: { v: "근무지내" }, E2: { v: 5 }, F2: { v: 10000 }, G2: { v: "N" },
};
const mixedOptions = {
  range: { s: { r: 0, c: 0 }, e: { r: 1, c: 5 } },
  headerRow: 1, startRow: 2, endRow: 2, keyColumn: 0,
  columns: { hours: 1, specialAmount: 2, travelMeal: -1, tripType: 3, tripHours: 4, travelAmount: 5, publicVehicle: 6 },
  mealMinHours: 2, mealRate: 9000, localShortRate: 10000, localLongRate: 20000, publicVehicleDeduction: 10000,
};
assert.deepStrictEqual(audit.auditRegulations(mixedSheet, { ...mixedOptions, mode: "meal" }).issues.map((item) => item.address), ["C2"]);
assert.deepStrictEqual(audit.auditRegulations(mixedSheet, { ...mixedOptions, mode: "travel" }).issues.map((item) => item.address), ["F2"]);

function externalFixture(changes) {
  const values = ["E001", "근무지외", 2, 1, "제2호", "N", 0, 50000, 50000, 95000, 30000, 0, 30000, "95000", "서울", 225000, "N"];
  Object.entries(changes || {}).forEach(([index, value]) => { values[Number(index)] = value; });
  const sheet = {};
  values.forEach((value, col) => { if (value !== null) sheet[audit.encodeAddress(1, col)] = { v: value }; });
  const options = {
    mode: "travel", travelScope: "all", range: { s: { r: 0, c: 0 }, e: { r: 1, c: 16 } },
    headerRow: 1, startRow: 2, endRow: 2, keyColumn: 0,
    columns: { tripType: 1, tripDays: 2, tripNights: 3, travelGrade: 4, publicVehicle: 5, publicVehicleDays: 6, dailyAmount: 7, mealAmount: 8, lodgingAmount: 9, fareAmount: 10, mealDeduction: 11, fareEvidence: 12, lodgingEvidence: 13, lodgingRegion: 14, travelAmount: 15, travelException: 16 },
    externalDailyRate: 25000, externalMealRate: 25000, externalVehicleRatio: 0.5,
    lodgingSeoulCap: 100000, lodgingMetroCap: 80000, lodgingOtherCap: 70000,
  };
  return { sheet, options, result: audit.auditRegulations(sheet, options) };
}
assert.strictEqual(externalFixture().result.issues.length, 0);
const fullCar = externalFixture({ 5: "Y", 6: 2 });
assert.strictEqual(fullCar.result.issues.find((i) => i.address === "H2").expected, "25,000원");
assert(fullCar.result.issues.find((i) => i.address === "H2").ruleCitation.includes("제3항"));
const partialCar = externalFixture({ 5: "Y", 6: 1 });
assert.strictEqual(partialCar.result.issues.find((i) => i.address === "H2").expected, "37,500원");
assert(!partialCar.result.issues.some((i) => i.address === "I2"));
const missingVehicleDays = externalFixture({ 5: "Y", 6: null });
assert(missingVehicleDays.result.issues.some((i) => i.type === "REVIEW"));
assert(!missingVehicleDays.result.issues.some((i) => i.address === "H2" && i.type === "REGULATION"));
const food = externalFixture({ 8: 25000 });
assert.strictEqual(food.result.issues.find((i) => i.address === "I2").expected, "50,000원");
const noDeduction = externalFixture({ 11: null });
assert(noDeduction.result.issues.some((i) => i.type === "REVIEW"));
const seoulCap = externalFixture({ 9: 120000, 13: "120000" });
assert.strictEqual(seoulCap.result.issues.find((i) => i.address === "J2").expected, "100,000원");
const nightly = externalFixture({ 2: 3, 3: 2, 9: 180000, 13: "120000;60000" });
assert.strictEqual(nightly.result.issues.find((i) => i.address === "J2").expected, "160,000원");
const metroCap = externalFixture({ 9: 95000, 13: "95000", 14: "부산" });
assert.strictEqual(metroCap.result.issues.find((i) => i.address === "J2").expected, "80,000원");
const otherCap = externalFixture({ 9: 95000, 13: "95000", 14: "강릉" });
assert.strictEqual(otherCap.result.issues.find((i) => i.address === "J2").expected, "70,000원");
const gradeOne = externalFixture({ 4: "제1호", 9: 120000, 13: "120000" });
assert(!gradeOne.result.issues.some((i) => i.address === "J2"));
const fare = externalFixture({ 10: 40000 });
assert.strictEqual(fare.result.issues.find((i) => i.address === "K2").expected, "30,000원");
const noReceipts = externalFixture({ 13: null });
assert(noReceipts.result.issues.some((i) => i.type === "REVIEW"));
assert(!noReceipts.result.issues.some((i) => i.address === "J2" && i.fixType));
const mixedRegion = externalFixture({ 14: "서울;부산" });
assert(mixedRegion.result.issues.some((i) => i.type === "REVIEW"));
const exception = externalFixture({ 16: "숙박비 추가지급 승인" });
assert(exception.result.issues.some((i) => i.type === "REVIEW"));
assert(!exception.result.issues.some((i) => ["H2", "I2", "J2"].includes(i.address) && i.fixType));
assert.strictEqual(audit.auditRegulations(fullCar.sheet, { ...fullCar.options, travelScope: "local" }).scannedRows, 0);
assert.strictEqual(audit.travelKind("근무지 외"), "external");
assert.strictEqual(audit.travelKind("관내"), "local");

const groupedSheet = {
  A1: { v: "직원ID" }, B1: { v: "기준값" }, C1: { v: "정산액" },
  A2: { v: "L1" }, B2: { v: 2 }, C2: { f: "B2*10000" },
  A3: { v: "L2" }, B3: { v: 2 }, C3: { f: "B3*10000" },
  A4: { v: "E1" }, C4: { f: "SUM(D4:E4)" },
  A5: { v: "E2" }, C5: { f: "SUM(D5:E5)" },
  A6: { v: "L3" }, B6: { v: 2 },
};
const grouped = audit.auditWorksheet(groupedSheet, {
  range: { s: { r: 0, c: 0 }, e: { r: 5, c: 4 } }, headerRow: 1, startRow: 2, endRow: 6, keyColumn: 0, formulaColumns: [2],
  rowGroup: (row) => row === 3 || row === 4 ? "external" : "local",
});
assert.strictEqual(grouped.issues.length, 1);
assert.strictEqual(grouped.issues[0].address, "C6");
assert.strictEqual(grouped.issues[0].fixValue, "B6*10000");

console.log("formula-audit tests passed");
