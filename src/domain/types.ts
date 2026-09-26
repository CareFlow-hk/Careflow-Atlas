/** Domain records for the synthetic Field Outreach demonstration.
 * Values are intentionally provisional: this is not a schema for real client data.
 */

export const CONTACT_OUTCOMES = ["NOT_ATTEMPTED", "NO_ANSWER", "DECLINED", "CONTACTED", "UNKNOWN"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const HOUSING_ASSESSMENTS = ["NOT_UPDATED", "UNKNOWN", "SUSPECTED", "NO_INDICATION", "STAFF_VERIFIED"] as const;
export type HousingAssessment = (typeof HOUSING_ASSESSMENTS)[number];

export const COVERAGE_STATUSES = ["UNKNOWN", "UNVISITED", "ATTEMPTED", "PARTIAL", "VISITED_NO_FINDING", "VISITED_WITH_FINDING", "INACCESSIBLE"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
/** Backwards-friendly shared selector name for panels. */
export const OBSERVATION_STATUSES = COVERAGE_STATUSES;

export const FOLLOW_UP_STATUSES = ["OPEN", "DONE"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export const SUPPORT_CATEGORIES = ['GENERAL', 'HOUSING_CHANGE', 'HEALTH_SUPPORT', 'SERVICE_INVITATION'] as const;
export const supportCategoryLabels = { GENERAL: '一般跟進', HOUSING_CHANGE: '住屋變動', HEALTH_SUPPORT: '健康關懷', SERVICE_INVITATION: '服務邀約' };

export interface SyntheticRecord { isSynthetic: true; provisional: true; }
export interface Coordinates { lng: number; lat: number; }
export interface Building extends SyntheticRecord {
  id: string; name: string; address: string; coordinates: Coordinates; floorCount?: number; footprint?: number[][];
  /** Units only exist when the demo deliberately declares this layout. */
  layoutDeclared: boolean; initialCoverage?: CoverageStatus;
}
export interface Floor extends SyntheticRecord { id: string; buildingId: string; level: number; label: string; }
export interface Unit extends SyntheticRecord { id: string; buildingId: string; floorId: string; label: string; initialCoverage?: CoverageStatus; }
export interface Household extends SyntheticRecord { id: string; label?: string; }
export interface Person extends SyntheticRecord { id: string; displayName: string; phone?: string; addressNote?: string; contactNote?: string; }
export interface HouseholdMembership extends SyntheticRecord { id: string; householdId: string; personId: string; relationship?: string; }
export interface HouseholdResidence extends SyntheticRecord { id: string; householdId: string; unitId?: string; buildingId: string; startsOn?: string; endsOn?: string; locationNote?: string; }
export interface Membership extends SyntheticRecord { id: string; personId: string; status: "PENDING" | "ACTIVE" | "INACTIVE" | "UNKNOWN"; startsOn?: string; endsOn?: string; }
export interface Visit extends SyntheticRecord {
  id: string; occurredAt: string; recordedAt: string; workerName: string; note?: string;
}
export interface Observation extends SyntheticRecord {
  id: string; visitId: string; buildingId: string; floorId?: string; unitId?: string;
  occurredAt: string; recordedAt: string; workerName: string; coverage: CoverageStatus;
  assessment?: HousingAssessment; /** Blank remains absent, it is not UNKNOWN. */
  contactOutcome?: ContactOutcome; /** Independent from assessment and coverage. */
  sourceType?: "STAFF_OBSERVATION" | "RESIDENT_REPORT" | "UNKNOWN";
  evidence: string[]; note?: string;
  followUp?: { action: string; dueDate?: string; status: FollowUpStatus; category?: typeof SUPPORT_CATEGORIES[number]; assignee?: string; timingNote?: string };
  paperRef?: string;
  paperLine?: string;
  importSource?: { file: string; sheet: string; row: number };
  /** A DONE follow-up event must name the open observation it closes. */
  resolvesObservationId?: string;
  /** Names the original event this one corrects. The original is superseded, never rewritten. */
  correctsObservationId?: string;
  /** Why the correction was made. For traceability only; never part of coverage comparison. */
  correctionReason?: string;
}
export interface OutreachSnapshot {
  schemaVersion: "0.1-demo"; isSynthetic: true; notice: string;
  buildings: Building[]; floors: Floor[]; units: Unit[]; households: Household[];
  people: Person[]; householdMemberships: HouseholdMembership[]; householdResidences: HouseholdResidence[]; memberships: Membership[];
  visits: Visit[]; observations: Observation[];
}

export interface SaveObservationInput {
  id: string; visitId: string; buildingId: string; floorId?: string; unitId?: string;
  occurredAt: string; recordedAt: string; workerName: string; coverage: CoverageStatus; assessment?: HousingAssessment;
  contactOutcome?: ContactOutcome; evidence: string[]; note?: string;
  sourceType?: Observation["sourceType"];
  followUp?: Observation["followUp"];
  resolvesObservationId?: string;
  correctsObservationId?: string;
  correctionReason?: string;
}

/** Ids of events that at least one correction points at. They stay in history, out of coverage. */
export function supersededObservationIds(observations: Observation[]): Set<string> {
  const known = new Set(observations.map((item) => item.id));
  const superseded = new Set<string>();
  for (const item of observations) if (item.correctsObservationId && known.has(item.correctsObservationId)) superseded.add(item.correctsObservationId);
  return superseded;
}

/** The candidate set for coverage, summaries and follow-ups: the effective version of each event. */
export function effectiveObservations(snapshot: OutreachSnapshot): Observation[] {
  const superseded = supersededObservationIds(snapshot.observations);
  return snapshot.observations.filter((item) => !superseded.has(item.id));
}

export interface CorrectionConflict { observationId: string; correctionIds: string[]; }
/** Two live corrections for one original cannot be ordered by time; a human must pick one. */
export function getCorrectionConflicts(snapshot: OutreachSnapshot): CorrectionConflict[] {
  const branches = new Map<string, string[]>();
  for (const item of snapshot.observations) {
    if (!item.correctsObservationId) continue;
    branches.set(item.correctsObservationId, [...branches.get(item.correctsObservationId) ?? [], item.id]);
  }
  // A second descendant does not resolve a fork: both branches still have a live tail.
  return [...branches.entries()].filter(([, ids]) => ids.length > 1).map(([observationId, correctionIds]) => ({ observationId, correctionIds }));
}

export interface OpenFollowUp { observationId: string; buildingId: string; floorId?: string; unitId?: string; action: string; dueDate?: string; }
/** Stable event identity across correction chains; cycle-safe for unvalidated input. */
export function observationRootIds(observations: Observation[]): Map<string, string> {
  const byId = new Map(observations.map(item => [item.id, item]));
  const roots = new Map<string, string>();
  for (const item of observations) {
    let current = item.id;
    const path = new Set<string>();
    while (!roots.has(current) && !path.has(current)) {
      path.add(current);
      const parent = byId.get(current)?.correctsObservationId;
      if (!parent || !byId.has(parent)) break;
      current = parent;
    }
    const root = roots.get(current) ?? current;
    for (const id of path) roots.set(id, root);
  }
  return roots;
}

/** Resolution by event version, using only effective closure records. */
export function followUpResolutions(snapshot: OutreachSnapshot): Map<string, Observation> {
  const roots = observationRootIds(snapshot.observations);
  const byRoot = new Map<string, Observation>();
  for (const item of effectiveObservations(snapshot)) {
    if (item.resolvesObservationId) byRoot.set(roots.get(item.resolvesObservationId) ?? item.resolvesObservationId, item);
  }
  const result = new Map<string, Observation>();
  for (const [id, root] of roots) {
    const resolution = byRoot.get(root);
    if (resolution) result.set(id, resolution);
  }
  return result;
}

export function getOpenFollowUps(snapshot: OutreachSnapshot): OpenFollowUp[] {
  const resolved = followUpResolutions(snapshot);
  return effectiveObservations(snapshot).filter(item => item.followUp?.status === "OPEN" && !resolved.has(item.id))
    .map(item => ({ observationId: item.id, buildingId: item.buildingId, floorId: item.floorId, unitId: item.unitId, action: item.followUp!.action, dueDate: item.followUp!.dueDate }));
}

/** Occurrence time first, entry time only as a tie-breaker. Exported so views order the same way. */
export function compareObservationTime(left: Observation, right: Observation): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
}
function latestObservation(records: Observation[]): Observation | undefined {
  return records.reduce<Observation | undefined>((latest, current) => !latest || compareObservationTime(current, latest) > 0 ? current : latest, undefined);
}

export function getCoverageStatus(snapshot: OutreachSnapshot, buildingId: string, unitId?: string): CoverageStatus {
  const records = effectiveObservations(snapshot).filter((item) => item.buildingId === buildingId && (!unitId || item.unitId === unitId));
  if (unitId && records.length) return latestObservation(records)!.coverage;
  const explicitBuildingRecord = latestObservation(records.filter((item) => !item.floorId && !item.unitId));
  if (explicitBuildingRecord) return explicitBuildingRecord.coverage;
  return unitId ? snapshot.units.find((item) => item.id === unitId)?.initialCoverage ?? "UNKNOWN" : snapshot.buildings.find((item) => item.id === buildingId)?.initialCoverage ?? "UNKNOWN";
}

export interface CoverageSummary { total?: number; recorded: number; completed: number; followUps: number; status: CoverageStatus; }
/** Does not turn a unit event into a whole-building result. */
export function getCoverageSummary(snapshot: OutreachSnapshot, buildingId: string, floorId?: string): CoverageSummary {
  const scopeUnits = snapshot.units.filter((unit) => unit.buildingId === buildingId && (!floorId || unit.floorId === floorId));
  const scopedRecords = effectiveObservations(snapshot).filter((item) => item.buildingId === buildingId && (!floorId || item.floorId === floorId));
  const latestByUnit = new Map<string, Observation>();
  scopedRecords.filter((item) => item.unitId).forEach((item) => { const prior = latestByUnit.get(item.unitId!); if (!prior || compareObservationTime(item, prior) > 0) latestByUnit.set(item.unitId!, item); });
  const completed = [...latestByUnit.values()].filter((item) => ["VISITED_NO_FINDING", "VISITED_WITH_FINDING"].includes(item.coverage)).length;
  const hasFinding = [...latestByUnit.values()].some((item) => item.coverage === "VISITED_WITH_FINDING");
  const explicitScopeRecord = latestObservation(scopedRecords.filter((item) => floorId ? item.floorId === floorId && !item.unitId : !item.floorId && !item.unitId));
  const latestChildRecord = latestObservation([...latestByUnit.values()]);
  const derivedStatus = scopeUnits.length ? completed === scopeUnits.length ? hasFinding ? "VISITED_WITH_FINDING" : "VISITED_NO_FINDING" : latestByUnit.size ? "PARTIAL" : scopeUnits[0].initialCoverage ?? "UNKNOWN" : snapshot.buildings.find((item) => item.id === buildingId)?.initialCoverage ?? "UNKNOWN";
  const status = explicitScopeRecord && (!latestChildRecord || compareObservationTime(explicitScopeRecord, latestChildRecord) >= 0) ? explicitScopeRecord.coverage : derivedStatus;
  const recordedLocations = new Set(scopedRecords.map(item => item.unitId ? `unit:${item.unitId}` : item.floorId ? `floor:${item.floorId}` : `building:${item.buildingId}`));
  return { total: scopeUnits.length || undefined, recorded: recordedLocations.size, completed, followUps: getOpenFollowUps(snapshot).filter(item => item.buildingId === buildingId && (!floorId || item.floorId === floorId)).length, status };
}
