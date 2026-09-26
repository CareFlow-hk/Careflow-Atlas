import * as XLSX from "xlsx";
import { readWorkbook } from "./readWorkbook";
import { instantSchema, snapshotSchema } from "../domain/schema";
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, FOLLOW_UP_STATUSES, HOUSING_ASSESSMENTS, type Building, type Floor, type Household, type HouseholdMembership, type HouseholdResidence, type Membership, type Observation, type OutreachSnapshot, type Person, type Unit, type Visit } from "../domain/types";

export type WorkbookIssueSeverity = "error" | "warning";
export interface WorkbookImportIssue { severity: WorkbookIssueSeverity; code: string; sheet: string; row?: number; field?: string; message: string; }
export interface WorkbookImportResult { snapshot?: OutreachSnapshot; issues: WorkbookImportIssue[]; counts: Record<string, number>; }
type Row = Record<string, unknown>;
const synthetic = { isSynthetic: true, provisional: true } as const;
const requiredSheets = ["Metadata", "Buildings", "People", "Visits", "Observations"] as const;
const schemas: Record<string, string[]> = {
  Metadata: ["key", "value"],
  Buildings: ["id", "name", "address", "lng", "lat", "layoutDeclared"], Floors: ["id", "buildingId", "level", "label"], Units: ["id", "buildingId", "floorId", "label"],
  Households: ["id"], People: ["id", "displayName"], HouseholdMemberships: ["id", "householdId", "personId"], HouseholdResidences: ["id", "householdId", "buildingId"], Memberships: ["id", "personId", "status"],
  Visits: ["id", "occurredAt", "recordedAt", "workerName"], Observations: ["id", "visitId", "buildingId", "occurredAt", "recordedAt", "workerName", "coverage", "evidence"],
};
const optionalColumns: Record<string, string[]> = {
  Buildings: ['footprint', 'floorCount', 'initialCoverage'], Units: ['initialCoverage'], Households: ['label'],
  HouseholdMemberships: ['relationship'], HouseholdResidences: ['unitId', 'startsOn', 'endsOn', 'locationNote'],
  Memberships: ['startsOn', 'endsOn'], Visits: ['note'],
  Observations: ['floorId', 'unitId', 'assessment', 'contactOutcome', 'sourceType', 'note', 'followUpAction', 'followUpDueDate', 'followUpStatus', 'resolvesObservationId'],
};

function text(value: unknown): string | undefined { if (value === undefined || value === null || String(value).trim() === "") return undefined; return String(value).trim(); }
function footprint(value: unknown, row: number, issues: WorkbookImportIssue[]): number[][] | undefined {
  if (!text(value)) return undefined;
  try {
    return snapshotSchema.shape.buildings.element.shape.footprint.parse(JSON.parse(String(value)));
  } catch {
    issue(issues, 'error', 'INVALID_FOOTPRINT', 'Buildings', row, 'footprint', '請使用封閉的經緯度輪廓 JSON 陣列。');
    return undefined;
  }
}
function bool(value: unknown): boolean | undefined { const valueText = text(value)?.toLowerCase(); if (!valueText) return undefined; if (["true", "yes", "1"].includes(valueText)) return true; if (["false", "no", "0"].includes(valueText)) return false; return undefined; }
function number(value: unknown): number | undefined { const valueText = text(value); if (!valueText || !/^-?\d+(\.\d+)?$/.test(valueText)) return undefined; return Number(valueText); }
function strictDate(value: unknown): string | undefined { const valueText = text(value); if (!valueText || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(valueText)) return undefined; const [year, month, day] = valueText.slice(0, 10).split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day)); if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined; const instant = new Date(valueText); return Number.isNaN(instant.valueOf()) ? undefined : valueText; }
function oneOf<T extends readonly string[]>(value: unknown, values: T): T[number] | undefined { const valueText = text(value); return valueText && (values as readonly string[]).includes(valueText) ? valueText as T[number] : undefined; }
function issue(issues: WorkbookImportIssue[], severity: WorkbookIssueSeverity, code: string, sheet: string, row: number | undefined, field: string | undefined, message: string) { issues.push({ severity, code, sheet, row, field, message }); }
function parseSheet(workbook: XLSX.WorkBook, name: string, issues: WorkbookImportIssue[]): Row[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: true, blankrows: true });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: true });
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = Array.from({ length: width }, (_, col) => String(matrix[0]?.[col] ?? ''));
  const known = new Set([...(schemas[name] ?? []), ...(optionalColumns[name] ?? [])]);
  const seen = new Set<string>();
  for (const header of headers.filter(Boolean)) {
    if (seen.has(header)) issue(issues, 'error', 'DUPLICATE_HEADER', name, 1, header, 'Duplicate column header.');
    seen.add(header);
  }
  for (const header of schemas[name] ?? []) if (!headers.includes(header)) issue(issues, "error", "MISSING_HEADER", name, undefined, header, `Required column '${header}' is missing.`);
  matrix.slice(1).forEach((row, index) => headers.forEach((header, col) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: col })];
    if (cell?.f) issue(issues, 'error', 'FORMULA_NOT_ALLOWED', name, index + 2, header, 'Enter literal values, not formulas.');
    if (!known.has(header) && text(row[col])) issue(issues, 'error', 'UNKNOWN_COLUMN', name, index + 2, header || `Column ${col + 1}`, 'Unmapped data must be reviewed before import.');
  }));
  return rows;
}
function unique<T extends { id: string }>(items: T[], sheet: string, issues: WorkbookImportIssue[]) { const ids = new Set<string>(); items.forEach((item, index) => { if (ids.has(item.id)) issue(issues, "error", "DUPLICATE_ID", sheet, index + 2, "id", `Duplicate id '${item.id}'.`); ids.add(item.id); }); }
function requireValue(row: Row, key: string, sheet: string, rowIndex: number, issues: WorkbookImportIssue[]): string | undefined { const value = text(row[key]); if (!value) issue(issues, "error", "REQUIRED_VALUE", sheet, rowIndex, key, "A non-blank value is required."); return value; }

