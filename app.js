(function () {
  "use strict";

  const state = {
    workbook: null,
    file: null,
    range: null,
    results: null,
    filter: "ALL",
    selectedFixes: new Set(),
    auditMode: "travel",
    modeManuallySelected: false,
    mappingContext: "",
  };
  let resultScrollTimer = null;

  function scheduleResultScroll() {
    clearTimeout(resultScrollTimer);
    resultScrollTimer = setTimeout(() => {
      if (state.results && !elements.resultsPanel.classList.contains("hidden")) {
        elements.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 850);
  }

  document.addEventListener("scan-character-ready", scheduleResultScroll);

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const elements = {
    fileInput: $("#fileInput"),
    dropzone: $("#dropzone"),
    fileCard: $("#fileCard"),
    fileName: $("#fileName"),
    fileInfo: $("#fileInfo"),
    loadError: $("#loadError"),
    settingsPanel: $("#settingsPanel"),
    resultsPanel: $("#resultsPanel"),
    sheetSelect: $("#sheetSelect"),
    headerRowInput: $("#headerRowInput"),
    startRowInput: $("#startRowInput"),
    keyColumnSelect: $("#keyColumnSelect"),
    formulaColumns: $("#formulaColumns"),
    resultBody: $("#resultBody"),
    emptyResult: $("#emptyResult"),
    resultTableWrap: $("#resultTableWrap"),
    resultSearch: $("#resultSearch"),
  };

  const auditModes = {
    meal: {
      label: "특근매식비",
      description: "인정시간과 출장 식비 지급 여부를 기준으로 특근매식비 기대금액을 계산합니다.",
      hint: "특근매식비의 인정시간·지급액·출장 식비 중복 여부를 확인합니다.",
      scope: "출장 식비 지급 여부가 없는 자료에서는 중복 여부를 확인할 수 없습니다. 출장비 파일과의 자동 교차 대조는 포함되지 않습니다.",
    },
    travel: {
      label: "출장비",
      description: "근무지 내·외를 행별로 구분해 적용합니다. 근무지 내는 정액·1만원 감액, 근무지 외는 일비·식비·숙박비·운임을 항목별로 확인합니다.",
      hint: "근무지 내·외 함께 검사하거나 한 구분만 선택할 수 있습니다. 근무지 외 공용차량 감액은 일비에만 적용합니다.",
      scope: "근무지 외는 지급등급·출장일수·밤별 숙박 증빙·운임 인정액 등 자료가 필요합니다. 누락값과 장기체재·특례 등은 자료 확인 필요로 분리합니다. 교통수단 적정성·증빙 진위·모든 예외 승인을 자동 판정하는 기능은 아닙니다.",
    },
  };

  function clearAuditResults() {
    clearTimeout(resultScrollTimer);
    state.results = null;
    state.selectedFixes = new Set();
    elements.resultsPanel.classList.add("hidden");
  }

  function updateModeUi() {
    const mode = auditModes[state.auditMode];
    document.body.dataset.theme = state.auditMode === "travel" ? "osaka-jade" : "rose-light";
    $("#auditModeSwitch").dataset.mode = state.auditMode;
    $("#settingsPanel").dataset.auditMode = state.auditMode;
    $$("[data-audit-mode]").forEach((button) => {
      const active = button.dataset.auditMode === state.auditMode;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $("#auditWorkspace").setAttribute("aria-labelledby", state.auditMode === "meal" ? "mealAuditTab" : "travelAuditTab");
    $$("[data-mode-field]").forEach((field) => {
      const active = field.dataset.modeField === state.auditMode;
      field.classList.toggle("hidden", !active);
      field.querySelectorAll("input, select").forEach((input) => { input.disabled = !active; });
    });
    $("#uploadTitle").textContent = `${mode.label} 정산 엑셀 불러오기`;
    $("#uploadPrompt").textContent = `${mode.label} 파일을 끌어놓거나 눌러서 선택하세요`;
    $("#settingsTitle").textContent = `${mode.label} 검사 범위 확인`;
    $("#ruleModeDescription").textContent = mode.description;
    $("#auditModeHint").textContent = mode.hint;
    $("#modeScopeNote").textContent = mode.scope;
    $("#scanButton").textContent = `${mode.label} 정산 검사하기`;
    $("#sampleButton").textContent = "테스트용 정산 샘플 엑셀 받기";
    updateTravelScopeUi();
  }

  function updateTravelScopeUi() {
    const scope = $("#travelScopeSelect").value;
    $$("[data-travel-section]").forEach((section) => {
      const visible = state.auditMode === "travel" && (scope === "all" || scope === section.dataset.travelSection);
      section.classList.toggle("hidden", !visible);
      section.querySelectorAll("input, select").forEach((input) => { input.disabled = !visible; });
    });
  }

  $("#travelScopeSelect").addEventListener("change", () => {
    clearAuditResults();
    updateTravelScopeUi();
    if ($("#travelScopeSelect").value === "external") $("#externalTravelSettings").open = true;
  });

  function selectAuditMode(mode, manual) {
    if (!auditModes[mode]) return;
    if (manual) state.modeManuallySelected = true;
    state.auditMode = mode;
    clearError();
    clearAuditResults();
    updateModeUi();
    if (state.workbook) updateColumns();
  }

  $("#auditModeSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-audit-mode]");
    if (button) selectAuditMode(button.dataset.auditMode, true);
  });
  $("#auditModeSwitch").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === "Home" ? "travel" : event.key === "End" ? "meal" : state.auditMode === "meal" ? "travel" : "meal";
    selectAuditMode(mode, true);
    document.querySelector(`[data-audit-mode="${mode}"]`).focus();
  });
  updateModeUi();

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function showError(message) {
    elements.loadError.textContent = message;
    elements.loadError.classList.remove("hidden");
  }

  function clearError() {
    elements.loadError.textContent = "";
    elements.loadError.classList.add("hidden");
  }

  function getSheet() {
    return state.workbook.Sheets[elements.sheetSelect.value];
  }

  function decodeRange(sheet) {
    if (!sheet || !sheet["!ref"]) return { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    return XLSX.utils.decode_range(sheet["!ref"]);
  }

  function detectHeaderRow(sheet, range) {
    let bestRow = range.s.r;
    let bestScore = -1;
    const limit = Math.min(range.e.r, range.s.r + 14);
    for (let row = range.s.r; row <= limit; row += 1) {
      let values = 0;
      let textValues = 0;
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[FormulaAudit.encodeAddress(row, column)];
        if (FormulaAudit.hasValue(cell)) {
          values += 1;
          if (typeof cell.v === "string") textValues += 1;
        }
      }
      const score = values + textValues * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }
    return bestRow + 1;
  }

  function columnLabel(sheet, headerRow, columnIndex) {
    const cell = sheet[FormulaAudit.encodeAddress(headerRow - 1, columnIndex)];
    const value = FormulaAudit.displayValue(cell).trim();
    return FormulaAudit.encodeColumn(columnIndex) + " · " + (value || "제목 없음");
  }

  function findFormulaCounts(sheet, range, startRow) {
    const counts = new Map();
    for (let column = range.s.c; column <= range.e.c; column += 1) counts.set(column, 0);
    for (let row = startRow - 1; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const cell = sheet[FormulaAudit.encodeAddress(row, column)];
        if (cell && cell.f) counts.set(column, counts.get(column) + 1);
      }
    }
    return counts;
  }

  function populateConfiguration() {
    clearAuditResults();
    state.mappingContext = "";
    const sheet = getSheet();
    const range = decodeRange(sheet);
    state.range = range;
    const headerRow = detectHeaderRow(sheet, range);
    elements.headerRowInput.value = headerRow;
    elements.startRowInput.value = Math.min(range.e.r + 1, headerRow + 1);
    updateColumns();
  }

  function updateColumns() {
    clearAuditResults();
    const sheet = getSheet();
    const range = decodeRange(sheet);
    const headerRow = Math.max(1, Number(elements.headerRowInput.value) || 1);
    const startRow = Math.max(headerRow + 1, Number(elements.startRowInput.value) || headerRow + 1);
    const headers = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      headers.push(normalizedHeader(FormulaAudit.displayValue(sheet[FormulaAudit.encodeAddress(headerRow - 1, column)])));
    }
    if (!state.modeManuallySelected) {
      const hasMealAmount = headers.some((text) => /매식비/.test(text) && !/대상|여부/.test(text));
      const hasTripAmount = headers.some((text) => /출장여비|출장비/.test(text));
      if (hasMealAmount && !hasTripAmount) state.auditMode = "meal";
      else if (hasTripAmount && !hasMealAmount) state.auditMode = "travel";
      updateModeUi();
    }
    const previousKey = elements.keyColumnSelect.value;
    elements.keyColumnSelect.innerHTML = "";

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const option = document.createElement("option");
      option.value = String(column);
      option.textContent = columnLabel(sheet, headerRow, column);
      elements.keyColumnSelect.appendChild(option);
    }
    elements.keyColumnSelect.value = previousKey && Number(previousKey) <= range.e.c ? previousKey : String(range.s.c);

    const formulaCounts = findFormulaCounts(sheet, range, startRow);
    elements.formulaColumns.innerHTML = "";
    let found = 0;
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const count = formulaCounts.get(column) || 0;
      if (!count) continue;
      const title = normalizedHeader(FormulaAudit.displayValue(sheet[FormulaAudit.encodeAddress(headerRow - 1, column)]));
      if (state.auditMode === "meal" && /출장여비|출장비|출장시간|운임|숙박|공용차량|관용차량|^일비$|^식비$/.test(title)) continue;
      if (state.auditMode === "travel" && /매식비|초과근무|인정시간|지급대상/.test(title)) continue;
      found += 1;
      const label = document.createElement("label");
      label.className = "column-check";
      label.innerHTML = `<input type="checkbox" value="${column}" checked><span title="${escapeHtml(columnLabel(sheet, headerRow, column))}">${escapeHtml(columnLabel(sheet, headerRow, column))}</span><em>${count}개</em>`;
      elements.formulaColumns.appendChild(label);
    }
    if (!found) {
      elements.formulaColumns.innerHTML = '<p class="no-formula">선택한 검사 유형에 해당하는 수식 열이 없습니다. 규정·금액 검증은 필요한 열을 지정하면 실행할 수 있습니다.</p>';
    }
    populateRuleMappings(sheet, range, headerRow);
  }

  function normalizedHeader(value) {
    return String(value || "").replace(/\s+/g, "").toLowerCase();
  }

  function populateRuleMappings(sheet, range, headerRow) {
    const context = `${elements.sheetSelect.value}:${headerRow}`;
    const preserve = state.mappingContext === context;
    const definitions = [
      ["hoursColumnSelect", ["인정시간", "초과근무시간", "인정근무시간"]],
      ["travelMealColumnSelect", ["출장식비지급", "출장식비", "식비지급"]],
      ["specialAmountColumnSelect", ["특근매식비", "매식비금액", "특근매식비금액"]],
      ["tripTypeColumnSelect", ["출장구분", "출장종류"]],
      ["tripHoursColumnSelect", ["출장시간", "출장소요시간"]],
      ["travelAmountColumnSelect", ["출장여비", "출장비", "출장여비금액", "출장여비합계"]],
      ["publicVehicleColumnSelect", ["공용차량이용", "공용차량", "관용차량이용", "관용차량"]],
      ["tripDaysColumnSelect", ["출장일수", "여행일수"]],
      ["tripNightsColumnSelect", ["숙박일수", "숙박박수", "숙박수"]],
      ["travelGradeColumnSelect", ["여비지급등급", "여비등급", "지급등급"]],
      ["publicVehicleDaysColumnSelect", ["공용차량이용일수", "관용차량이용일수"]],
      ["dailyAmountColumnSelect", ["일비", "일비지급액", "일비실제액"]],
      ["mealAmountColumnSelect", ["식비", "식비지급액", "식비실제액"]],
      ["lodgingAmountColumnSelect", ["숙박비", "숙박비지급액", "숙박비실제액"]],
      ["fareAmountColumnSelect", ["운임", "교통비", "운임지급액"]],
      ["mealDeductionColumnSelect", ["식비공제액", "식비감액", "식비감액액"]],
      ["fareEvidenceColumnSelect", ["운임증빙인정액", "운임인정액", "교통비인정액"]],
      ["lodgingEvidenceColumnSelect", ["밤별숙박증빙액", "숙박증빙액", "숙박비증빙액"]],
      ["lodgingRegionColumnSelect", ["숙박지역", "숙박지"]],
      ["travelExceptionColumnSelect", ["예외사항", "특례사항", "예외특례"]],
    ];
    for (const [id, aliases] of definitions) {
      const select = document.getElementById(id);
      const previous = select.value;
      select.innerHTML = '<option value="-1">선택 안 함</option>';
      let detected = -1;
      let bestScore = 0;
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const label = columnLabel(sheet, headerRow, column);
        const headerText = FormulaAudit.displayValue(sheet[FormulaAudit.encodeAddress(headerRow - 1, column)]);
        const option = document.createElement("option");
        option.value = String(column);
        option.textContent = label;
        select.appendChild(option);
        const normalized = normalizedHeader(headerText);
        const exact = aliases.some((alias) => normalized === normalizedHeader(alias));
        const partial = aliases.some((alias) => normalized.includes(normalizedHeader(alias)));
        const score = exact ? 2 : partial ? 1 : 0;
        if (score > bestScore) { detected = column; bestScore = score; }
      }
      select.value = preserve && previous && [...select.options].some((option) => option.value === previous)
        ? previous
        : String(detected);
    }
    state.mappingContext = context;
    if (state.auditMode === "travel" && Number($("#tripTypeColumnSelect").value) >= 0) {
      const typeCol = Number($("#tripTypeColumnSelect").value);
      let hasExternalRows = false;
      for (let row = Number(elements.startRowInput.value) - 1; row <= range.e.r; row += 1) {
        if (FormulaAudit.travelKind(FormulaAudit.displayValue(sheet[FormulaAudit.encodeAddress(row, typeCol)])) === "external") {
          hasExternalRows = true;
          break;
        }
      }
      $("#externalTravelSettings").open = hasExternalRows || $("#travelScopeSelect").value === "external";
    }
  }

  async function loadFile(file) {
    clearTimeout(resultScrollTimer);
    clearError();
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls|xlsb)$/i.test(file.name)) {
      showError("지원하지 않는 파일입니다. XLSX, XLSM, XLS 또는 XLSB 파일을 선택하세요.");
      return;
    }
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, {
        type: "array",
        cellFormula: true,
        cellDates: true,
        cellNF: true,
        // Excel이 계산 결과를 저장하지 않은 수식 셀도 보존한다.
        sheetStubs: true,
      });
      if (!workbook.SheetNames.length) throw new Error("읽을 수 있는 시트가 없습니다.");
      state.workbook = workbook;
      state.file = file;
      state.mappingContext = "";
      elements.fileName.textContent = file.name;
      elements.fileInfo.textContent = `${formatBytes(file.size)} · 시트 ${workbook.SheetNames.length}개`;
      elements.fileCard.classList.remove("hidden");
      elements.sheetSelect.innerHTML = workbook.SheetNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
      elements.settingsPanel.classList.remove("hidden");
      elements.resultsPanel.classList.add("hidden");
      populateConfiguration();
      elements.settingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      showError("엑셀 파일을 읽지 못했습니다. 암호가 설정되었거나 손상된 파일인지 확인하세요. (" + error.message + ")");
    }
  }

  function resetFile() {
    clearTimeout(resultScrollTimer);
    state.workbook = null;
    state.file = null;
    state.results = null;
    state.mappingContext = "";
    elements.fileInput.value = "";
    elements.fileCard.classList.add("hidden");
    elements.settingsPanel.classList.add("hidden");
    elements.resultsPanel.classList.add("hidden");
    clearError();
  }

  function selectedFormulaColumns() {
    return $$("#formulaColumns input[type='checkbox']:checked").map((input) => Number(input.value));
  }

  function runScan() {
    clearTimeout(resultScrollTimer);
    clearError();
    const formulaColumns = selectedFormulaColumns();
    const useRules = $("#ruleCheck").checked;
    if (!formulaColumns.length && !useRules) {
      showError("검사할 수식 열을 선택하거나 규정 검증을 사용하세요.");
      elements.settingsPanel.scrollIntoView({ behavior: "smooth" });
      return;
    }
    const sheet = getSheet();
    const range = decodeRange(sheet);
    const headerRow = Number(elements.headerRowInput.value);
    const startRow = Number(elements.startRowInput.value);
    if (!headerRow || !startRow || startRow <= headerRow) {
      showError("첫 데이터 행은 제목 행보다 커야 합니다.");
      return;
    }
    if (useRules) {
      const required = state.auditMode === "meal"
        ? [["hoursColumnSelect", "인정시간"], ["specialAmountColumnSelect", "특근매식비 실제액"]]
        : [["tripTypeColumnSelect", "출장구분"]];
      const missing = required.filter(([id]) => Number(document.getElementById(id).value) < 0);
      if (missing.length) {
        showError(`${auditModes[state.auditMode].label} 검사에 필요한 열을 지정해 주세요: ${missing.map(([, label]) => label).join(", ")}`);
        return;
      }
    }
    const formulaResult = FormulaAudit.auditWorksheet(sheet, {
      range,
      headerRow,
      startRow,
      endRow: range.e.r + 1,
      keyColumn: Number(elements.keyColumnSelect.value),
      formulaColumns,
      checkPattern: $("#patternCheck").checked,
      checkHardcode: $("#hardcodeCheck").checked,
      rowFilter: state.auditMode === "travel"
        ? (row) => FormulaAudit.inTravelScope(sheet, row, Number($("#tripTypeColumnSelect").value), $("#travelScopeSelect").value)
        : null,
      rowGroup: state.auditMode === "travel"
        ? (row) => FormulaAudit.travelKind(FormulaAudit.displayValue(sheet[FormulaAudit.encodeAddress(row, Number($("#tripTypeColumnSelect").value))]))
        : null,
    });
    let ruleResult = { issues: [], scannedRows: formulaResult.scannedRows };
    if (useRules) {
      ruleResult = FormulaAudit.auditRegulations(sheet, {
        mode: state.auditMode,
        travelScope: $("#travelScopeSelect").value,
        range,
        headerRow,
        startRow,
        endRow: range.e.r + 1,
        keyColumn: Number(elements.keyColumnSelect.value),
        columns: {
          hours: Number($("#hoursColumnSelect").value),
          travelMeal: Number($("#travelMealColumnSelect").value),
          specialAmount: Number($("#specialAmountColumnSelect").value),
          tripType: Number($("#tripTypeColumnSelect").value),
          tripHours: Number($("#tripHoursColumnSelect").value),
          travelAmount: Number($("#travelAmountColumnSelect").value),
          publicVehicle: Number($("#publicVehicleColumnSelect").value),
          tripDays: Number($("#tripDaysColumnSelect").value),
          tripNights: Number($("#tripNightsColumnSelect").value),
          travelGrade: Number($("#travelGradeColumnSelect").value),
          publicVehicleDays: Number($("#publicVehicleDaysColumnSelect").value),
          dailyAmount: Number($("#dailyAmountColumnSelect").value),
          mealAmount: Number($("#mealAmountColumnSelect").value),
          lodgingAmount: Number($("#lodgingAmountColumnSelect").value),
          fareAmount: Number($("#fareAmountColumnSelect").value),
          mealDeduction: Number($("#mealDeductionColumnSelect").value),
          fareEvidence: Number($("#fareEvidenceColumnSelect").value),
          lodgingEvidence: Number($("#lodgingEvidenceColumnSelect").value),
          lodgingRegion: Number($("#lodgingRegionColumnSelect").value),
          travelException: Number($("#travelExceptionColumnSelect").value),
        },
        mealMinHours: Number($("#mealMinHours").value),
        mealRate: Number($("#mealRate").value),
        localShortRate: Number($("#localShortRate").value),
        localLongRate: Number($("#localLongRate").value),
        publicVehicleDeduction: Number($("#publicVehicleDeduction").value),
        externalGradeDefault: $("#externalGradeDefault").value,
        externalDailyRate: Number($("#externalDailyRate").value),
        externalMealRate: Number($("#externalMealRate").value),
        externalVehicleRatio: Number($("#externalVehiclePercent").value) / 100,
        lodgingSeoulCap: Number($("#lodgingSeoulCap").value),
        lodgingMetroCap: Number($("#lodgingMetroCap").value),
        lodgingOtherCap: Number($("#lodgingOtherCap").value),
      });
    }
    state.results = {
      ...formulaResult,
      issues: [...ruleResult.issues, ...formulaResult.issues],
      ruleIssueCount: ruleResult.issues.filter((issue) => issue.type === "REGULATION").length,
      reviewIssueCount: ruleResult.issues.filter((issue) => issue.type === "REVIEW").length,
      auditMode: state.auditMode,
    };
    state.results.issues.forEach((issue, index) => {
      issue.id = "issue-" + index;
      issue.sheetName = elements.sheetSelect.value;
    });
    state.selectedFixes = new Set();
    state.results.sheetName = elements.sheetSelect.value;
    state.filter = "ALL";
    elements.resultSearch.value = "";
    $$(".filter").forEach((button) => button.classList.toggle("active", button.dataset.filter === "ALL"));
    renderResults();
    elements.resultsPanel.classList.remove("hidden");
    // 캐릭터 효과(1.5초)의 페이드아웃 구간에 결과 이동을 시작한다.
    // 효과가 있는 환경에서는 이미지 로딩 완료 이벤트를 기준으로 이동한다.
    // effects.js를 사용할 수 없을 때도 결과 이동은 유지한다.
    if (document.querySelector("#scanButton .scan-character-effect")) {
      return;
    }
    scheduleResultScroll();
  }

  function issueLabel(type) {
    if (type === "REVIEW") return "자료 확인 필요";
    if (type === "REGULATION") return "규정·금액 오류";
    if (type === "MISSING") return "수식 누락";
    if (type === "HARDCODE") return "값 직접 입력";
    return "패턴 이상";
  }

  function renderResults() {
    const result = state.results;
    if (!result) return;
    const issueCount = result.issues.length;
    const affectedRows = new Set(result.issues.map((issue) => issue.row)).size;
    const passRate = result.scannedRows ? Math.max(0, (result.scannedRows - affectedRows) / result.scannedRows * 100) : 0;
    $("#scannedRowsStat").textContent = result.scannedRows.toLocaleString("ko-KR");
    $("#checkedCellsStat").textContent = result.checkedCells.toLocaleString("ko-KR");
    $("#issuesStat").textContent = issueCount.toLocaleString("ko-KR");
    $("#ruleIssuesStat").textContent = (result.ruleIssueCount || 0).toLocaleString("ko-KR");
    $("#reviewIssuesStat").textContent = (result.reviewIssueCount || 0).toLocaleString("ko-KR");
    $("#passRateStat").textContent = passRate.toFixed(1) + "%";
    const modeLabel = auditModes[result.auditMode || "meal"].label;
    if (!result.scannedRows) {
      $("#resultSummary").textContent = `[${modeLabel}] 선택한 검사 구분에 해당하는 데이터 행이 없습니다. 출장구분·검사 범위·행 식별 열을 확인하세요.`;
      renderIssueTable();
      return;
    }
    $("#resultSummary").textContent = issueCount
      ? `[${modeLabel}] ${result.sheetName} 시트에서 확인 항목 ${issueCount}건을 찾았습니다. 같은 셀에 여러 항목이 있을 수 있습니다.`
      : `[${modeLabel}] ${result.sheetName} 시트의 선택한 검사 범위에서 이상을 찾지 못했습니다. 모든 지급요건의 적합성을 보장하는 것은 아닙니다.`;
    renderIssueTable();
  }

  function renderIssueTable() {
    const search = elements.resultSearch.value.trim().toLowerCase();
    const issues = (state.results ? state.results.issues : []).filter((issue) => {
      const filterMatches = state.filter === "ALL" || issue.type === state.filter;
      const text = [issue.key, issue.address, issue.header, issue.message, issue.current].join(" ").toLowerCase();
      return filterMatches && (!search || text.includes(search));
    });

    elements.emptyResult.classList.toggle("hidden", state.results.issues.length !== 0);
    elements.resultTableWrap.classList.toggle("hidden", state.results.issues.length === 0);
    elements.resultBody.innerHTML = issues.map((issue) => `
      <tr>
        <td>${issue.fixType ? `<input class="fix-check" type="checkbox" data-fix-id="${issue.id}" ${state.selectedFixes.has(issue.id) ? "checked" : ""} aria-label="${issue.address} 수정 선택">` : '<span class="no-fix">-</span>'}</td>
        <td><span class="status ${issue.type.toLowerCase()}">${issueLabel(issue.type)}</span></td>
        <td>${issue.row}</td>
        <td>${escapeHtml(issue.key || "-")}</td>
        <td>${escapeHtml(issue.header)} <small>(${issue.column})</small></td>
        <td><b>${issue.address}</b></td>
        <td class="reason-cell">${escapeHtml(issue.message)}${issue.difference && issue.difference !== "-" ? `<br><b>차액: ${escapeHtml(issue.difference)}</b>` : ""}</td>
        <td class="rule-basis"><b>${escapeHtml(issue.ruleName || "검사 기준")}</b>${issue.ruleCitation ? `<button type="button" class="rule-citation rule-citation-button" data-rule-issue="${issue.id}" aria-haspopup="dialog">${escapeHtml(issue.ruleCitation)} <span class="citation-hint">원문 보기 ↗</span></button>` : '<span class="rule-citation">법령 조항 해당 없음 · 엑셀 자체 점검</span>'}<small>${escapeHtml(issue.ruleText || "-")}</small></td>
        <td class="formula-text">${escapeHtml(issue.current || "(빈 셀)")}</td>
        <td class="correction"><b>${escapeHtml(issue.correction || "직접 확인 필요")}</b><small>${escapeHtml(issue.expected || "-")}</small></td>
      </tr>`).join("");
    if (!issues.length && state.results.issues.length) {
      elements.resultBody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#687687;padding:35px">검색 조건에 맞는 결과가 없습니다.</td></tr>';
    }
    updateFixSelectionUi();
  }

  function fixableIssues() {
    return state.results ? state.results.issues.filter((issue) => issue.fixType) : [];
  }

  const regulationDialog = $("#regulationDialog");
  let regulationTrigger = null;
  let activeDocumentId = null;
  let showingOriginalPdf = false;

  function storedDocuments() {
    return window.RegulationDocuments || {};
  }

  function populateRegulationDocuments() {
    const select = $("#regulationDocumentSelect");
    select.innerHTML = "";
    for (const [id, source] of Object.entries(storedDocuments())) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = source.title;
      select.appendChild(option);
    }
  }

  function localDocumentUrl(path) {
    return new URL(path.split("/").map(encodeURIComponent).join("/"), document.baseURI).href;
  }

  function renderOriginalPage(pageNumber) {
    const source = storedDocuments()[activeDocumentId];
    if (!source) return;
    const page = source.pages.find((item) => item.number === Number(pageNumber)) || source.pages[0];
    const select = $("#regulationPageSelect");
    select.value = String(page.number);
    const image = $("#regulationPageImage");
    image.src = localDocumentUrl(page.image);
    image.alt = `${source.title} · 원본 PDF ${page.number}쪽`;
    const pdfUrl = localDocumentUrl(source.pdf) + `#page=${page.number}&view=FitH`;
    $("#regulationDialogSource").href = pdfUrl;
    $("#regulationPageLabel").textContent = `원본 PDF ${source.pageCount}쪽 중 ${page.number}쪽${page.printedPage ? ` (책자 ${page.printedPage}쪽)` : ""} · 관련 조항 주변 페이지 미리보기`;
    const index = source.pages.indexOf(page);
    $("#regulationPagePrevious").disabled = index === 0;
    $("#regulationPageNext").disabled = index === source.pages.length - 1;
    if (showingOriginalPdf) $("#regulationPdfFrame").src = pdfUrl;
  }

  function selectRegulationDocument(sourceId, preferredPage) {
    const source = storedDocuments()[sourceId];
    if (!source) return;
    activeDocumentId = sourceId;
    showingOriginalPdf = false;
    $("#regulationDocumentSelect").value = sourceId;
    $("#regulationDialogTitle").textContent = source.title;
    $("#regulationDialogMeta").textContent = `첨부 원문 저장일: ${source.storedAt} · 원본 형식: ${source.original.split(".").pop().toUpperCase()} · 인터넷 연결 불필요`;
    const select = $("#regulationPageSelect");
    select.innerHTML = "";
    for (const page of source.pages) {
      const option = document.createElement("option");
      option.value = String(page.number);
      option.textContent = `${page.number}쪽${page.number === source.defaultPage ? " (해당 조항)" : ""}`;
      select.appendChild(option);
    }
    $("#regulationPageImage").classList.remove("hidden");
    $("#regulationPdfFrame").classList.add("hidden");
    $("#regulationPdfFrame").removeAttribute("src");
    $("#regulationPdfToggle").textContent = "전체 PDF 보기";
    const excerpt = window.RegulationTexts && window.RegulationTexts[sourceId];
    $("#regulationExcerpt").hidden = !excerpt;
    $("#regulationExcerpt").open = false;
    $("#regulationDialogSections").innerHTML = excerpt ? excerpt.sections.map((section) =>
      `<section class="regulation-text-section"><h4>${escapeHtml(section.heading)}</h4><blockquote>${escapeHtml(section.text)}</blockquote></section>`
    ).join("") : "";
    renderOriginalPage(preferredPage || source.defaultPage);
  }

  function openStoredRegulation(sourceId, trigger, citation, page) {
    const source = storedDocuments()[sourceId];
    if (!source) {
      alert("저장된 원문을 찾지 못했습니다. 앱 폴더의 복무규정과 regulation-documents.js를 함께 보관해 주세요.");
      return;
    }
    clearTimeout(resultScrollTimer);
    regulationTrigger = trigger;
    populateRegulationDocuments();
    $("#regulationDialogCitation").textContent = citation || "첨부한 규정 원문 · 관련 조항 페이지";
    selectRegulationDocument(sourceId, page);
    if (!regulationDialog.open) regulationDialog.showModal();
    regulationDialog.scrollTop = 0;
  }

  function openRegulationDialog(issue, trigger) {
    const sourceId = issue.sourceId || (issue.ruleName.includes("공무원 여비") ? "travel18" : "meal");
    openStoredRegulation(sourceId, trigger, issue.ruleCitation, issue.sourcePage);
  }

  document.querySelectorAll("[data-regulation-document]").forEach((button) => {
    button.addEventListener("click", () => openStoredRegulation(button.dataset.regulationDocument, button));
  });
  $("#regulationDocumentSelect").addEventListener("change", (event) => {
    $("#regulationDialogCitation").textContent = "첨부한 규정 원문 · 관련 조항 페이지";
    selectRegulationDocument(event.target.value);
  });
  $("#regulationPageSelect").addEventListener("change", (event) => renderOriginalPage(event.target.value));
  function moveRegulationPage(direction) {
    const select = $("#regulationPageSelect");
    const index = select.selectedIndex + direction;
    if (index >= 0 && index < select.options.length) renderOriginalPage(select.options[index].value);
  }
  $("#regulationPagePrevious").addEventListener("click", () => moveRegulationPage(-1));
  $("#regulationPageNext").addEventListener("click", () => moveRegulationPage(1));
  $("#regulationPdfToggle").addEventListener("click", () => {
    showingOriginalPdf = !showingOriginalPdf;
    $("#regulationPageImage").classList.toggle("hidden", showingOriginalPdf);
    $("#regulationPdfFrame").classList.toggle("hidden", !showingOriginalPdf);
    $("#regulationPdfToggle").textContent = showingOriginalPdf ? "해당 페이지 이미지 보기" : "전체 PDF 보기";
    renderOriginalPage($("#regulationPageSelect").value);
  });

  elements.resultBody.addEventListener("click", (event) => {
    const trigger = event.target.closest("button[data-rule-issue]");
    if (!trigger || !state.results) return;
    const issue = state.results.issues.find((item) => item.id === trigger.dataset.ruleIssue);
    if (issue) openRegulationDialog(issue, trigger);
  });
  $("#closeRegulationDialog").addEventListener("click", () => regulationDialog.close());
  regulationDialog.addEventListener("click", (event) => {
    const rect = regulationDialog.getBoundingClientRect();
    if (event.target === regulationDialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
      regulationDialog.close();
    }
  });
  regulationDialog.addEventListener("close", () => {
    $("#regulationPdfFrame").removeAttribute("src");
    if (regulationTrigger && regulationTrigger.isConnected) regulationTrigger.focus({ preventScroll: true });
  });

  function updateFixSelectionUi() {
    const fixable = fixableIssues();
    $("#selectedFixCount").textContent = `선택 ${state.selectedFixes.size}건`;
    $("#selectAllFixes").checked = fixable.length > 0 && fixable.every((issue) => state.selectedFixes.has(issue.id));
    $("#selectAllFixes").indeterminate = state.selectedFixes.size > 0 && !$("#selectAllFixes").checked;
  }

  async function downloadFixedWorkbook() {
    if (!state.file || !state.results) return;
    const selected = state.results.issues.filter((issue) => state.selectedFixes.has(issue.id) && issue.fixType);
    if (!selected.length) {
      alert("수정본에 반영할 항목을 하나 이상 선택하세요.");
      return;
    }
    const conflictingFormula = selected.find((issue) => issue.fixType === "FORMULA" && state.results.issues.some((other) =>
      other.address === issue.address && other.sheetName === issue.sheetName && other.type === "REGULATION" && other.fixType === "VALUE" && !state.selectedFixes.has(other.id)
    ));
    if (conflictingFormula) {
      alert(`${conflictingFormula.address}에는 규정상 금액 오류도 있습니다. 수식 복원만으로 금액이 맞는다고 보장할 수 없으므로 해당 규정·금액 수정 항목도 함께 선택해 주세요.`);
      return;
    }
    try {
      const data = await state.file.arrayBuffer();
      const workbook = XLSX.read(data, {
        type: "array", cellFormula: true, cellDates: true, cellNF: true,
        sheetStubs: true, bookVBA: true,
      });

      // 같은 셀에서는 확인된 규정상 금액을 다수 수식 패턴보다 우선한다.
      const fixes = new Map();
      const changedCells = new Map();
      function markChanged(sheetName, address) {
        changedCells.set(sheetName + "!" + address, { sheetName, address });
      }
      for (const issue of selected) {
        const key = issue.sheetName + "!" + issue.address;
        const current = fixes.get(key);
        if (!current || (issue.type === "REGULATION" && issue.fixType === "VALUE")) fixes.set(key, issue);
      }

      for (const issue of fixes.values()) {
        const sheet = workbook.Sheets[issue.sheetName];
        if (!sheet) continue;
        const cell = sheet[issue.address] || {};
        const oldFormula = cell.f;
        const oldValue = cell.v;
        delete cell.w;
        if (issue.fixType === "FORMULA") {
          cell.f = issue.fixValue;
          cell.t = "n";
          delete cell.v;
        } else if (issue.fixType === "VALUE") {
          delete cell.f;
          cell.t = "n";
          cell.v = Number(issue.fixValue);
        }
        sheet[issue.address] = cell;
        if (oldFormula !== cell.f || oldValue !== cell.v) markChanged(issue.sheetName, issue.address);
      }

      // 항목 금액을 수정했으면 단순 SUM 합계의 저장값도 함께 갱신한다.
      // 임의의 Excel 수식은 계산하지 않으며, 값만 있는 합계는 임의로 덮어쓰지 않는다.
      if (state.results.auditMode === "travel") {
        const totalColumn = Number($("#travelAmountColumnSelect").value);
        const componentColumns = ["fareAmountColumnSelect", "dailyAmountColumnSelect", "mealAmountColumnSelect", "lodgingAmountColumnSelect"].map((id) => Number(document.getElementById(id).value)).sort((a, b) => a - b);
        const contiguous = componentColumns.every((col, index) => col >= 0 && (index === 0 || col === componentColumns[index - 1] + 1));
        if (contiguous && totalColumn >= 0) {
          const rows = new Set([...fixes.values()].map((issue) => issue.row));
          const sheet = workbook.Sheets[state.results.sheetName];
          for (const row of rows) {
            const total = sheet[FormulaAudit.encodeAddress(row - 1, totalColumn)];
            const sumFormula = `SUM(${FormulaAudit.encodeAddress(row - 1, componentColumns[0])}:${FormulaAudit.encodeAddress(row - 1, componentColumns[3])})`;
            if (total && total.f && total.f.replace(/\s+/g, "").toUpperCase() === sumFormula) {
              const values = componentColumns.map((col) => sheet[FormulaAudit.encodeAddress(row - 1, col)]?.v);
              if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
                const newTotal = values.reduce((a, b) => a + b, 0);
                if (total.v !== newTotal) markChanged(state.results.sheetName, FormulaAudit.encodeAddress(row - 1, totalColumn));
                total.v = newTotal;
                total.t = "n";
                delete total.w;
              }
            }
          }
        }
      }

      const originalExtension = (state.file.name.match(/\.([^.]+)$/) || ["", "xlsx"])[1].toLowerCase();
      // 색상 표시가 가능한 OOXML 형식으로 내보낸다. 매크로가 있으면 XLSM을 사용한다.
      const bookType = originalExtension === "xlsm" || workbook.vbaraw ? "xlsm" : "xlsx";
      const baseName = state.file.name.replace(/\.[^.]+$/, "");
      const bytes = XLSX.write(workbook, { type: "array", bookType });
      const styled = ExcelHighlight.apply(bytes, changedCells.values());
      const contentType = bookType === "xlsm"
        ? "application/vnd.ms-excel.sheet.macroEnabled.12"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const blob = new Blob([styled], { type: contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}_수정본.${bookType}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      alert("수정본을 만들지 못했습니다: " + error.message);
    }
  }

  function csvEscape(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCsv() {
    if (!state.results) return;
    const headers = ["정산 유형", "시트", "상태", "행", "식별값", "열", "열 제목", "셀 주소", "틀린 이유", "근거 규정", "근거 조항·지침 항목", "세부 기준", "차액", "현재 값 또는 수식", "권장 수정", "규정상 기대값"];
    const rows = state.results.issues.map((issue) => [
      auditModes[state.results.auditMode || "meal"].label,
      state.results.sheetName,
      issueLabel(issue.type),
      issue.row,
      issue.key,
      issue.column,
      issue.header,
      issue.address,
      issue.message,
      issue.ruleName || "",
      issue.ruleCitation || "법령 조항 해당 없음 · 엑셀 자체 점검",
      issue.ruleText || "",
      issue.difference || "",
      issue.current,
      issue.correction || "",
      issue.expected || "",
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const baseName = state.file.name.replace(/\.[^.]+$/, "");
    link.download = `${baseName}_수식검증결과.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function createSample() {
    if (state.auditMode === "travel") {
      const sheet = XLSX.utils.aoa_to_sheet([
        ["직원ID", "성명", "출장구분", "출장시간", "공용차량 이용", "출장여비", "출장일수", "숙박일수", "여비등급", "공용차량 이용일수", "일비", "식비", "숙박비", "운임", "식비 공제액", "운임 증빙 인정액", "밤별 숙박 증빙액", "숙박지역", "예외사항", "검토메모"],
        ["T001", "가상직원1", "근무지내", 5, "N", 10000, 1, 0, "제2호", 0, 0, 0, 0, 0, 0, 0, "", "", "N", "관내 1만원 부족"],
        ["T002", "가상직원2", "근무지외", 0, "Y", 220000, 2, 1, "제2호", 2, 40000, 50000, 100000, 30000, 0, 30000, "95000", "서울", "N", "관외 일비 감액·숙박비 오류"],
        ["T003", "가상직원3", "근무지외", 0, "N", 52500, 1, 0, "제2호", 0, 25000, 12500, 0, 15000, 0, 15000, "", "", "N", "관외 식비 12500원 부족"],
        ["T004", "가상직원4", "근무지외", 0, "N", 190000, 2, 1, "제2호", 0, 50000, 50000, 90000, 0, 0, 0, "90000", "부산", "N", "광역시 숙박 상한 1만원 초과"],
        ["T005", "가상직원5", "근무지외", 0, "Y", 197500, 2, 1, "제2호", 1, 37500, 50000, 70000, 40000, 0, 40000, "70000", "강릉", "N", "정상: 차량 이용일 1일만 일비 감액"],
        ["T006", "가상직원6", "근무지외", 0, "N", 100000, 2, 1, "제2호", 0, 50000, 50000, 0, 0, 0, 0, "", "서울", "N", "숙박 증빙 누락: 자료 확인 필요"],
        ["T007", "가상직원7", "근무지내", 4, "Y", 10000, 1, 0, "제2호", 1, 0, 0, 0, 0, 0, 0, "", "", "N", "정상: 관내 공용차량 1만원 감액"],
        ["T008", "가상직원8", "근무지내", 3, "N", 10000, 1, 0, "제2호", 0, 0, 0, 0, 0, 0, 0, "", "", "N", "정상"],
      ]);
      for (let row = 3; row <= 7; row += 1) {
        const address = `F${row}`;
        sheet[address] = { t: "n", f: `SUM(K${row}:N${row})`, v: sheet[address].v };
      }
      sheet["!cols"] = Array.from({ length: 20 }, (_, index) => ({ wch: index === 19 ? 40 : 18 }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "출장비정산");
      XLSX.writeFile(workbook, "교육용_근무지내외_출장비정산_검증샘플.xlsx");
      return;
    }
    const rows = [
      ["직원ID", "성명", "근무일", "초과근무시간", "출장식비지급", "특근매식비", "검토메모"],
      ["A001", "가상직원1", "2026-10-01", 3, "N", null, "정상 수식"],
      ["A002", "가상직원2", "2026-10-02", 2.5, "N", null, "수식 누락 시험"],
      ["A003", "가상직원3", "2026-10-03", 1, "N", null, "다른 수식 시험"],
      ["A004", "가상직원4", "2026-10-04", 4, "Y", 9000, "값 직접 입력 시험"],
      ["A005", "가상직원5", "2026-10-05", 2, "N", null, "정상 수식"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet.F2 = { t: "n", f: 'IF(AND(D2>=2,E2="N"),9000,0)', v: 9000 };
    sheet.F4 = { t: "n", f: 'IF(AND(D4>=3,E4="N"),9000,0)', v: 0 };
    sheet.F6 = { t: "n", f: 'IF(AND(D6>=2,E6="N"),9000,0)', v: 9000 };
    sheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 22 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "특근매식비정산");
    XLSX.writeFile(workbook, "교육용_특근매식비정산_검증샘플.xlsx");
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  elements.fileInput.addEventListener("change", (event) => loadFile(event.target.files[0]));
  elements.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropzone.classList.add("dragging"); });
  elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("dragging"));
  elements.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("dragging");
    loadFile(event.dataTransfer.files[0]);
  });
  $("#removeFileButton").addEventListener("click", resetFile);
  $("#sampleButton").addEventListener("click", createSample);
  elements.sheetSelect.addEventListener("change", populateConfiguration);
  elements.headerRowInput.addEventListener("change", () => {
    const header = Number(elements.headerRowInput.value) || 1;
    if (Number(elements.startRowInput.value) <= header) elements.startRowInput.value = header + 1;
    updateColumns();
  });
  elements.startRowInput.addEventListener("change", updateColumns);
  $("#selectAllButton").addEventListener("click", () => $$("#formulaColumns input").forEach((input) => { input.checked = true; }));
  $("#clearAllButton").addEventListener("click", () => $$("#formulaColumns input").forEach((input) => { input.checked = false; }));
  $("#scanButton").addEventListener("click", runScan);
  $("#exportButton").addEventListener("click", exportCsv);
  $("#downloadFixedButton").addEventListener("click", downloadFixedWorkbook);
  $("#selectAllFixes").addEventListener("change", (event) => {
    state.selectedFixes = event.target.checked
      ? new Set(fixableIssues().map((issue) => issue.id))
      : new Set();
    renderIssueTable();
  });
  elements.resultBody.addEventListener("change", (event) => {
    const input = event.target.closest("input[data-fix-id]");
    if (!input) return;
    if (input.checked) state.selectedFixes.add(input.dataset.fixId);
    else state.selectedFixes.delete(input.dataset.fixId);
    updateFixSelectionUi();
  });
  elements.resultSearch.addEventListener("input", renderIssueTable);
  $("#filterButtons").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    $$(".filter").forEach((item) => item.classList.toggle("active", item === button));
    renderIssueTable();
  });
})();
