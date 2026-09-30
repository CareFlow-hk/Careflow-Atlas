import type { Building, Floor, OutreachSnapshot, Unit, Visit, Observation, Person, Household, HouseholdMembership, Membership } from "../domain/types";
import { alignDemoBuilding } from './demoGeometry';

const synthetic = { isSynthetic: true, provisional: true } as const;
const buildingDefinitions = [
  ["bldg-yu-an", "裕安樓", "西營盤示範街 1 號", 0, 0, 8, true],
  ["bldg-hoi-king", "海景樓", "西營盤示範街 8 號", 0.00072, 0.00022, 2, true],
  ["bldg-duk-cheong", "德昌樓", "西營盤示範街 16 號", -0.00045, 0.00051, undefined, false],
  ["bldg-on-wo", "安和樓", "西營盤示範街 24 號", 0.00031, -0.00048, undefined, false],
] as const;

export const demoBuildings: Building[] = buildingDefinitions.map<Building>(([id, name, addressLabel, lngOffset, latOffset, floorCount, layoutDeclared]) => ({
  ...synthetic, id, name, address: addressLabel, layoutDeclared, floorCount, initialCoverage: layoutDeclared ? "UNVISITED" : "UNKNOWN",
  coordinates: { lng: 114.1418 + lngOffset, lat: 22.2863 + latOffset },
})).map(alignDemoBuilding);

export const demoFloors: Floor[] = demoBuildings.flatMap((building) => Array.from({ length: building.floorCount ?? 0 }, (_, index) => ({
  ...synthetic, id: `${building.id}-f${index + 1}`, buildingId: building.id, label: `${index + 1}F`, level: index + 1,
})));

export const demoUnits: Unit[] = demoFloors.flatMap((floor) => ["A", "B", ...(floor.buildingId === "bldg-yu-an" ? ["C", "D"] : [])].map((letter) => ({
  ...synthetic, id: `${floor.id}-${letter}`, buildingId: floor.buildingId, floorId: floor.id, label: `${floor.label} ${letter}室`, initialCoverage: "UNVISITED",
})));

const demoPeople: Person[] = [
  { ...synthetic, id: "person-lam", displayName: "林女士（合成）" },
  { ...synthetic, id: "person-chan", displayName: "陳先生（合成）" },
];
const demoHouseholds: Household[] = [{ ...synthetic, id: "household-lam", label: "林家庭（合成）" }];
const demoHouseholdMemberships: HouseholdMembership[] = [{ ...synthetic, id: "hhm-lam", householdId: "household-lam", personId: "person-lam", relationship: "戶主（合成）" }];
const demoMemberships: Membership[] = [{ ...synthetic, id: "membership-lam", personId: "person-lam", status: "PENDING" }];

