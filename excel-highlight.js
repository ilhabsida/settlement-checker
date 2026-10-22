(function () {
  "use strict";

  // SheetJS CE가 생성한 XLSX/XLSM의 OOXML에 수정 표시만 추가한다.
  // 숫자 서식·테두리·정렬 등의 기존 셀 서식은 복제해 유지한다.
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const FILL_RGB = "FFFFF2CC";
  const FONT_RGB = "FFFF0000";

  function parseXml(bytes, label) {
    if (!bytes) throw new Error(`${label} 파일을 찾을 수 없습니다.`);
    const doc = new DOMParser().parseFromString(fflate.strFromU8(bytes), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error(`${label} XML을 읽지 못했습니다.`);
    return doc;
  }

  function children(element, name) {
    return Array.from(element.children).filter((child) => child.localName === name);
  }

  function writeXml(doc) {
    return fflate.strToU8(new XMLSerializer().serializeToString(doc));
  }

  function zipPath(base, target) {
    const parts = target.startsWith("/") ? [] : base.split("/").slice(0, -1);
    for (const part of target.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  }

  function apply(bytes, changes) {
    if (!window.fflate) throw new Error("수정 표시용 오프라인 라이브러리가 없습니다.");
    const targets = new Map();
    for (const change of changes) {
      if (!targets.has(change.sheetName)) targets.set(change.sheetName, new Set());
      targets.get(change.sheetName).add(change.address);
    }
    if (!targets.size) return new Uint8Array(bytes);

    const files = fflate.unzipSync(new Uint8Array(bytes));
    const styles = parseXml(files["xl/styles.xml"], "셀 서식");
    const namespace = styles.documentElement.namespaceURI || NS;
    const fonts = children(styles.documentElement, "fonts")[0];
    const fills = children(styles.documentElement, "fills")[0];
    const cellXfs = children(styles.documentElement, "cellXfs")[0];
    if (!fonts || !fills || !cellXfs) throw new Error("수정 표시를 적용할 셀 서식 표가 없습니다.");

    const fillId = children(fills, "fill").length;
    const fill = styles.createElementNS(namespace, "fill");
    const pattern = styles.createElementNS(namespace, "patternFill");
    pattern.setAttribute("patternType", "solid");
    const color = styles.createElementNS(namespace, "fgColor");
    color.setAttribute("rgb", FILL_RGB);
    pattern.appendChild(color);
    fill.appendChild(pattern);
    fills.appendChild(fill);
    fills.setAttribute("count", String(children(fills, "fill").length));

    const fontCache = new Map();
    const styleCache = new Map();
    function highlightedStyle(originalId) {
      if (styleCache.has(originalId)) return styleCache.get(originalId);
      const original = children(cellXfs, "xf")[originalId];
      if (!original) throw new Error(`셀 서식 ${originalId}을 찾을 수 없습니다.`);
      const fontId = Number(original.getAttribute("fontId") || 0);
      if (!fontCache.has(fontId)) {
        const originalFont = children(fonts, "font")[fontId];
        if (!originalFont) throw new Error("기존 글꼴 서식을 찾을 수 없습니다.");
        const newFont = originalFont.cloneNode(true);
        children(newFont, "color").forEach((node) => node.remove());
        const red = styles.createElementNS(namespace, "color");
        red.setAttribute("rgb", FONT_RGB);
        newFont.appendChild(red);
        const newFontId = children(fonts, "font").length;
        fonts.appendChild(newFont);
        fontCache.set(fontId, newFontId);
      }
      const xf = original.cloneNode(true);
      xf.setAttribute("fontId", String(fontCache.get(fontId)));
      xf.setAttribute("fillId", String(fillId));
      xf.setAttribute("applyFont", "1");
      xf.setAttribute("applyFill", "1");
      const styleId = children(cellXfs, "xf").length;
      cellXfs.appendChild(xf);
      styleCache.set(originalId, styleId);
      return styleId;
    }

    const workbook = parseXml(files["xl/workbook.xml"], "통합문서");
    const relationships = parseXml(files["xl/_rels/workbook.xml.rels"], "시트 연결");
    const relations = new Map(Array.from(relationships.documentElement.children).map((node) => [node.getAttribute("Id"), node.getAttribute("Target")]));
    let marked = 0;
    for (const sheet of workbook.getElementsByTagNameNS("*", "sheet")) {
      const addresses = targets.get(sheet.getAttribute("name"));
      if (!addresses) continue;
      const relationId = sheet.getAttributeNS(REL_NS, "id") || sheet.getAttribute("r:id");
      const target = relations.get(relationId);
      if (!target) throw new Error("수정할 시트의 연결 정보가 없습니다.");
      const path = zipPath("xl/workbook.xml", target);
      const xml = parseXml(files[path], "시트");
      for (const cell of xml.getElementsByTagNameNS("*", "c")) {
        if (!addresses.has(cell.getAttribute("r"))) continue;
        const styleId = Number(cell.getAttribute("s") || 0);
        cell.setAttribute("s", String(highlightedStyle(styleId)));
        marked += 1;
      }
      files[path] = writeXml(xml);
    }
    const expectedCount = Array.from(targets.values()).reduce((sum, set) => sum + set.size, 0);
    if (marked !== expectedCount) throw new Error("일부 수정 셀에 색상 표시를 적용하지 못했습니다. 파일은 저장하지 않았습니다.");
    fonts.setAttribute("count", String(children(fonts, "font").length));
    cellXfs.setAttribute("count", String(children(cellXfs, "xf").length));
    files["xl/styles.xml"] = writeXml(styles);
    return fflate.zipSync(files, { level: 6 });
  }

  window.ExcelHighlight = { apply, fillRgb: FILL_RGB, fontRgb: FONT_RGB };
})();
