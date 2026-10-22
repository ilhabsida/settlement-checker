(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FormulaAudit = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function decodeColumn(letters) {
    let result = 0;
    for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
    return result - 1;
  }

  function encodeColumn(index) {
    let value = index + 1;
    let result = "";
    while (value > 0) {
      const rest = (value - 1) % 26;
      result = String.fromCharCode(65 + rest) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  function decodeAddress(address) {
    const match = /^([A-Z]+)(\d+)$/.exec(address.toUpperCase());
    if (!match) throw new Error("잘못된 셀 주소: " + address);
    return { c: decodeColumn(match[1]), r: Number(match[2]) - 1 };
  }

  function encodeAddress(rowIndex, columnIndex) {
    return encodeColumn(columnIndex) + String(rowIndex + 1);
  }

  function normalizeFormula(formula, originAddress) {
    if (!formula) return "";
    const origin = decodeAddress(originAddress);
    const referencePattern = /((?:'[^']+'|[A-Za-z_가-힣][A-Za-z0-9_.가-힣]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
    return String(formula).replace(
      referencePattern,
      function (_, sheet, absoluteColumn, letters, absoluteRow, rowText) {
        const columnIndex = decodeColumn(letters);
        const rowIndex = Number(rowText) - 1;
        const columnPart = absoluteColumn
          ? "C$" + String(columnIndex + 1)
          : "C[" + String(columnIndex - origin.c) + "]";
        const rowPart = absoluteRow
          ? "R$" + String(rowIndex + 1)
          : "R[" + String(rowIndex - origin.r) + "]";
        return (sheet || "") + rowPart + columnPart;
      }
    );
  }

  function hasValue(cell) {
    return !!cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== "";
  }

  function displayValue(cell) {
    if (!cell) return "";
    if (cell.f) return "=" + cell.f;
    if (cell.w !== undefined) return String(cell.w);
    if (cell.v !== undefined && cell.v !== null) return String(cell.v);
    return "";
  }

  function dominantPattern(sheet, rows, columnIndex) {
    const counts = new Map();
    const samples = new Map();
    for (const rowIndex of rows) {
      const address = encodeAddress(rowIndex, columnIndex);
      const cell = sheet[address];
      if (!cell || !cell.f) continue;
      const pattern = normalizeFormula(cell.f, address);
      counts.set(pattern, (counts.get(pattern) || 0) + 1);
      if (!samples.has(pattern)) samples.set(pattern, { address, formula: cell.f });
    }
    let pattern = "";
    let count = 0;
    for (const [candidate, candidateCount] of counts) {
      if (candidateCount > count) {
        pattern = candidate;
        count = candidateCount;
      }
    }
    const sample = samples.get(pattern) || { address: "", formula: "" };
    return { pattern, count, variants: counts.size, sourceAddress: sample.address, sourceFormula: sample.formula };
  }

  function translateFormula(formula, sourceAddress, targetAddress) {
    if (!formula || !sourceAddress || !targetAddress) return "";
    const source = decodeAddress(sourceAddress);
    const target = decodeAddress(targetAddress);
    const rowDelta = target.r - source.r;
    const columnDelta = target.c - source.c;
    const referencePattern = /((?:'[^']+'|[A-Za-z_가-힣][A-Za-z0-9_.가-힣]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)/g;
    return String(formula).replace(
      referencePattern,
      function (_, sheetName, absoluteColumn, letters, absoluteRow, rowText) {
        const originalColumn = decodeColumn(letters);
        const originalRow = Number(rowText) - 1;
        const nextColumn = absoluteColumn ? originalColumn : originalColumn + columnDelta;
        const nextRow = absoluteRow ? originalRow : originalRow + rowDelta;
        if (nextColumn < 0 || nextRow < 0) return "#REF!";
        return (sheetName || "") + absoluteColumn + encodeColumn(nextColumn) + absoluteRow + String(nextRow + 1);
      }
    );
  }

  function auditWorksheet(sheet, options) {
    const range = options.range || { s: { r: options.startRow - 1, c: 0 }, e: { r: options.endRow - 1, c: 0 } };
    const startRowIndex = Math.max(0, options.startRow - 1);
    const endRowIndex = options.endRow ? options.endRow - 1 : range.e.r;
    const keyColumn = Number(options.keyColumn);
    const formulaColumns = (options.formulaColumns || []).map(Number);
    const headerRowIndex = Math.max(0, (options.headerRow || 1) - 1);
    const checkPattern = options.checkPattern !== false;
    const checkHardcode = options.checkHardcode !== false;
    const dataRows = [];

    for (let row = startRowIndex; row <= endRowIndex; row += 1) {
      if (hasValue(sheet[encodeAddress(row, keyColumn)]) && (!options.rowFilter || options.rowFilter(row))) dataRows.push(row);
    }

    const patterns = new Map();
    const rowGroups = new Map();
    for (const row of dataRows) {
      const group = options.rowGroup ? options.rowGroup(row) : "all";
      if (!rowGroups.has(group)) rowGroups.set(group, []);
      rowGroups.get(group).push(row);
    }
    for (const [group, rows] of rowGroups) {
      for (const columnIndex of formulaColumns) {
        patterns.set(`${group}:${columnIndex}`, dominantPattern(sheet, rows, columnIndex));
      }
    }

    const issues = [];
    for (const rowIndex of dataRows) {
      const key = displayValue(sheet[encodeAddress(rowIndex, keyColumn)]);
      for (const columnIndex of formulaColumns) {
        const address = encodeAddress(rowIndex, columnIndex);
        const cell = sheet[address];
        const header = displayValue(sheet[encodeAddress(headerRowIndex, columnIndex)]) || encodeColumn(columnIndex) + "열";
        const base = {
          row: rowIndex + 1,
          column: encodeColumn(columnIndex),
          address,
          key,
          header,
          current: displayValue(cell),
        };
        const group = options.rowGroup ? options.rowGroup(rowIndex) : "all";
        const dominant = patterns.get(`${group}:${columnIndex}`);
        // 관내·관외는 계산식이 다를 수 있다. 해당 구분에 수식 근거가 전혀
        // 없으면 다른 구분의 수식을 적용하거나 정상 수기값을 오류로 단정하지 않는다.
        if (options.rowGroup && (!dominant || dominant.count === 0)) continue;
        const suggestedFormula = dominant && dominant.sourceFormula
          ? translateFormula(dominant.sourceFormula, dominant.sourceAddress, address)
          : "";

        if (!cell || (!cell.f && !hasValue(cell))) {
          issues.push({
            ...base,
            type: "MISSING",
            severity: "높음",
            message: "데이터 행의 계산 셀에 수식이 없습니다.",
            correction: suggestedFormula ? "같은 열의 정상 수식을 이 행에 맞게 복원합니다." : "인접 정상 행의 수식을 확인해 복원하세요.",
            fixType: suggestedFormula ? "FORMULA" : "",
            fixValue: suggestedFormula,
            expected: suggestedFormula ? "=" + suggestedFormula : "정상 수식 확인 필요",
            ruleName: "엑셀 수식 일관성 검사",
            ruleText: "같은 계산 열의 다수 정상 수식 패턴",
          });
          continue;
        }
        if (!cell.f && hasValue(cell)) {
          if (checkHardcode) {
            issues.push({
              ...base,
              type: "HARDCODE",
              severity: "높음",
              message: "수식 대신 값이 직접 입력되어 있습니다.",
              correction: suggestedFormula ? "직접 입력된 값을 제거하고 정상 수식을 복원합니다." : "인접 정상 행과 비교해 수식을 복원하세요.",
              fixType: suggestedFormula ? "FORMULA" : "",
              fixValue: suggestedFormula,
              expected: suggestedFormula ? "=" + suggestedFormula : "정상 수식 확인 필요",
              ruleName: "엑셀 수식 일관성 검사",
              ruleText: "같은 계산 열의 다수 정상 수식 패턴",
            });
          }
          continue;
        }
        if (String(cell.f).includes("#REF!")) {
          issues.push({
            ...base,
            type: "MISMATCH",
            severity: "높음",
            message: "수식에 잘못된 셀 참조(#REF!)가 있습니다.",
            correction: suggestedFormula ? "같은 열의 정상 수식 패턴으로 참조 오류를 복원합니다." : "원자료와 인접 행을 확인해 참조를 수정하세요.",
            fixType: suggestedFormula ? "FORMULA" : "",
            fixValue: suggestedFormula,
            expected: suggestedFormula ? "=" + suggestedFormula : "정상 참조 확인 필요",
            ruleName: "엑셀 수식 참조 검사",
            ruleText: "수식에 #REF! 등 잘못된 셀 참조가 없어야 함",
          });
          continue;
        }
        if (checkPattern && dominant && dominant.count >= 2) {
          const currentPattern = normalizeFormula(cell.f, address);
          if (currentPattern !== dominant.pattern) {
            issues.push({
              ...base,
              type: "MISMATCH",
              severity: "보통",
              message: "같은 열의 일반적인 수식 패턴과 다릅니다.",
              correction: suggestedFormula ? "같은 열의 다수 수식 패턴으로 교체합니다." : "인접 정상 행과 수식을 비교해 수정하세요.",
              fixType: suggestedFormula ? "FORMULA" : "",
              fixValue: suggestedFormula,
              expected: suggestedFormula ? "=" + suggestedFormula : "정상 수식 확인 필요",
              ruleName: "엑셀 수식 일관성 검사",
              ruleText: "같은 계산 열의 다수 정상 수식 패턴",
            });
          }
        }
      }
    }

    return {
      issues,
      scannedRows: dataRows.length,
      checkedCells: dataRows.length * formulaColumns.length,
      formulaColumns: formulaColumns.length,
      patterns,
    };
  }

  function numericValue(cell) {
    if (!cell || cell.t === "e" || (cell.f && cell.t === "z")) return null;
    if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v;
    const text = displayValue(cell).replace(/,/g, "").trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function isYes(value) {
    return ["Y", "YES", "예", "지급", "O", "1"].includes(String(value || "").trim().toUpperCase());
  }

  function travelKind(value) {
    const text = String(value || "").replace(/\s+/g, "");
    if (["근무지내", "관내", "근무지내출장", "관내출장"].includes(text)) return "local";
    if (["근무지외", "관외", "근무지외출장", "관외출장"].includes(text)) return "external";
    return "unknown";
  }

  function inTravelScope(sheet, rowIndex, typeColumn, scope) {
    if (!scope || scope === "all") return true;
    const kind = travelKind(displayValue(sheet[encodeAddress(rowIndex, Number(typeColumn))]));
    return kind === "unknown" || kind === scope;
  }

  function yesNo(value) {
    const text = String(value || "").trim().toUpperCase();
    if (["Y", "YES", "예", "지급", "이용", "O", "1"].includes(text)) return true;
    if (["N", "NO", "아니오", "미지급", "미이용", "X", "0"].includes(text)) return false;
    return null;
  }

  function auditRegulations(sheet, options) {
    const range = options.range;
    const startRowIndex = Math.max(0, options.startRow - 1);
    const endRowIndex = options.endRow ? options.endRow - 1 : range.e.r;
    const keyColumn = Number(options.keyColumn);
    const headerRowIndex = Math.max(0, (options.headerRow || 1) - 1);
    const issues = [];
    const dataRows = [];
    const column = (name) => Number(options.columns[name]);
    const hasColumn = (name) => Number.isInteger(column(name)) && column(name) >= 0;
    const header = (columnIndex) => displayValue(sheet[encodeAddress(headerRowIndex, columnIndex)]) || encodeColumn(columnIndex) + "열";

    for (let row = startRowIndex; row <= endRowIndex; row += 1) {
      if (hasValue(sheet[encodeAddress(row, keyColumn)]) && (options.mode === "meal" || inTravelScope(sheet, row, options.columns.tripType, options.travelScope))) dataRows.push(row);
    }

    function pushIssue(rowIndex, columnIndex, message, expected, ruleName, ruleText, fixValue, difference, ruleCitation, metadata) {
      const address = encodeAddress(rowIndex, columnIndex);
      issues.push({
        row: rowIndex + 1,
        column: encodeColumn(columnIndex),
        address,
        key: displayValue(sheet[encodeAddress(rowIndex, keyColumn)]),
        header: header(columnIndex),
        current: displayValue(sheet[address]),
        expected,
        ruleName,
        ruleCitation,
        ruleText,
        difference: difference === null || difference === undefined
          ? "-"
          : Math.abs(difference).toLocaleString("ko-KR") + "원 " + (difference < 0 ? "부족" : difference > 0 ? "초과" : "일치"),
        correction: fixValue !== null && fixValue !== undefined
          ? `현재 값을 확인한 뒤 규정상 기대금액 ${expected}(으)로 수정합니다.`
          : "원자료를 먼저 확인한 뒤 계산값을 갱신하세요.",
        fixType: fixValue !== null && fixValue !== undefined ? "VALUE" : "",
        fixValue,
        type: "REGULATION",
        severity: "높음",
        message,
        ...metadata,
      });
    }

    function review(row, field, message, citation, sourceId) {
      const col = hasColumn(field) ? column(field) : keyColumn;
      pushIssue(row, col, message, "자료 확인 후 판정", "공무원 여비 규정", "입력값·증빙 또는 예외 승인 확인이 필요합니다.", null, null,
        citation || "제16조 및 별표 2", { type: "REVIEW", severity: "확인", sourceId: sourceId || "travel18", sourcePage: 3, correction: "해당 원자료를 보완하고 다시 검사하세요.", fixType: "" });
    }

    function readNumber(row, field) {
      return hasColumn(field) ? numericValue(sheet[encodeAddress(row, column(field))]) : null;
    }

    function compareAmount(row, field, expected, explanation, citation, sourceId, canFix) {
      const actual = readNumber(row, field);
      const format = (value) => value.toLocaleString("ko-KR") + "원";
      if (actual === null || actual < 0) {
        review(row, field, `${explanation} 실제 지급액이 없거나 유효한 금액이 아니므로 비교할 수 없습니다. 기대액 ${format(expected)}.`, citation, sourceId);
        return;
      }
      if (Math.abs(actual - expected) <= 0.01) return;
      const col = hasColumn(field) ? column(field) : keyColumn;
      pushIssue(row, col,
        `${explanation} 기대액 ${format(expected)}, 실제 ${format(actual)}로 ${format(Math.abs(actual - expected))} ${actual < expected ? "부족" : "초과"}합니다.`,
        format(expected), "공무원 여비 규정", explanation, canFix === false ? null : expected, actual - expected, citation,
        { sourceId: sourceId || "travel18", sourcePage: sourceId === "table2" ? 1 : 3 });
    }

    function auditExternal(row) {
      const days = readNumber(row, "tripDays");
      const nights = readNumber(row, "tripNights");
      const gradeRaw = hasColumn("travelGrade") ? displayValue(sheet[encodeAddress(row, column("travelGrade"))]).trim() : String(options.externalGradeDefault || "");
      const grade = ["2", "제2호", "2호"].includes(gradeRaw) ? 2 : ["1", "제1호", "1호"].includes(gradeRaw) ? 1 : null;
      const daysValid = days !== null && Number.isInteger(days) && days > 0;
      const nightsValid = nights !== null && Number.isInteger(nights) && nights >= 0 && (!daysValid || nights < days);
      if (!daysValid) review(row, "tripDays", "근무지 외 출장일수는 1 이상의 정수여야 합니다. 출장일수 열을 지정하거나 값을 보완하세요.", "제5조·제16조제3항 및 제5항");
      if (!nightsValid) review(row, "tripNights", "숙박일수가 없거나 유효하지 않습니다. 당일 출장도 숙박일수를 0으로 기록하세요.", "제16조제4항");
      if (!grade) review(row, "travelGrade", "여비 지급등급(제1호·제2호)을 확인할 수 없습니다. 등급 열을 지정하거나 화면의 공통 적용 등급을 선택하세요.", "제3조·별표 1 및 별표 2", "table1");

      const exceptionText = hasColumn("travelException") ? displayValue(sheet[encodeAddress(row, column("travelException"))]).trim() : "";
      const hasException = exceptionText !== "" && !["N", "없음", "해당없음", "0"].includes(exceptionText.toUpperCase());
      const longStay = daysValid && days > 15;
      if (hasException || longStay) {
        review(row, "travelException", longStay
          ? "15일을 넘는 출장입니다. 동일 지역 장기체재 여부와 제17조 감액·예외 승인을 확인한 후 정산해야 하므로 일비·식비·숙박비 자동 금액 판정을 보류합니다."
          : `예외·특례 사항(${exceptionText})이 있어 기본 단가만으로 지급액을 확정할 수 없습니다. 일비·식비·숙박비는 승인 내역과 원자료를 확인하세요.`, "제16조제1항 단서·제17조·제28조");
      }

      const vehicle = hasColumn("publicVehicle") ? yesNo(displayValue(sheet[encodeAddress(row, column("publicVehicle"))])) : null;
      const recordedVehicleDays = readNumber(row, "publicVehicleDays");
      let vehicleDays = vehicle === false ? (recordedVehicleDays === null ? 0 : recordedVehicleDays) : recordedVehicleDays;
      if (vehicle === true && vehicleDays === null && days === 1) vehicleDays = 1;
      const vehicleValid = vehicle !== null && vehicleDays !== null && Number.isInteger(vehicleDays) && vehicleDays >= 0 && daysValid && vehicleDays <= days && (vehicle || vehicleDays === 0);
      if (vehicle === null) review(row, "publicVehicle", "근무지 외 출장의 공용차량 이용 여부(Y/N)를 확인해야 일비 감액을 적용할 수 있습니다.", "제16조제3항");
      else if (!vehicleValid && daysValid) review(row, "publicVehicleDays", "여러 날 출장의 공용차량 이용일수가 없거나 출장일수와 맞지 않습니다. 이용일수에 해당하는 일비에만 50%를 적용해야 합니다.", "제16조제3항");

      const dailyRate = Number(options.externalDailyRate ?? 25000);
      const mealRate = Number(options.externalMealRate ?? 25000);
      const carRatio = Number(options.externalVehicleRatio ?? 0.5);
      if (daysValid && grade && vehicleValid && !hasException && !longStay) {
        const daily = dailyRate * ((days - vehicleDays) + vehicleDays * carRatio);
        compareAmount(row, "dailyAmount", daily,
          `근무지 외 출장 ${days}일, 공용차량 이용 ${vehicleDays}일입니다. 미이용일은 일비 ${dailyRate.toLocaleString("ko-KR")}원, 이용일은 일비의 ${carRatio * 100}%를 지급합니다. 총 출장비에서 1만원을 빼는 방식이 아닙니다.`,
          "제16조제1항·제3항 및 별표 2");
      }

      const mealDeduction = readNumber(row, "mealDeduction");
      if (daysValid && grade && !hasException && !longStay) {
        if (mealDeduction === null || mealDeduction < 0 || mealDeduction > days * mealRate) {
          review(row, "mealDeduction", "식사 제공 등으로 차감할 식비 금액을 확인할 수 없습니다. 공제가 없는 출장도 식비 공제액을 0으로 기록하세요. 임의로 공제 없음으로 간주하지 않습니다.", "제16조제5항·제28조 및 별표 2");
        } else {
          compareAmount(row, "mealAmount", days * mealRate - mealDeduction,
            `근무지 외 출장 식비는 ${days}일 × ${mealRate.toLocaleString("ko-KR")}원에서 원자료에 기록된 식비 공제액 ${mealDeduction.toLocaleString("ko-KR")}원을 뺍니다. 공용차량 이용만을 이유로 식비를 절반 감액하지 않습니다.`,
            "제16조제1항·제5항·제28조 및 별표 2");
        }
      }

      const fareEvidence = readNumber(row, "fareEvidence");
      if (fareEvidence === null || fareEvidence < 0) {
        review(row, "fareEvidence", "운임의 증빙 인정액이 없습니다. 교통수단·좌석등급·할인요금·자가용 예외 등을 담당자가 확인한 인정액을 입력해야 실제 지급 운임과 비교할 수 있습니다. 운임이 없으면 0으로 입력하세요.", "제8조의2·제9조·제10조부터 제13조까지 및 별표 2", "table2");
      } else {
        compareAmount(row, "fareAmount", fareEvidence,
          "운임은 증빙으로 확인한 인정액과 실제 지급액을 비교합니다. 교통수단별 적정성·증빙 진위 자체를 앱이 자동 판정하는 것은 아닙니다.",
          "제8조의2·제9조·제10조부터 제13조까지 및 별표 2", "table2");
      }

      if (nightsValid && grade && !hasException && !longStay) {
        if (nights === 0) {
          compareAmount(row, "lodgingAmount", 0, "숙박일수 0박이므로 숙박비 기대액은 0원입니다.", "제16조제4항 및 별표 2");
        } else {
          const receiptsText = hasColumn("lodgingEvidence") ? displayValue(sheet[encodeAddress(row, column("lodgingEvidence"))]).trim() : "";
          const receipts = receiptsText ? receiptsText.split(/[;；\n|]/).map((value) => value.trim() ? Number(value.replace(/,/g, "").trim()) : NaN) : [];
          if (receipts.length !== nights || receipts.some((value) => !Number.isFinite(value) || value < 0)) {
            review(row, "lodgingEvidence", `숙박 ${nights}박의 밤별 증빙 금액이 필요합니다. 예: 2박은 95000;80000. 합계만으로는 밤별 상한 초과를 놓칠 수 있어 자동 확정하지 않습니다.`, "제8조의2·제16조제1항·제4항 및 별표 2", "table2");
          } else {
            const region = hasColumn("lodgingRegion") ? displayValue(sheet[encodeAddress(row, column("lodgingRegion"))]).replace(/\s+/g, "") : "";
            let cap = null;
            if (grade === 1) cap = Infinity;
            else if (/서울/.test(region)) cap = Number(options.lodgingSeoulCap ?? 100000);
            else if (/광역|부산|대구|인천|광주|대전|울산/.test(region)) cap = Number(options.lodgingMetroCap ?? 80000);
            else if (region && !/[;；,|/]/.test(region)) cap = Number(options.lodgingOtherCap ?? 70000);
            if (grade === 2 && /[;；,|/]/.test(region)) cap = null;
            if (cap === null) {
              review(row, "lodgingRegion", "숙박지역이 없거나 여러 지역이 혼합되어 있습니다. 동일 지역 기준으로 자료를 나누고 서울·광역시·그 밖의 지역 상한을 각각 확인하세요.", "제16조제1항 및 별표 2", "table2");
            } else {
              const allowed = receipts.reduce((total, value) => total + Math.min(value, cap), 0);
              compareAmount(row, "lodgingAmount", allowed,
                grade === 1
                  ? `제1호 숙박비는 증빙 실비 기준입니다. ${nights}박의 증빙 합계 ${allowed.toLocaleString("ko-KR")}원을 비교합니다.`
                  : `제2호 ${region} 숙박 ${nights}박입니다. 각 밤의 증빙 금액과 1박 상한 ${cap.toLocaleString("ko-KR")}원 중 작은 금액을 밤별로 합산합니다.`,
                "제16조제1항·제4항 및 별표 2", "table2");
            }
          }
        }
      }

      const components = ["fareAmount", "dailyAmount", "mealAmount", "lodgingAmount"].map((field) => readNumber(row, field));
      const total = readNumber(row, "travelAmount");
      if (components.every((value) => value !== null && value >= 0) && total !== null && total >= 0) {
        const sum = components.reduce((a, b) => a + b, 0);
        if (Math.abs(total - sum) > 0.01) {
          pushIssue(row, column("travelAmount"), `운임·일비·식비·숙박비 지급액 합계 ${sum.toLocaleString("ko-KR")}원과 총 정산액 ${total.toLocaleString("ko-KR")}원이 다릅니다. 각 항목의 규정 오류를 먼저 수정한 뒤 합계를 다시 계산하세요.`, `${sum.toLocaleString("ko-KR")}원`, "구성항목 합계 점검", "현재 지급 항목 간 산술 합계 검사이며 각 항목의 규정 적합성을 보장하지 않습니다.", null, total - sum, "제2조(여비의 종류) 관련 · 합계 산술 점검", { sourceId: "travel18", sourcePage: 1, fixType: "", correction: "각 지급항목을 먼저 수정하고 합계 수식을 재계산하세요." });
        }
      } else if (total === null) {
        review(row, "travelAmount", "총 정산액이 비어 있거나 저장된 계산값이 없어 항목 합계와 비교하지 못했습니다.", "제2조(여비의 종류)");
      }
    }

    for (const rowIndex of dataRows) {
      if (options.mode !== "travel" && hasColumn("hours") && hasColumn("specialAmount")) {
        const hoursCell = sheet[encodeAddress(rowIndex, column("hours"))];
        const actualCell = sheet[encodeAddress(rowIndex, column("specialAmount"))];
        const hours = numericValue(hoursCell);
        const actual = numericValue(actualCell);
        const travelMeal = hasColumn("travelMeal")
          ? isYes(displayValue(sheet[encodeAddress(rowIndex, column("travelMeal"))]))
          : false;

        if (hours === null) {
          pushIssue(
            rowIndex, column("hours"),
            "인정시간 계산값이 없어 지급대상과 규정상 금액을 판단할 수 없습니다.",
            "숫자 인정시간", "2026년도 예산 및 기금운용계획 집행지침", "정확한 인정시간을 기준으로 지급대상을 판단해야 함", null, null,
            "제2편 Ⅲ. 비목별 지침 → 1. 운영비 → 1-5. 특근매식비(210-05목) → 가. 지급대상자",
            { type: "REVIEW", severity: "확인", sourceId: "meal" }
          );
        } else {
          const eligible = hours >= options.mealMinHours && !travelMeal;
          const expected = eligible ? options.mealRate : 0;
          if (actual === null) {
            pushIssue(
              rowIndex, column("specialAmount"),
              `인정시간 ${hours}시간${travelMeal ? "이며 출장 식비가 지급되어" : "으로"} 규정상 기대금액은 ${expected.toLocaleString("ko-KR")}원이지만 실제 정산액이 비어 있습니다.`,
              expected.toLocaleString("ko-KR") + "원",
              "2026년도 예산 및 기금운용계획 집행지침 - 특근매식비",
              `인정시간 ${options.mealMinHours}시간 이상 시 ${options.mealRate.toLocaleString("ko-KR")}원, 출장 식비 지급 시 특근매식비 제외`,
              expected, -expected,
              "제2편 Ⅲ. 비목별 지침 → 1. 운영비 → 1-5. 특근매식비(210-05목) → 가. 지급대상자 / 나. 지급단가 및 집행방법"
            );
          } else if (Math.abs(actual - expected) > 0.01) {
            let reason;
            if (travelMeal && actual > 0) {
              reason = `출장 식비가 지급된 날은 특근매식비 지급 대상에서 제외되어 기대금액은 0원이지만 실제 ${actual.toLocaleString("ko-KR")}원이 정산되어 중복 지급 가능성이 있습니다.`;
            } else if (eligible) {
              reason = `인정시간 ${hours}시간으로 지급기준을 충족하여 ${expected.toLocaleString("ko-KR")}원이 적용되어야 하나 실제 ${actual.toLocaleString("ko-KR")}원으로 정산되어 ${Math.abs(actual - expected).toLocaleString("ko-KR")}원 ${actual < expected ? "부족" : "초과"}합니다.`;
            } else {
              reason = `인정시간 ${hours}시간으로 ${options.mealMinHours}시간 기준에 미달하여 기대금액은 0원이지만 실제 ${actual.toLocaleString("ko-KR")}원이 정산되었습니다.`;
            }
            pushIssue(
              rowIndex, column("specialAmount"), reason,
              expected.toLocaleString("ko-KR") + "원",
              "2026년도 예산 및 기금운용계획 집행지침 - 특근매식비",
              `인정시간 ${options.mealMinHours}시간 이상 시 ${options.mealRate.toLocaleString("ko-KR")}원, 출장 식비 지급 시 특근매식비 제외`,
              expected, actual - expected,
              travelMeal || !eligible
                ? "제2편 Ⅲ. 비목별 지침 → 1. 운영비 → 1-5. 특근매식비(210-05목) → 가. 지급대상자"
                : "제2편 Ⅲ. 비목별 지침 → 1. 운영비 → 1-5. 특근매식비(210-05목) → 가. 지급대상자 / 나. 지급단가 및 집행방법"
            );
          }
        }
      }

      if (options.mode !== "meal" && hasColumn("tripType")) {
        const type = travelKind(displayValue(sheet[encodeAddress(rowIndex, column("tripType"))]));
        if (type === "external") {
          auditExternal(rowIndex);
        } else if (type === "unknown") {
          review(rowIndex, "tripType", "출장구분을 확인할 수 없습니다. 근무지내 또는 근무지외로 지정하세요. 국외출장은 이 국내출장 검사 대상이 아닙니다.", "제18조제2항 및 별표 2");
        } else if (type === "local") {
          if (!hasColumn("tripHours") || !hasColumn("travelAmount")) {
            review(rowIndex, "tripHours", "근무지 내 출장의 출장시간과 실제 정산액 열을 지정해야 합니다.", "제18조제1항");
            continue;
          }
          const hours = numericValue(sheet[encodeAddress(rowIndex, column("tripHours"))]);
          const actual = numericValue(sheet[encodeAddress(rowIndex, column("travelAmount"))]);
          const usedPublicVehicle = hasColumn("publicVehicle")
            ? yesNo(displayValue(sheet[encodeAddress(rowIndex, column("publicVehicle"))]))
            : null;
          if (usedPublicVehicle === null) {
            review(rowIndex, "publicVehicle", "공용차량 이용 여부가 Y/N으로 확인되지 않아 근무지 내 여비의 1만원 감액 적용 여부를 판단할 수 없습니다.", "제18조제1항 단서");
          } else if (hours !== null && hours > 0) {
            const baseAmount = hours >= 4 ? options.localLongRate : options.localShortRate;
            const deduction = usedPublicVehicle ? options.publicVehicleDeduction : 0;
            const expected = Math.max(0, baseAmount - deduction);
            const vehicleText = usedPublicVehicle ? `, 공용차량 이용으로 ${deduction.toLocaleString("ko-KR")}원 감액` : "";
            if (actual === null) {
              pushIssue(
                rowIndex, column("travelAmount"),
                `근무지 내 출장시간이 ${hours}시간${vehicleText}되어 ${expected.toLocaleString("ko-KR")}원이 적용되어야 하나 실제 정산액이 비어 있습니다.`,
                expected.toLocaleString("ko-KR") + "원",
                "공무원 여비 규정 - 근무지 내 국내출장",
                `출장시간 4시간 미만 ${options.localShortRate.toLocaleString("ko-KR")}원, 4시간 이상 ${options.localLongRate.toLocaleString("ko-KR")}원, 공용차량 이용 시 ${options.publicVehicleDeduction.toLocaleString("ko-KR")}원 감액`,
                expected, -expected,
                usedPublicVehicle ? "제18조제1항 본문 및 단서" : "제18조제1항 본문"
              );
            } else if (Math.abs(actual - expected) > 0.01) {
              const timeBand = hours >= 4 ? "4시간 이상" : "4시간 미만";
              pushIssue(
                rowIndex, column("travelAmount"),
                `근무지 내 출장시간이 ${hours}시간으로 ${timeBand} 기준${vehicleText}인 ${expected.toLocaleString("ko-KR")}원이 적용되어야 하나 실제 ${actual.toLocaleString("ko-KR")}원으로 정산되어 ${Math.abs(actual - expected).toLocaleString("ko-KR")}원 ${actual < expected ? "부족" : "초과"}합니다.`,
                expected.toLocaleString("ko-KR") + "원",
                "공무원 여비 규정 - 근무지 내 국내출장",
                `출장시간 4시간 미만 ${options.localShortRate.toLocaleString("ko-KR")}원, 4시간 이상 ${options.localLongRate.toLocaleString("ko-KR")}원, 공용차량 이용 시 ${options.publicVehicleDeduction.toLocaleString("ko-KR")}원 감액`,
                expected, actual - expected,
                usedPublicVehicle ? "제18조제1항 본문 및 단서" : "제18조제1항 본문"
              );
            }
          } else {
            review(rowIndex, "tripHours", "근무지 내 출장시간이 없거나 0 이하이므로 시간별 지급액을 판정하지 못했습니다.", "제18조제1항");
          }
        }
      }
    }

    return { issues, scannedRows: dataRows.length };
  }

  return {
    auditWorksheet,
    auditRegulations,
    travelKind,
    inTravelScope,
    normalizeFormula,
    translateFormula,
    encodeAddress,
    encodeColumn,
    decodeAddress,
    displayValue,
    hasValue,
  };
});
