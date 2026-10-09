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
export const SOURCE_TYPES = ['STAFF_OBSERVATION', 'RESIDENT_REPORT', 'UNKNOWN'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SUPPORT_CATEGORIES = ['GENERAL', 'HOUSING_CHANGE', 'HEALTH_SUPPORT', 'SERVICE_INVITATION'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The four-state colour model. Units, floors and buildings share this one vocabulary. */
export const OUTREACH_STATES = ["GREEN", "YELLOW", "RED", "GRAY"] as const;
export type State = (typeof OUTREACH_STATES)[number];

/**
 * The only manual mark a floor or a building can carry. It is a display attribute
 * of the node, never an observation: it is not written into any unit's record, so
 * history, detail panels and exports keep showing the real data.
 */
export const NODE_TAGS = ["FOLLOW_UP"] as const;
export type NodeTag = (typeof NODE_TAGS)[number];

/** A node in the building → floor → unit tree. Narrower fields read that level's own record. */
export interface Scope { buildingId: string; floorId?: string; unitId?: string; }

export interface SyntheticRecord { isSynthetic: true; provisional: true; }
export interface Coordinates { lng: number; lat: number; }
export interface Building extends SyntheticRecord {
  id: string; name: string; address: string; coordinates: Coordinates; floorCount?: number; footprint?: number[][];
  /** Units only exist when the demo deliberately declares this layout. */
  layoutDeclared: boolean; initialCoverage?: CoverageStatus;
  /** Manual "needs follow-up" mark for the whole building. Display only. */
  tag?: NodeTag;
}
export interface Floor extends SyntheticRecord {
  id: string; buildingId: string; level: number; label: string;
  /** Manual "needs follow-up" mark for the whole floor. Display only. */
  tag?: NodeTag;
}
export interface Unit extends SyntheticRecord { id: string; buildingId: string; floorId: string; label: string; initialCoverage?: CoverageStatus; }
export interface Household extends SyntheticRecord { id: string; label?: string; }
export interface Person extends SyntheticRecord { id: string; displayName: string; phone?: string; addressNote?: string; contactNote?: string; }
export interface HouseholdMembership extends SyntheticRecord { id: string; householdId: string; personId: string; relationship?: string; }
export interface HouseholdResidence extends SyntheticRecord { id: string; householdId: string; unitId?: string; buildingId: string; startsOn?: string; endsOn?: string; locationNote?: string; }
export interface Membership extends SyntheticRecord { id: string; personId: string; status: "PENDING" | "ACTIVE" | "INACTIVE" | "UNKNOWN"; startsOn?: string; endsOn?: string; }
export interface Visit extends SyntheticRecord {
  id: string; occurredAt: string; recordedAt: string; workerName: string; note?: string;
}
/**
 * Free text kept beside a chosen option, for a self-defined entry (§10.4). Purely
 * descriptive: nothing in the four-state pipeline or the coverage summaries reads it.
 *
 * `followUpCategory` is the one key with no matching `OptionField`: the four above sit
 * beside a stored enum, while this one stands in for a category that was never chosen.
 * A typed category therefore leaves the badge unclassified rather than inventing one.
 */
export interface OptionNotes {
  coverage?: string; contactOutcome?: string; assessment?: string; sourceType?: string; followUpCategory?: string;
}

/**
 * The four fields whose entry choices can be simplified and extended. Named here
 * rather than in optionPrefs so the observation shape and its stored preferences
 * cannot drift apart.
 */
export const OPTION_FIELDS = ['coverage', 'contactOutcome', 'assessment', 'sourceType'] as const;
export type OptionField = (typeof OPTION_FIELDS)[number];
export interface PhotoFallback {
  primaryModel: string; model: string;
  reason: 'LOW_LEGIBILITY' | 'UNREADABLE' | 'INVALID_OUTPUT';
  outcome: 'used' | 'failed' | 'kept_primary';
}
export interface Observation extends SyntheticRecord {
  id: string; visitId: string; buildingId: string; floorId?: string; unitId?: string;
  occurredAt: string; recordedAt: string; workerName: string; coverage: CoverageStatus;
  assessment?: HousingAssessment; /** Blank remains absent, it is not UNKNOWN. */
  contactOutcome?: ContactOutcome; /** Independent from assessment and coverage. */
  sourceType?: SourceType;
  /**
   * Wording the worker typed for a self-defined option. The enum keeps its own
   * value, so a custom label never widens the vocabulary the pipeline reads.
   */
  optionNotes?: OptionNotes;
  evidence: string[]; note?: string;
  followUp?: { action: string; dueDate?: string; status: FollowUpStatus; category?: SupportCategory; assignee?: string; timingNote?: string };
  paperRef?: string;
  paperLine?: string;
  photoSource?: { hash: string; file: string; line: string; model: string; fallback?: PhotoFallback; reviewedBy: Operator; reviewedAt: string; sample: boolean };
  importSource?: { file: string; sheet: string; row: number };
  /** A DONE follow-up event must name the open observation it closes. */
  resolvesObservationId?: string;
  /** Names the original event this one corrects. The original is superseded, never rewritten. */
  correctsObservationId?: string;
  /** Why the correction was made. For traceability only; never part of coverage comparison. */
  correctionReason?: string;
}
/**
 * What a person did to a task in the app, without a visit: marked it done, cancelled
 * it, or undid either. Append-only, like observations — an undo is a new REOPENED
 * event, never an edit — so the trail of who closed what, and why, is kept.
 */
export const FOLLOW_UP_EVENT_ACTIONS = ["DONE", "CANCELLED", "REOPENED"] as const;
export type FollowUpEventAction = (typeof FOLLOW_UP_EVENT_ACTIONS)[number];
/**
 * The signed-in account that pressed the button. This is the operator, not the field
 * worker on the paper: the two are different roles and are never substituted.
 */
export interface Operator { accountId: string; name: string; }
export interface FollowUpEvent extends SyntheticRecord {
  id: string;
  /** The observation that carries the task. Any version of a correction chain names the same task. */
  observationId: string;
  action: FollowUpEventAction;
  /** Required for CANCELLED; optional otherwise. */
  reason?: string;
  /** When the button was pressed. Operation time, not visit time. */
  at: string;
  operator: Operator;
}
export interface OutreachSnapshot {
  schemaVersion: "0.1-demo"; isSynthetic: true; notice: string;
  buildings: Building[]; floors: Floor[]; units: Unit[]; households: Household[];
  people: Person[]; householdMemberships: HouseholdMembership[]; householdResidences: HouseholdResidence[]; memberships: Membership[];
  visits: Visit[]; observations: Observation[];
  /** Absent in snapshots saved before tasks could be closed without a visit. */
  followUpEvents?: FollowUpEvent[];
}

export interface SaveObservationInput {
  id: string; visitId: string; buildingId: string; floorId?: string; unitId?: string;
  occurredAt: string; recordedAt: string; workerName: string; coverage: CoverageStatus; assessment?: HousingAssessment;
  contactOutcome?: ContactOutcome; evidence: string[]; note?: string;
  sourceType?: SourceType;
  /** A self-defined wording kept beside the chosen option. Never read by the pipeline. */
  optionNotes?: OptionNotes;
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

export interface OpenFollowUp {
  observationId: string; buildingId: string; floorId?: string; unitId?: string; action: string; dueDate?: string;
  /** Carried so a badge can name what the task is. `category` stays optional: blank is not GENERAL. */
  category?: SupportCategory; assignee?: string; timingNote?: string;
}
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

/** A task closed in the app, with the event that closed it. Keyed by every version's id. */
export function followUpClosures(snapshot: OutreachSnapshot): Map<string, FollowUpEvent> {
  const roots = observationRootIds(snapshot.observations);
  const latest = new Map<string, FollowUpEvent>();
  // Array order is append order, so a later event at the same instant still wins.
  for (const event of snapshot.followUpEvents ?? []) {
    const root = roots.get(event.observationId) ?? event.observationId;
    const prior = latest.get(root);
    if (!prior || Date.parse(event.at) >= Date.parse(prior.at)) latest.set(root, event);
  }
  const result = new Map<string, FollowUpEvent>();
  for (const [id, root] of roots) {
    const event = latest.get(root);
    if (event && event.action !== "REOPENED") result.set(id, event);
  }
  return result;
}

/** Every button press on one task, oldest first, for the history trail. */
export function followUpEventsFor(snapshot: OutreachSnapshot, observationId: string): FollowUpEvent[] {
  const roots = observationRootIds(snapshot.observations);
  const root = roots.get(observationId) ?? observationId;
  return (snapshot.followUpEvents ?? []).filter(event => (roots.get(event.observationId) ?? event.observationId) === root);
}

/**
 * Close or reopen a task without inventing a visit. Only an open task can be closed
 * and only an app closure can be undone; anything else returns the snapshot unchanged.
 */
export function recordFollowUpEvent(snapshot: OutreachSnapshot, input: { id: string; observationId: string; action: FollowUpEventAction; reason?: string; at: string; operator: Operator }): OutreachSnapshot {
  const reason = input.reason?.trim() || undefined;
  if (input.action === "CANCELLED" && !reason) throw new Error("取消跟進須寫明原因。");
  const isOpen = getOpenFollowUps(snapshot).some(task => task.observationId === input.observationId);
  const closedInApp = followUpClosures(snapshot).has(input.observationId);
  if (input.action === "REOPENED" ? !closedInApp : !isOpen) return snapshot;
  const event: FollowUpEvent = { isSynthetic: true, provisional: true, id: input.id, observationId: input.observationId, action: input.action, at: input.at, operator: input.operator, ...(reason ? { reason } : {}) };
  return { ...snapshot, followUpEvents: [...snapshot.followUpEvents ?? [], event] };
}

export function getOpenFollowUps(snapshot: OutreachSnapshot): OpenFollowUp[] {
  const resolved = followUpResolutions(snapshot);
  const closed = followUpClosures(snapshot);
  return effectiveObservations(snapshot).filter(item => item.followUp?.status === "OPEN" && !resolved.has(item.id) && !closed.has(item.id))
    .map(item => ({ observationId: item.id, buildingId: item.buildingId, floorId: item.floorId, unitId: item.unitId, action: item.followUp!.action, dueDate: item.followUp!.dueDate, category: item.followUp!.category, assignee: item.followUp!.assignee, timingNote: item.followUp!.timingNote }));
}

/** Occurrence time first, entry time only as a tie-breaker. Exported so views order the same way. */
export function compareObservationTime(left: Observation, right: Observation): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
}
/** The latest of a set of events by the one ordering the whole domain uses. */
export function latestObservation(records: Observation[]): Observation | undefined {
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
/**
 * Counting and the paper/Excel 覆蓋概況 column only. `status` is the older seven-value
 * vocabulary and is deliberately kept: the workbook round-trip and the W0 recognition
 * vocabulary depend on those exact spellings, and existing records store them.
 *
 * Nothing paints from this. Every colour in the product comes from the four-state
 * pipeline below (`unitState` / `floorState` / `buildingState`).
 *
 * Does not turn a unit event into a whole-building result.
 */
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

/* ------------------------------------------------------------------------- *
 * The four-state colour pipeline.
 *
 * This is the single definition of "what colour is this node". Units, floors and
 * buildings all call the same `stateOf`; they differ only in the scope handed to
 * it. Nothing else in the repository may derive a colour.
 * ------------------------------------------------------------------------- */

/** Does this event sit inside the scope at all? */
function inScope(item: Observation, scope: Scope): boolean {
  return item.buildingId === scope.buildingId
    && (!scope.floorId || item.floorId === scope.floorId)
    && (!scope.unitId || item.unitId === scope.unitId);
}

/**
 * A node's own record must not be narrower than the node: a building record carries
 * no floor or unit, a floor record carries no unit. Without this, a unit's result
 * would be read as its floor's own record and the two levels would contradict each
 * other. Asking for a unit is already as narrow as it gets, so nothing is excluded.
 */
function isNodeLevelRecord(item: Observation, scope: Scope): boolean {
  if (scope.unitId !== undefined) return true;
  if (scope.floorId !== undefined) return item.unitId === undefined;
  return item.floorId === undefined && item.unitId === undefined;
}

/** The latest effective event recorded at exactly this level. Undefined means "no record here". */
export function latestInScope(snapshot: OutreachSnapshot, scope: Scope): Observation | undefined {
  return latestObservation(effectiveObservations(snapshot).filter(item => inScope(item, scope) && isNodeLevelRecord(item, scope)));
}

/**
 * Open tasks at or below this node: a unit sees its own, a floor sees its units',
 * a building sees everything inside it.
 */
export function openFollowUpsInScope(snapshot: OutreachSnapshot, scope: Scope): OpenFollowUp[] {
  return getOpenFollowUps(snapshot).filter(item => item.buildingId === scope.buildingId
    && (scope.unitId !== undefined ? item.unitId === scope.unitId
      : scope.floorId !== undefined ? item.floorId === scope.floorId
        : true));
}

/**
 * Coverage plus contact plus the open-task flag decide the state. The one statement
 * of the rule; `stateOf` is this applied to a recorded event, and the entry form asks
 * the same question about a choice it has not saved yet.
 */
function stateFor(coverage: CoverageStatus, contactOutcome: ContactOutcome | undefined, hasOpen: boolean): State {
  switch (coverage) {
    case "UNKNOWN":
    case "UNVISITED": return "GRAY";
    case "VISITED_NO_FINDING":
    case "VISITED_WITH_FINDING": return hasOpen ? "YELLOW" : "GREEN";
    case "PARTIAL": return hasOpen ? "YELLOW" : "RED";
    case "ATTEMPTED":
    case "INACCESSIBLE": return contactOutcome === "CONTACTED" ? (hasOpen ? "YELLOW" : "RED") : "RED";
    default: return "GRAY";
  }
}

/**
 * The state a choice would produce if saved now. Purely a preview for the entry form:
 * it writes nothing and reads no record. Kept here, beside the rule it quotes, so the
 * coloured dot on a choice can never disagree with the colour it later produces.
 */
export function previewState(coverage: CoverageStatus, contactOutcome: ContactOutcome | undefined, hasOpen: boolean): State {
  return stateFor(coverage, contactOutcome, hasOpen);
}

/**
 * Coverage plus the open-task flag decide the state. One function, three levels.
 *
 * `hasOpen` is an input, not an override: it only chooses between the two outcomes
 * of an inconclusive or intermediate visit. A failure stays red and an unvisited
 * node stays grey whether or not a task is outstanding — the task shows as a badge.
 */
export function stateOf(snapshot: OutreachSnapshot, scope: Scope, hasOpen: boolean): State {
  const observation = latestInScope(snapshot, scope);
  if (!observation) return "GRAY";
  return stateFor(observation.coverage, observation.contactOutcome, hasOpen);
}

/** All children the same colour → that colour. Any mixture → yellow. Nothing to read → undefined. */
export function aggregate(states: State[]): State | undefined {
  if (!states.length) return undefined;
  return states.every(state => state === states[0]) ? states[0] : "YELLOW";
}

/**
 * The latest unit event below this node, used to time the competition in `nodeState`.
 * Floors keep no record of their own, so only unit events count as "below".
 */
export function latestChildInScope(snapshot: OutreachSnapshot, scope: Scope): Observation | undefined {
  if (scope.unitId !== undefined) return undefined;
  return latestObservation(effectiveObservations(snapshot).filter(item => item.buildingId === scope.buildingId
    && item.unitId !== undefined && (scope.floorId === undefined || item.floorId === scope.floorId)));
}

/**
 * Yellow outranks green. Green means "done, with nothing outstanding" (§3.1), so a node
 * that still carries an open task anywhere inside it is not done, however finished its
 * coverage looks. Only green moves: red stays red (a failure is a fact, and the task
 * shows as a badge) and grey stays grey (nothing was ever recorded).
 *
 * This closes the aggregate path in `nodeState`, where a floor or building whose
 * children were all green came back green with a task still open under it.
 */
export function withOpenTasks(state: State, hasOpen: boolean): State {
  return hasOpen && state === "GREEN" ? "YELLOW" : state;
}

/**
 * A floor or building is decided by its own record and by its children, whichever
 * is newer — not by a plain fallback in either direction. A building record saying
 * "could not get in" must not be discarded just because units exist below it, and a
 * stale record must not override newer unit work.
 */
export function nodeState(snapshot: OutreachSnapshot, scope: Scope, childStates: State[], childLatest?: Observation): State {
  const own = latestInScope(snapshot, scope);
  const aggregated = aggregate(childStates);
  const hasOpen = openFollowUpsInScope(snapshot, scope).length > 0;
  const computed = !own ? aggregated
    : !childLatest || compareObservationTime(own, childLatest) >= 0 ? stateOf(snapshot, scope, hasOpen)
      : aggregated;
  return withOpenTasks(computed ?? "GRAY", hasOpen);
}

/** The state of one unit, from its own latest record. */
export function unitState(snapshot: OutreachSnapshot, buildingId: string, unitId: string): State {
  const scope: Scope = { buildingId, unitId };
  return stateOf(snapshot, scope, openFollowUpsInScope(snapshot, scope).length > 0);
}

/**
 * The state of one floor: purely the aggregate of its units. A floor keeps no record
 * of its own — entry and import only write unit or building records — so a legacy
 * floor-level event, if one exists, is history only and never decides the colour.
 */
export function floorState(snapshot: OutreachSnapshot, buildingId: string, floorId: string): State {
  const childStates = snapshot.units.filter(unit => unit.floorId === floorId).map(unit => unitState(snapshot, buildingId, unit.id));
  return withOpenTasks(aggregate(childStates) ?? "GRAY", openFollowUpsInScope(snapshot, { buildingId, floorId }).length > 0);
}

/** The state of one building: its own record against its floors, whichever is newer. */
export function buildingState(snapshot: OutreachSnapshot, buildingId: string): State {
  const scope: Scope = { buildingId };
  const childStates = snapshot.floors.filter(floor => floor.buildingId === buildingId).map(floor => floorState(snapshot, buildingId, floor.id));
  return nodeState(snapshot, scope, childStates, latestChildInScope(snapshot, scope));
}

/**
 * The manual FOLLOW_UP mark is a separate marker on the building or floor it was set
 * on. It never changes a colour, never cascades to units and never takes part in the
 * aggregate — the colour always says what the records say.
 */
export function isTagged(snapshot: OutreachSnapshot, subject: { buildingId: string; floorId?: string }): boolean {
  return subject.floorId !== undefined
    ? snapshot.floors.find(floor => floor.id === subject.floorId)?.tag === "FOLLOW_UP"
    : snapshot.buildings.find(building => building.id === subject.buildingId)?.tag === "FOLLOW_UP";
}

/**
 * Setting or clearing a mark. Clearing removes the field rather than storing a
 * "no mark" value, so an untagged node and a never-tagged one are the same thing.
 */
export function tagNode(snapshot: OutreachSnapshot, subject: { buildingId: string; floorId?: string }, tag?: NodeTag): OutreachSnapshot {
  const mark = <T extends { tag?: NodeTag }>(item: T): T => {
    const next = { ...item };
    if (tag) next.tag = tag; else delete next.tag;
    return next;
  };
  return {
    ...snapshot,
    buildings: snapshot.buildings.map(building => !subject.floorId && building.id === subject.buildingId ? mark(building) : building),
    floors: snapshot.floors.map(floor => subject.floorId && floor.id === subject.floorId ? mark(floor) : floor),
  };
}

export interface StateBreakdown { GREEN: number; YELLOW: number; RED: number; GRAY: number; }
/** Why an aggregated node is yellow: with no badge, the mixture itself is the reason. */
export function stateBreakdown(states: State[]): StateBreakdown {
  const counts: StateBreakdown = { GREEN: 0, YELLOW: 0, RED: 0, GRAY: 0 };
  for (const state of states) counts[state] += 1;
  return counts;
}

/* ------------------------------------------------------------------------- *
 * Markers. Both are driven by their own fact and never repaint the base colour.
 * ------------------------------------------------------------------------- */

export interface FollowUpBadge { category?: SupportCategory; action: string; dueDate?: string; assignee?: string; timingNote?: string; }
/**
 * One badge per distinct category, so three general tasks do not become three
 * badges. A task with no category gets an unlabelled badge rather than being
 * reported as GENERAL: "not classified" and "classified as general" differ.
 */
export function followUpBadges(snapshot: OutreachSnapshot, scope: Scope): FollowUpBadge[] {
  const tasks = openFollowUpsInScope(snapshot, scope);
  const byCategory = new Map<string, FollowUpBadge>();
  for (const task of tasks) {
    const key = task.category ?? "UNCATEGORISED";
    if (byCategory.has(key)) continue;
    byCategory.set(key, { category: task.category, action: task.action, dueDate: task.dueDate, assignee: task.assignee, timingNote: task.timingNote });
  }
  return [...byCategory.values()];
}

/**
 * The latest assessment that actually made a judgement. NOT_UPDATED means "this visit
 * did not revisit housing", so it leaves the candidate set rather than erasing what an
 * earlier visit concluded — the same shape as a correction superseding an event.
 */
export function currentAssessment(snapshot: OutreachSnapshot, unitId: string): HousingAssessment | undefined {
  return latestObservation(effectiveObservations(snapshot)
    .filter(item => item.unitId === unitId && item.assessment && item.assessment !== "NOT_UPDATED"))?.assessment;
}

/** SUSPECTED and STAFF_VERIFIED differ in how strong the evidence is, so they stay apart. */
export type ClueLevel = "SUSPECTED" | "VERIFIED" | "FINDING";
/**
 * A clue is either a finding recorded this visit, or a housing judgement that still
 * stands. The two read different events on purpose: the finding is what this visit
 * did, the judgement is a conclusion about the unit that an earlier visit reached.
 */
export function clueOf(snapshot: OutreachSnapshot, buildingId: string, unitId: string): ClueLevel | undefined {
  const assessment = currentAssessment(snapshot, unitId);
  if (assessment === "SUSPECTED") return "SUSPECTED";
  if (assessment === "STAFF_VERIFIED") return "VERIFIED";
  return latestInScope(snapshot, { buildingId, unitId })?.coverage === "VISITED_WITH_FINDING" ? "FINDING" : undefined;
}