const demoVisits: Visit[] = [
  { ...synthetic, id: "visit-yu-an-2026-09-09", occurredAt: "2026-09-09T18:30:00+08:00", recordedAt: "2026-09-09T20:15:00+08:00", workerName: "示範工作員甲（合成）", note: "合成示例：同一次外出可以寫入多個位置。" },
  { ...synthetic, id: "visit-hoi-king-2026-09-08", occurredAt: "2026-09-08T18:30:00+08:00", recordedAt: "2026-09-08T20:15:00+08:00", workerName: "示範工作員乙（合成）" },
  { ...synthetic, id: "visit-duk-cheong-2026-09-07", occurredAt: "2026-09-07T18:30:00+08:00", recordedAt: "2026-09-07T20:15:00+08:00", workerName: "示範工作員丙（合成）" },
];
const primaryObservations: Observation[] = [
  { ...synthetic, id: "observation-yu-an-5b", visitId: "visit-yu-an-2026-09-09", buildingId: "bldg-yu-an", floorId: "bldg-yu-an-f5", unitId: "bldg-yu-an-f5-B", occurredAt: "2026-09-09T18:40:00+08:00", recordedAt: "2026-09-09T20:15:00+08:00", workerName: "示範工作員甲（合成）", coverage: "ATTEMPTED", assessment: "SUSPECTED", contactOutcome: "NO_ANSWER", sourceType: "STAFF_OBSERVATION", note: "敲門兩次，未有人應門。信箱有細分標籤，住房情況仍需向住戶核實。", evidence: ["信箱細分為 B1、B2", "門外可見多個空調外機"], followUp: { action: "傍晚再次到訪，了解服務需要", dueDate: "2026-09-16", status: "OPEN" } },
  { ...synthetic, id: "observation-yu-an-5a", visitId: "visit-yu-an-2026-09-09", buildingId: "bldg-yu-an", floorId: "bldg-yu-an-f5", unitId: "bldg-yu-an-f5-A", occurredAt: "2026-09-09T18:39:00+08:00", recordedAt: "2026-09-09T20:14:00+08:00", workerName: "示範工作員甲（合成）", coverage: "VISITED_NO_FINDING", assessment: "NO_INDICATION", contactOutcome: "CONTACTED", evidence: [] },
  { ...synthetic, id: "observation-yu-an-5c", visitId: "visit-yu-an-2026-09-09", buildingId: "bldg-yu-an", floorId: "bldg-yu-an-f5", unitId: "bldg-yu-an-f5-C", occurredAt: "2026-09-09T18:38:00+08:00", recordedAt: "2026-09-09T20:13:00+08:00", workerName: "示範工作員甲（合成）", coverage: "UNKNOWN", note: "舊表未寫明是否已查看，先保留未知，待工作員核對。", evidence: [] },
  { ...synthetic, id: "observation-yu-an-5d", visitId: "visit-yu-an-2026-09-09", buildingId: "bldg-yu-an", floorId: "bldg-yu-an-f5", unitId: "bldg-yu-an-f5-D", occurredAt: "2026-09-09T18:37:00+08:00", recordedAt: "2026-09-09T20:12:00+08:00", workerName: "示範工作員甲（合成）", coverage: "VISITED_WITH_FINDING", assessment: "SUSPECTED", contactOutcome: "DECLINED", evidence: ["合成示例：需由工作員後續核實。"] },
  ...demoUnits.filter((unit) => unit.buildingId === "bldg-yu-an" && !unit.id.includes("-f5-")).slice(0, 18).map((unit, index): Observation => ({ ...synthetic, id: `observation-${unit.id}`, visitId: "visit-yu-an-2026-09-09", buildingId: unit.buildingId, floorId: unit.floorId, unitId: unit.id, occurredAt: `2026-09-09T19:${String(index + 10).padStart(2, "0")}:00+08:00`, recordedAt: `2026-09-09T20:${String(index + 10).padStart(2, "0")}:00+08:00`, workerName: "示範工作員甲（合成）", coverage: index % 5 === 0 ? "PARTIAL" : "VISITED_NO_FINDING", assessment: index % 5 === 0 ? "NOT_UPDATED" : "NO_INDICATION", contactOutcome: index % 5 === 0 ? "UNKNOWN" : "CONTACTED", evidence: [] })),
];
const demoObservations: Observation[] = [
  ...primaryObservations,
  { ...synthetic, id: "observation-hoi-king-2a", visitId: "visit-hoi-king-2026-09-08", buildingId: "bldg-hoi-king", floorId: "bldg-hoi-king-f2", unitId: "bldg-hoi-king-f2-A", occurredAt: "2026-09-08T18:45:00+08:00", recordedAt: "2026-09-08T20:15:00+08:00", workerName: "示範工作員乙（合成）", coverage: "VISITED_NO_FINDING", assessment: "NOT_UPDATED", contactOutcome: "CONTACTED", evidence: [], note: "合成示例：已探訪但本次未記錄發現。" },
  { ...synthetic, id: "observation-hoi-king-2b", visitId: "visit-hoi-king-2026-09-08", buildingId: "bldg-hoi-king", floorId: "bldg-hoi-king-f2", unitId: "bldg-hoi-king-f2-B", occurredAt: "2026-09-08T18:44:00+08:00", recordedAt: "2026-09-08T20:14:00+08:00", workerName: "示範工作員乙（合成）", coverage: "VISITED_NO_FINDING", assessment: "NO_INDICATION", contactOutcome: "CONTACTED", evidence: [] },
  { ...synthetic, id: "observation-duk-cheong-entry", visitId: "visit-duk-cheong-2026-09-07", buildingId: "bldg-duk-cheong", occurredAt: "2026-09-07T18:45:00+08:00", recordedAt: "2026-09-07T20:15:00+08:00", workerName: "示範工作員丙（合成）", coverage: "INACCESSIBLE", contactOutcome: "NOT_ATTEMPTED", evidence: ["合成示例：入口未能進入。"], followUp: { action: "合成示例：與同事討論是否再訪", status: "OPEN" } },
];

export const demoSnapshot: OutreachSnapshot = {
  schemaVersion: "0.1-demo", isSynthetic: true,
  notice: "業務資料、姓名、地址與樓層單位結構均為合成示例；占地輪廓參照 OpenStreetMap 底圖，不表示真實大廈身份或住戶資料已核實。",
  buildings: demoBuildings, floors: demoFloors, units: demoUnits, households: demoHouseholds,
  people: demoPeople, householdMemberships: demoHouseholdMemberships, householdResidences: [{ ...synthetic, id: "residence-lam", householdId: "household-lam", buildingId: "bldg-yu-an", unitId: "bldg-yu-an-f5-B", startsOn: "2026-09-01" }], memberships: demoMemberships,
  visits: demoVisits, observations: demoObservations,
};
