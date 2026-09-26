import { z } from 'zod';
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, FOLLOW_UP_STATUSES, HOUSING_ASSESSMENTS, SUPPORT_CATEGORIES, supersededObservationIds, getCorrectionConflicts, observationRootIds, type OutreachSnapshot } from './types';

const id = z.string().trim().min(1).max(200);
const text = z.string().max(6000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
export const instantSchema = z.string().datetime({ offset: true }).refine(value => date.safeParse(value.slice(0, 10)).success, 'Invalid calendar date');
export const occurrenceSchema = z.union([instantSchema, date]);
const base = { id, isSynthetic: z.literal(true), provisional: z.literal(true) };
const dates = { startsOn: date.optional(), endsOn: date.optional() };
export const observationSchema = z.object({
  ...base, visitId: id, buildingId: id, floorId: id.optional(), unitId: id.optional(),
  occurredAt: occurrenceSchema, recordedAt: instantSchema, workerName: id, coverage: z.enum(COVERAGE_STATUSES),
  assessment: z.enum(HOUSING_ASSESSMENTS).optional(), contactOutcome: z.enum(CONTACT_OUTCOMES).optional(),
  sourceType: z.enum(['STAFF_OBSERVATION', 'RESIDENT_REPORT', 'UNKNOWN']).optional(), evidence: z.array(text).max(100), note: text.optional(),
  followUp: z.object({ action: id, dueDate: date.optional(), status: z.enum(FOLLOW_UP_STATUSES), category: z.enum(SUPPORT_CATEGORIES).optional(), assignee: id.optional(), timingNote: text.optional() }).optional(), resolvesObservationId: id.optional(),
  paperRef: id.optional(), paperLine: id.optional(), importSource: z.object({ file: id, sheet: id, row: z.number().int().positive() }).optional(),
  correctsObservationId: id.optional(), correctionReason: text.optional(),
}).refine(v => v.followUp?.status !== 'DONE' || !!v.resolvesObservationId, 'Completion must identify the original follow-up');

/** Validate every entity at the replaceable storage/data boundary. */
export const snapshotSchema = z.object({
  schemaVersion: z.literal('0.1-demo'), isSynthetic: z.literal(true), notice: text,
  buildings: z.array(z.object({ ...base, name: id, address: id, coordinates: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-85).max(85) }), floorCount: z.number().int().min(1).max(100).optional(), footprint: z.array(z.array(z.number()).length(2)).min(4).max(512).optional(), layoutDeclared: z.boolean(), initialCoverage: z.enum(COVERAGE_STATUSES).optional() })),
  floors: z.array(z.object({ ...base, buildingId: id, level: z.number().int().min(-10).max(100), label: id })),
  units: z.array(z.object({ ...base, buildingId: id, floorId: id, label: id, initialCoverage: z.enum(COVERAGE_STATUSES).optional() })),
  households: z.array(z.object({ ...base, label: text.optional() })), people: z.array(z.object({ ...base, displayName: id, phone: z.string().max(80).optional(), addressNote: text.optional(), contactNote: text.optional() })),
  householdMemberships: z.array(z.object({ ...base, householdId: id, personId: id, relationship: text.optional() })),
  householdResidences: z.array(z.object({ ...base, householdId: id, buildingId: id, unitId: id.optional(), ...dates, locationNote: text.optional() })),
  memberships: z.array(z.object({ ...base, personId: id, status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'UNKNOWN']), ...dates })),
  visits: z.array(z.object({ ...base, occurredAt: occurrenceSchema, recordedAt: instantSchema, workerName: id, note: text.optional() })), observations: z.array(observationSchema),
}).superRefine((data, ctx) => {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const map = <T extends { id: string }>(items: T[]) => new Map(items.map(item => [item.id, item]));
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    const ids = new Set<string>(); rows.forEach((r, i) => { if (ids.has(r.id)) bad([key, i, 'id'], 'Duplicate record id'); ids.add(r.id); });
  }
  const buildings = map(data.buildings), floors = map(data.floors), units = map(data.units), visits = map(data.visits), households = map(data.households), people = map(data.people), observations = map(data.observations);
  data.floors.forEach((f, i) => { if (!buildings.get(f.buildingId)?.layoutDeclared) bad(['floors', i, 'buildingId'], 'Floor requires declared building layout'); });
  data.units.forEach((u, i) => { if (!buildings.has(u.buildingId) || floors.get(u.floorId)?.buildingId !== u.buildingId) bad(['units', i, 'floorId'], 'Floor and building must match'); });
  data.buildings.forEach((b, i) => {
    if (b.floorCount && data.floors.filter(f => f.buildingId === b.id).length !== b.floorCount) bad(['buildings', i, 'floorCount'], 'Declared floor count must match supplied floors');
    if (b.footprint && (JSON.stringify(b.footprint[0]) !== JSON.stringify(b.footprint.at(-1)) || b.footprint.some(p => Math.abs(p[0]) > 180 || Math.abs(p[1]) > 85))) bad(['buildings', i, 'footprint'], 'Footprint must be a closed longitude/latitude polygon');
  });
  data.householdMemberships.forEach((m, i) => { if (!households.has(m.householdId) || !people.has(m.personId)) bad(['householdMemberships', i], 'Unknown household or person'); });
  data.householdResidences.forEach((r, i) => { if (!households.has(r.householdId) || !buildings.has(r.buildingId) || (r.unitId && units.get(r.unitId)?.buildingId !== r.buildingId)) bad(['householdResidences', i], 'Inconsistent residence reference'); });
  data.memberships.forEach((m, i) => { if (!people.has(m.personId)) bad(['memberships', i, 'personId'], 'Unknown person'); });
  for (const key of ['householdResidences', 'memberships'] as const) data[key].forEach((r, i) => { if (r.startsOn && r.endsOn && r.endsOn < r.startsOn) bad([key, i, 'endsOn'], 'End precedes start'); });
  const roots = observationRootIds(data.observations);
  const resolved = new Set<string>();
  const superseded = supersededObservationIds(data.observations);
  data.observations.forEach((o, i) => {
    if (!visits.has(o.visitId) || !buildings.has(o.buildingId)) bad(['observations', i], 'Unknown visit or building');
    if (o.floorId && floors.get(o.floorId)?.buildingId !== o.buildingId) bad(['observations', i, 'floorId'], 'Floor and building must match');
    if (o.unitId && (units.get(o.unitId)?.buildingId !== o.buildingId || units.get(o.unitId)?.floorId !== o.floorId)) bad(['observations', i, 'unitId'], 'Unit, floor and building must match');
    if (o.resolvesObservationId) {
      const origin = observations.get(o.resolvesObservationId);
      if (!origin || origin.id === o.id || origin.followUp?.status !== 'OPEN' || origin.buildingId !== o.buildingId || origin.floorId !== o.floorId || origin.unitId !== o.unitId || Date.parse(origin.recordedAt) > Date.parse(o.recordedAt)) bad(['observations', i, 'resolvesObservationId'], 'Resolution must follow an open task at the same location');
      if (!superseded.has(o.id)) {
        const target = roots.get(o.resolvesObservationId) ?? o.resolvesObservationId;
        if (resolved.has(target)) bad(['observations', i, 'resolvesObservationId'], 'Follow-up already resolved');
        resolved.add(target);
      }
    }
  });
  // A correction never rewrites its original; it must name one, and the chain must terminate.
  data.observations.forEach((o, i) => {
    if (!o.correctsObservationId) return;
    if (!observations.has(o.correctsObservationId) || o.correctsObservationId === o.id) { bad(['observations', i, 'correctsObservationId'], 'Correction must name an existing other event'); return; }
    const original = observations.get(o.correctsObservationId)!;
    if (Date.parse(o.recordedAt) < Date.parse(original.recordedAt)) bad(['observations', i, 'recordedAt'], 'Correction cannot precede its original recording');
    const taskChanged = JSON.stringify(original.followUp) !== JSON.stringify(o.followUp) || original.resolvesObservationId !== o.resolvesObservationId;
    if (taskChanged && !o.correctionReason?.trim()) bad(['observations', i, 'correctionReason'], '更改跟進或結案關係時，請填更正原因。');
    const seen = new Set<string>([o.id]);
    let cursor: string | undefined = o.correctsObservationId;
    while (cursor) {
      if (seen.has(cursor)) { bad(['observations', i, 'correctsObservationId'], 'Correction chain must not loop'); return; }
      seen.add(cursor);
      cursor = observations.get(cursor)?.correctsObservationId;
    }
  });
  // Two live corrections for one original cannot be ordered by time; a human must pick one.
  for (const conflict of getCorrectionConflicts(data)) bad(['observations'], `Two correction branches for ${conflict.observationId}; keep one and resubmit the other`);
});
export function validateSnapshot(value: unknown): OutreachSnapshot { return snapshotSchema.parse(value); }