/** Parses only the deliberately designed synthetic workbook layout. Unknown sheets and unmapped data block import. */
export function parseWorkbook(buffer: ArrayBuffer): WorkbookImportResult {
  const issues: WorkbookImportIssue[] = []; let workbook: XLSX.WorkBook;
  if (buffer.byteLength > 5 * 1024 * 1024) return { issues: [{severity: "error", code: "FILE_TOO_LARGE", sheet: "workbook", message: "示範匯入上限為 5 MB。"}], counts: {} };
  try { workbook = readWorkbook(buffer); } catch (error) { return { issues: [{ severity: "error", code: "INVALID_WORKBOOK", sheet: "workbook", message: error instanceof Error ? error.message : "The file could not be parsed as an .xlsx workbook." }], counts: {} }; }
  for (const sheet of requiredSheets) if (!workbook.SheetNames.includes(sheet)) issue(issues, "error", "MISSING_SHEET", sheet, undefined, undefined, `Required sheet '${sheet}' is missing.`);
  workbook.SheetNames.filter((name) => !Object.hasOwn(schemas, name)).forEach((name) => issue(issues, "error", "UNKNOWN_SHEET", name, undefined, undefined, "Sheet was ignored."));
  const data = Object.fromEntries(Object.keys(schemas).map((name) => [name, parseSheet(workbook, name, issues)])) as Record<string, Row[]>;
  if (data.Metadata.find((row) => text(row.key) === "synthetic")?.value !== "true") issue(issues, "error", "NON_SYNTHETIC_WORKBOOK", "Metadata", undefined, "synthetic", "This importer accepts only a workbook explicitly marked synthetic=true.");
  const buildings: Building[] = data.Buildings.map((row, index) => {
    const rowIndex = index + 2; const id = requireValue(row, "id", "Buildings", rowIndex, issues) ?? `invalid-building-${index}`; const lng = number(row.lng); const lat = number(row.lat);
    if (lng === undefined || lng < -180 || lng > 180) issue(issues, "error", "INVALID_VALUE", "Buildings", rowIndex, "lng", "Longitude must be a number from -180 to 180.");
    if (lat === undefined || lat < -85 || lat > 85) issue(issues, "error", "INVALID_VALUE", "Buildings", rowIndex, "lat", "Latitude must be a number from -85 to 85 for this map.");
    const layoutDeclared = bool(row.layoutDeclared); if (layoutDeclared === undefined) issue(issues, "error", "INVALID_VALUE", "Buildings", rowIndex, "layoutDeclared", "Use true or false.");
    return { ...synthetic, id, name: requireValue(row, "name", "Buildings", rowIndex, issues) ?? "", address: requireValue(row, "address", "Buildings", rowIndex, issues) ?? "", coordinates: { lng: lng ?? 0, lat: lat ?? 0 }, footprint: footprint(row.footprint, rowIndex, issues), layoutDeclared: layoutDeclared ?? false, floorCount: number(row.floorCount), initialCoverage: optionalEnum(row.initialCoverage, COVERAGE_STATUSES, "Buildings", rowIndex, issues) };
  });
  const floors: Floor[] = data.Floors.map((row, index) => ({ ...synthetic, id: requireValue(row, "id", "Floors", index + 2, issues) ?? `invalid-floor-${index}`, buildingId: requireValue(row, "buildingId", "Floors", index + 2, issues) ?? "", level: number(row.level) ?? invalid(issues, "Floors", index + 2, "level", "A numeric floor level is required."), label: requireValue(row, "label", "Floors", index + 2, issues) ?? "" }));
  const units: Unit[] = data.Units.map((row, index) => ({ ...synthetic, id: requireValue(row, "id", "Units", index + 2, issues) ?? `invalid-unit-${index}`, buildingId: requireValue(row, "buildingId", "Units", index + 2, issues) ?? "", floorId: requireValue(row, "floorId", "Units", index + 2, issues) ?? "", label: requireValue(row, "label", "Units", index + 2, issues) ?? "", initialCoverage: optionalEnum(row.initialCoverage, COVERAGE_STATUSES, "Units", index + 2, issues) }));
  const households: Household[] = data.Households.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "Households", i + 2, issues) ?? `invalid-household-${i}`, label: text(row.label) }));
  const people: Person[] = data.People.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "People", i + 2, issues) ?? `invalid-person-${i}`, displayName: requireValue(row, "displayName", "People", i + 2, issues) ?? "" }));
  const householdMemberships: HouseholdMembership[] = data.HouseholdMemberships.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "HouseholdMemberships", i + 2, issues) ?? `invalid-hhm-${i}`, householdId: requireValue(row, "householdId", "HouseholdMemberships", i + 2, issues) ?? "", personId: requireValue(row, "personId", "HouseholdMemberships", i + 2, issues) ?? "", relationship: text(row.relationship) }));
  const householdResidences: HouseholdResidence[] = data.HouseholdResidences.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "HouseholdResidences", i + 2, issues) ?? `invalid-residence-${i}`, householdId: requireValue(row, "householdId", "HouseholdResidences", i + 2, issues) ?? "", buildingId: requireValue(row, "buildingId", "HouseholdResidences", i + 2, issues) ?? "", unitId: text(row.unitId), startsOn: optionalDate(row.startsOn, "HouseholdResidences", i + 2, issues), endsOn: optionalDate(row.endsOn, "HouseholdResidences", i + 2, issues), locationNote: text(row.locationNote) }));
  const memberships: Membership[] = data.Memberships.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "Memberships", i + 2, issues) ?? `invalid-membership-${i}`, personId: requireValue(row, "personId", "Memberships", i + 2, issues) ?? "", status: optionalEnum(row.status, ["PENDING", "ACTIVE", "INACTIVE", "UNKNOWN"] as const, "Memberships", i + 2, issues) ?? "UNKNOWN", startsOn: optionalDate(row.startsOn, "Memberships", i + 2, issues), endsOn: optionalDate(row.endsOn, "Memberships", i + 2, issues) }));
  const visits: Visit[] = data.Visits.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "Visits", i + 2, issues) ?? `invalid-visit-${i}`, occurredAt: requiredDate(row.occurredAt, "Visits", i + 2, "occurredAt", issues), recordedAt: requiredDate(row.recordedAt, "Visits", i + 2, "recordedAt", issues), workerName: requireValue(row, "workerName", "Visits", i + 2, issues) ?? "", note: text(row.note) }));
  const observations: Observation[] = data.Observations.map((row, i) => ({ ...synthetic, id: requireValue(row, "id", "Observations", i + 2, issues) ?? `invalid-observation-${i}`, visitId: requireValue(row, "visitId", "Observations", i + 2, issues) ?? "", buildingId: requireValue(row, "buildingId", "Observations", i + 2, issues) ?? "", floorId: text(row.floorId), unitId: text(row.unitId), occurredAt: requiredDate(row.occurredAt, "Observations", i + 2, "occurredAt", issues), recordedAt: requiredDate(row.recordedAt, "Observations", i + 2, "recordedAt", issues), workerName: requireValue(row, "workerName", "Observations", i + 2, issues) ?? "", coverage: coverageValue(row.coverage, i + 2, issues), assessment: optionalEnum(row.assessment, HOUSING_ASSESSMENTS, "Observations", i + 2, issues, "assessment"), contactOutcome: optionalEnum(row.contactOutcome, CONTACT_OUTCOMES, "Observations", i + 2, issues, "contactOutcome"), sourceType: optionalEnum(row.sourceType, ["STAFF_OBSERVATION", "RESIDENT_REPORT", "UNKNOWN"] as const, "Observations", i + 2, issues, "sourceType"), evidence: text(row.evidence)?.split("|").map((item) => item.trim()).filter(Boolean) ?? [], note: text(row.note), followUp: parseFollowUp(row, i + 2, issues), resolvesObservationId: text(row.resolvesObservationId) }));
  unique(buildings, "Buildings", issues); unique(floors, "Floors", issues); unique(units, "Units", issues); unique(households, "Households", issues); unique(people, "People", issues); unique(householdMemberships, "HouseholdMemberships", issues); unique(householdResidences, "HouseholdResidences", issues); unique(memberships, "Memberships", issues); unique(visits, "Visits", issues); unique(observations, "Observations", issues);
  validateReferences({ buildings, floors, units, households, people, householdMemberships, householdResidences, memberships, visits, observations }, issues);
  const counts = Object.fromEntries(Object.entries({ Buildings: buildings, Floors: floors, Units: units, Households: households, People: people, HouseholdMemberships: householdMemberships, HouseholdResidences: householdResidences, Memberships: memberships, Visits: visits, Observations: observations }).map(([name, records]) => [name, records.length]));
  if (issues.some((item) => item.severity === "error")) return { issues, counts };
  const validated = snapshotSchema.safeParse({ schemaVersion: "0.1-demo", isSynthetic: true, notice: "合成示範資料；欄位、關係與業務規則待機構確認。", buildings, floors, units, households, people, householdMemberships, householdResidences, memberships, visits, observations });
  if (!validated.success) {
    for (const problem of validated.error.issues) {
      const collection = String(problem.path[0] ?? "workbook");
      const sheet = collection[0].toUpperCase() + collection.slice(1);
      issue(issues, "error", "DOMAIN_VALIDATION", sheet, typeof problem.path[1] === "number" ? problem.path[1] + 2 : undefined, problem.path.slice(2).join(".") || undefined, problem.message);
    }
    return { issues, counts };
  }
  return { issues, counts, snapshot: validated.data };
}
function invalid(issues: WorkbookImportIssue[], sheet: string, row: number, field: string, message: string) { issue(issues, "error", "INVALID_VALUE", sheet, row, field, message); return 0; }
function coverageValue(value: unknown, row: number, issues: WorkbookImportIssue[]) { if (!text(value)) { issue(issues, "warning", "BLANK_COVERAGE", "Observations", row, "coverage", "此列未填覆蓋結果，將保留為「暫無可靠記錄」，不視作未到訪或無發現。"); return "UNKNOWN" as const; } return optionalEnum(value, COVERAGE_STATUSES, "Observations", row, issues, "coverage") ?? "UNKNOWN"; }
function optionalEnum<T extends readonly string[]>(value: unknown, values: T, sheet: string, row: number, issues: WorkbookImportIssue[], field = "value"): T[number] | undefined { if (!text(value)) return undefined; const result = oneOf(value, values); if (!result) issue(issues, "error", "INVALID_VALUE", sheet, row, field, `Use one of: ${values.join(", ")}.`); return result; }
function optionalDate(value: unknown, sheet: string, row: number, issues: WorkbookImportIssue[]): string | undefined { if (!text(value)) return undefined; const result = strictDate(value); if (!result) issue(issues, "error", "INVALID_DATE", sheet, row, "date", "Use ISO YYYY-MM-DD or ISO date-time with timezone."); return result; }
function requiredDate(value: unknown, sheet: string, row: number, field: string, issues: WorkbookImportIssue[]): string { const parsed = instantSchema.safeParse(text(value)); if (!parsed.success) issue(issues, "error", "INVALID_DATE", sheet, row, field, "請填寫含時區的完整時間，例如 2026-09-10T18:30:00+08:00。"); return parsed.success ? parsed.data : ""; }
function parseFollowUp(row: Row, rowIndex: number, issues: WorkbookImportIssue[]): Observation["followUp"] { const action = text(row.followUpAction); if (!action) return undefined; return { action, dueDate: optionalDate(row.followUpDueDate, "Observations", rowIndex, issues), status: optionalEnum(row.followUpStatus, FOLLOW_UP_STATUSES, "Observations", rowIndex, issues) ?? "OPEN" }; }
function validateReferences(data: Pick<OutreachSnapshot, "buildings" | "floors" | "units" | "households" | "people" | "householdMemberships" | "householdResidences" | "memberships" | "visits" | "observations">, issues: WorkbookImportIssue[]) { const ids = Object.fromEntries(Object.entries(data).map(([name, records]) => [name, new Set(records.map((item) => item.id))])); const ref = (valid: boolean, sheet: string, row: number, field: string, value: string) => { if (!valid) issue(issues, "error", "UNKNOWN_REFERENCE", sheet, row, field, `Unknown reference '${value}'.`); };
  const floorById = new Map(data.floors.map((item) => [item.id, item])); const unitById = new Map(data.units.map((item) => [item.id, item]));
  data.floors.forEach((x, i) => ref(ids.buildings.has(x.buildingId), "Floors", i + 2, "buildingId", x.buildingId)); data.units.forEach((x, i) => { ref(ids.buildings.has(x.buildingId), "Units", i + 2, "buildingId", x.buildingId); ref(ids.floors.has(x.floorId), "Units", i + 2, "floorId", x.floorId); const floor = floorById.get(x.floorId); if (floor && floor.buildingId !== x.buildingId) issue(issues, "error", "INCONSISTENT_REFERENCE", "Units", i + 2, "floorId", "Unit buildingId must match its floor buildingId."); }); data.householdMemberships.forEach((x, i) => { ref(ids.households.has(x.householdId), "HouseholdMemberships", i + 2, "householdId", x.householdId); ref(ids.people.has(x.personId), "HouseholdMemberships", i + 2, "personId", x.personId); }); data.householdResidences.forEach((x, i) => { ref(ids.households.has(x.householdId), "HouseholdResidences", i + 2, "householdId", x.householdId); ref(ids.buildings.has(x.buildingId), "HouseholdResidences", i + 2, "buildingId", x.buildingId); if (x.unitId) { ref(ids.units.has(x.unitId), "HouseholdResidences", i + 2, "unitId", x.unitId); if (unitById.get(x.unitId)?.buildingId !== x.buildingId) issue(issues, "error", "INCONSISTENT_REFERENCE", "HouseholdResidences", i + 2, "unitId", "Residence unit must belong to its buildingId."); } }); data.memberships.forEach((x, i) => ref(ids.people.has(x.personId), "Memberships", i + 2, "personId", x.personId)); data.observations.forEach((x, i) => { ref(ids.visits.has(x.visitId), "Observations", i + 2, "visitId", x.visitId); ref(ids.buildings.has(x.buildingId), "Observations", i + 2, "buildingId", x.buildingId); if (x.floorId) { ref(ids.floors.has(x.floorId), "Observations", i + 2, "floorId", x.floorId); if (floorById.get(x.floorId)?.buildingId !== x.buildingId) issue(issues, "error", "INCONSISTENT_REFERENCE", "Observations", i + 2, "floorId", "Observation floor must belong to its buildingId."); } if (x.unitId) { ref(ids.units.has(x.unitId), "Observations", i + 2, "unitId", x.unitId); const unit = unitById.get(x.unitId); if (unit && (unit.buildingId !== x.buildingId || (x.floorId && unit.floorId !== x.floorId))) issue(issues, "error", "INCONSISTENT_REFERENCE", "Observations", i + 2, "unitId", "Observation unit must match its buildingId and floorId."); } }); }
