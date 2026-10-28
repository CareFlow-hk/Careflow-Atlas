import { canonicalCoverageOf, coverageGroupOf } from '../domain/presentation';
import { latestCoverageForUnit, type CoverageStatus, type HousingAssessment, type OutreachSnapshot, type Unit } from '../domain/types';

/**
 * The 覆蓋狀態 a 劏房 room's entry form opens with: the last record that speaks for the room,
 * or nothing.
 *
 * Following the last record saves re-answering a room that has been visited before, and the
 * form says out loud that the value is carried over, so it is checked rather than trusted.
 * A room with nothing of its own follows the unit it was split from — that visit covered the
 * space the room now stands in, so the room's history starts there rather than at nothing.
 *
 * With no record at all there is nothing to follow, and the form opens unanswered. 已完成探訪
 * is the ordinary outcome, but ordinary is not observed: a pre-selected result nobody stated
 * is a result the record would be claiming on its own (review, 2026-10-15).
 *
 * The stored value is mapped back through its group, so an imported PARTIAL or INACCESSIBLE
 * lights up 未能完成探訪 rather than a choice that is not on the form.
 */
export function inheritedCoverage(last: { coverage: CoverageStatus } | undefined): CoverageStatus | undefined {
  return last ? canonicalCoverageOf(coverageGroupOf(last.coverage)) : undefined;
}

/**
 * What a 劏房 room's entry form opens with, read from the records as the form opens rather
 * than remembered in the screen's state: a reload, or another way into the same room, gives
 * the same form.
 *
 * 住房判斷 is answered because the room *is* a room: the split is the operator's own
 * structural statement, and the confirmed answer restates it rather than adding to it.
 * 覆蓋狀態 is a statement about a visit, which only a visit can make, so it follows the last
 * record — and the form shows it as carried over. An ordinary unit opens unanswered.
 */
export function roomFormDefaults(snapshot: OutreachSnapshot, unit: Unit | undefined): { coverage?: CoverageStatus; assessment?: HousingAssessment } {
  if (!unit?.parentUnitId) return {};
  // The last record that actually stated a result: a later visit recorded without coverage
  // did not change what the room stands at, so it is not what the form follows either.
  return { coverage: inheritedCoverage(latestCoverageForUnit(snapshot, unit.id)), assessment: 'STAFF_VERIFIED' };
}
