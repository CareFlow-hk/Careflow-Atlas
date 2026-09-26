import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./workbookImport";
import { demoSnapshot } from './demoFixture';
import { workflowDemo } from './workflowDemo';
import { mergeWorkflow } from './workflowMerge';

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
