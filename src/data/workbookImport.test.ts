import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isLegacySnapshot, parseWorkbook } from "./workbookImport";
import { demoSnapshot } from './demoFixture';
import { workflowDemo } from './workflowDemo';
import { mergeWorkflow } from './workflowMerge';

describe("legacy snapshot detector", () => {
  const book = (sheets: Record<string, unknown[][]>) => {
    const workbook = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
    return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  };

  it("claims the designed demo layout it can actually parse", () => {
    const bytes = readFileSync('public/demo/careflow-field-outreach-demo.xlsx');
    expect(isLegacySnapshot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBe(true);
  });

  it("leaves a plain outreach table to the format detector instead of demanding snapshot sheets", () => {
    // The exact shape of samples/ai-assistant/01: no Metadata, no Observations.
    expect(isLegacySnapshot(book({ '10月探訪': [['樓宇名稱', '探訪日期'], ['裕安樓', '2026-10-05']] }))).toBe(false);
    // A sheet merely named "Buildings" is not enough on its own.
    expect(isLegacySnapshot(book({ Buildings: [['名稱'], ['裕安樓']] }))).toBe(false);
    expect(isLegacySnapshot(book({ Metadata: [['key', 'value']] }))).toBe(true);
  });

  it("still reports missing sheets inside the layout it claims", () => {
    const result = parseWorkbook(book({ Metadata: [['key', 'value'], ['synthetic', 'true']] }));
    expect(result.issues.map((issue) => issue.code)).toContain('MISSING_SHEET');
  });
});

describe("workbook import", () => {
  it('retains numeric precision so both demo formats merge without false coordinate conflicts', () => {
    const bytes = readFileSync('public/demo/careflow-field-outreach-demo.xlsx');
    const result = parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(result.snapshot?.buildings.map(b => b.coordinates)).toEqual(demoSnapshot.buildings.map(b => b.coordinates));
    expect(mergeWorkflow(workflowDemo, result.snapshot!).snapshot).toEqual(workflowDemo);
    expect(mergeWorkflow(result.snapshot, workflowDemo).issues).toEqual([]);
  });
  it.each(['duplicate', 'extra', 'formula', 'unknown-sheet'])('rejects %s content instead of silently discarding it', kind => {
    const wb = XLSX.read(readFileSync('public/demo/careflow-field-outreach-demo.xlsx'));
    const sheet = wb.Sheets.Observations;
    const width = XLSX.utils.decode_range(sheet['!ref']!).e.c + 1;
    if (kind === 'duplicate' || kind === 'extra') XLSX.utils.sheet_add_aoa(sheet, [[kind === 'duplicate' ? 'coverage' : ''], ['important value']], { origin: { r: 0, c: width } });
    if (kind === 'formula') sheet.A2.f = '"replacement"';
    if (kind === 'unknown-sheet') XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['unhandled'], ['important value']]), 'Unknown');
    expect(parseWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })).snapshot).toBeUndefined();
  });
  it("parses the generated synthetic workbook in the browser-compatible parser", () => {
    const bytes = readFileSync("public/demo/careflow-field-outreach-demo.xlsx");
    const result = parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.snapshot?.buildings).toHaveLength(4);
    expect(result.snapshot?.buildings.map(b => b.footprint)).toEqual(demoSnapshot.buildings.map(b => b.footprint));
    expect(result.snapshot?.observations.length).toBeGreaterThan(20);
  });
  it("reports duplicate ids, inconsistent references, and invalid dates deterministically", () => {
    const bytes = readFileSync("public/demo/careflow-field-outreach-demo.xlsx"); const workbook = XLSX.read(bytes, { type: "buffer" });
    const buildings = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Buildings, { defval: "" }); buildings[1].id = buildings[0].id; workbook.Sheets.Buildings = XLSX.utils.json_to_sheet(buildings);
    const observations = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Observations, { defval: "" }); observations[0].occurredAt = "2026-02-31T18:00:00+08:00"; observations[1].floorId = "bldg-hoi-king-f2"; workbook.Sheets.Observations = XLSX.utils.json_to_sheet(observations);
    const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" }); const result = parseWorkbook(output);
    expect(result.snapshot).toBeUndefined(); expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_ID"); expect(result.issues.map((issue) => issue.code)).toContain("INVALID_DATE"); expect(result.issues.map((issue) => issue.code)).toContain("INCONSISTENT_REFERENCE");
  });
});
