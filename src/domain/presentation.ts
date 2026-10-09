/** Every colour, every display label and every entry option in the product.
 *
 * Nothing outside this module may define a colour value or a status wording. The
 * one deliberate exception is the paper/Excel vocabulary below, which is a
 * separate view of the same data and is commented as such.
 */
import { CONTACT_OUTCOMES, COVERAGE_STATUSES, HOUSING_ASSESSMENTS, SOURCE_TYPES, SUPPORT_CATEGORIES, type ClueLevel, type FollowUpEventAction, type ContactOutcome, type CoverageStatus, type HousingAssessment, type SourceType, type State, type StateBreakdown, type SupportCategory } from './types';

/* ---------------------------------------------------------------- states --- */

/** The legend and the four-state model read the same two tables. */
export const stateLabels: Record<State, string> = {
  GREEN: '已完成',
  YELLOW: '需留意',
  RED: '未能完成',
  GRAY: '尚待了解',
};

/* Atlas palette (UI option B, 2026-09-29): muted, printed-map tones. */
export const stateColors: Record<State, string> = {
  GREEN: '#5a8462',
  YELLOW: '#c58c38',
  RED: '#a94b3b',
  GRAY: '#c3bcad',
};

/** The same four hues, deepened. Selection changes brightness only, never meaning. */
export const stateSelectedColors: Record<State, string> = {
  GREEN: '#476b4e',
  YELLOW: '#a6742b',
  RED: '#8b3c2f',
  GRAY: '#a39c8c',
};

/**
 * Yellow carries two meanings: "there is a task here" and "the units below do not
 * agree". The legend has to cover both, so it cannot say "待跟進" — see the badge
 * for what the task actually is.
 */
export const stateLegendNotes: Record<State, string> = {
  GREEN: '已探訪並有記錄，沒有未完成的跟進',
  YELLOW: '有跟進項目，或下層狀態混雜',
  RED: '探訪失敗、未能進入或未完成',
  GRAY: '未探訪或未有可靠記錄',
};

/**
 * Map chrome and context geometry. Not business states: nothing here is ever chosen
 * by the pipeline, it is the backdrop the four states are drawn on.
 */
export const mapSceneColors = {
  contextBuilding: '#ebe7de',
  selectionOutline: '#1d2622',
  light: '#fffaf0',
  /* The basemap is re-inked in the same printed-map tones as the panels. */
  paper: '#efe9dc',
  water: '#d3d9cf',
  park: '#e2e2cd',
  landuse: '#e9e2d2',
  basemapBuilding: '#e6e1d6',
} as const;

/** Neutral paper/image colours, never used to imply an outreach status. */
export const photoPaperColors = { background: '#ffffff', paper: '#fffcf4', ink: '#242e29', rule: '#9b9180', grid: '#c9bda9', handwriting: '#494f65', annotation: '#855539', caption: '#9a6952' } as const;

/** Reads an aggregated node's composition, e.g. "2 綠 · 1 紅 · 3 未訪". */
export const breakdownLabels: Record<State, string> = { GREEN: '綠', YELLOW: '黃', RED: '紅', GRAY: '未訪' };
export function breakdownLabel(counts: StateBreakdown): string {
  return (Object.keys(breakdownLabels) as State[])
    .filter(state => counts[state] > 0)
    .map(state => `${counts[state]} ${breakdownLabels[state]}`)
    .join(' · ');
}

/* ------------------------------------------------------- interface labels --- */
/* These are what a person reads on screen. The three former copies
 * (presentation.ts, ObservationHistory.tsx, BuildingDetail.tsx) disagreed; each
 * value below was chosen deliberately rather than inherited from the first copy:
 *   UNKNOWN  — '暫無可靠記錄' over '覆蓋未明' (jargon) and '未能確定' (collides
 *              with the contact-outcome wording for a different axis).
 *   VISITED_* — the '已訪，…' wording, which says what happened rather than what
 *              was looked at.
 *   assessment UNKNOWN/STAFF_VERIFIED — the longer forms that name the axis, so a
 *              chip is never ambiguous once both axes are shown side by side.
 */

/*
 * The two values the entry form now stores read back as the form's own wording, so
 * a person sees what they picked: 未能完成探訪 stores ATTEMPTED and 已完成探訪 stores
 * VISITED_NO_FINDING. Older records with the finer values (PARTIAL, INACCESSIBLE,
 * VISITED_WITH_FINDING) keep their more specific wording. Paper/Excel wording below
 * is a separate vocabulary and is not changed by this.
 */
export const coverageLabels: Record<CoverageStatus, string> = {
  UNKNOWN: '暫無可靠記錄', UNVISITED: '未到訪', ATTEMPTED: '未能完成探訪',
  PARTIAL: '部分完成', VISITED_NO_FINDING: '已完成探訪',
  VISITED_WITH_FINDING: '已訪，有記錄', INACCESSIBLE: '未能進入',
};

export const contactLabels: Record<ContactOutcome, string> = {
  NOT_ATTEMPTED: '未嘗試接觸', NO_ANSWER: '無人應門', DECLINED: '住戶婉拒',
  CONTACTED: '已接觸', UNKNOWN: '接觸結果未明',
};

export const assessmentLabels: Record<HousingAssessment, string> = {
  NOT_UPDATED: '今次未更新住房判斷', UNKNOWN: '住房情況未能確定',
  SUSPECTED: '疑似劏房，尚待核實', NO_INDICATION: '今次未見相關跡象',
  STAFF_VERIFIED: '工作人員已確認',
};

export const sourceLabels: Record<SourceType, string> = {
  STAFF_OBSERVATION: '工作人員觀察', RESIDENT_REPORT: '居民口述', UNKNOWN: '其他來源',
};

export const supportCategoryLabels: Record<SupportCategory, string> = {
  GENERAL: '一般跟進', HOUSING_CHANGE: '住屋變動', HEALTH_SUPPORT: '健康關懷', SERVICE_INVITATION: '服務邀約',
};
/** A task with no category is shown as unclassified, never silently as 一般跟進. */
export const uncategorisedFollowUpLabel = '待跟進';

/** What a person did to a task in the app, as the trail reads it. */
export const followUpEventLabels: Record<FollowUpEventAction, string> = {
  DONE: '標記完成', CANCELLED: '取消跟進', REOPENED: '撤銷',
};
/** The task's status line once an app event has closed it. */
export const followUpClosedLabels: Record<Exclude<FollowUpEventAction, 'REOPENED'>, string> = {
  DONE: '已標記完成', CANCELLED: '已取消',
};
/** The separate marker a building or floor carries when someone tagged it. */
export const nodeTagLabel = '已標記跟進';

/** The two clue levels stay apart: they differ in how strong the evidence is. */
export const clueLabels: Record<ClueLevel, string> = {
  SUSPECTED: '疑似劏房線索', VERIFIED: '已確認劏房', FINDING: '有記錄發現',
};

/* ------------------------------------------------------ paper/Excel labels --- */
/*
 * DELIBERATE DIVERGENCE — do not "tidy up" by pointing these at the interface
 * labels above. These strings are what the paper sheet and the exported workbook
 * contain, and the workbook is a round-trip format: a changed spelling would be
 * read back as a different value, and the W0 recognition vocabulary is built from
 * them. Wording here is tuned for a printed column, not for a screen.
 */
export const exportCoverageLabels: Record<CoverageStatus, string> = {
  UNKNOWN: '暫無可靠記錄', UNVISITED: '確認尚未到訪', ATTEMPTED: '已嘗試接觸',
  PARTIAL: '部分有記錄', VISITED_NO_FINDING: '已查看・無發現',
  VISITED_WITH_FINDING: '已查看・有線索', INACCESSIBLE: '未能進入',
};
export const exportContactLabels: Record<ContactOutcome, string> = {
  NOT_ATTEMPTED: '未嘗試接觸', NO_ANSWER: '無人應門', DECLINED: '住戶婉拒', CONTACTED: '已接觸', UNKNOWN: '未能確定',
};
export const exportAssessmentLabels: Record<HousingAssessment, string> = {
  NOT_UPDATED: '今次未更新', UNKNOWN: '未能確定', SUSPECTED: '疑似，待核實',
  NO_INDICATION: '未見相關跡象', STAFF_VERIFIED: '工作人員已確認',
};
export const exportSourceLabels: Record<SourceType, string> = {
  STAFF_OBSERVATION: '工作人員觀察', RESIDENT_REPORT: '居民口述', UNKNOWN: '來源未明',
};

/* --------------------------------------------------------------- options --- */
/*
 * Entry is reduced to three choices per field (housing and source may also be left
 * blank). The wording a person picks is not what gets stored: each choice resolves
 * to one canonical value from the full vocabulary, so old records keep their exact
 * value and no migration is needed. See COLOR_PIPELINE_DESIGN.md §10.
 */

export const COVERAGE_GROUPS = ['UNVISITED', 'INCOMPLETE', 'COMPLETED'] as const;
export type CoverageGroup = (typeof COVERAGE_GROUPS)[number];

export interface OptionGroup<G extends string, V extends string> {
  group: G; label: string;
  /** Every stored value this choice stands for. */
  covers: readonly V[];
  /** The value written when this choice is picked. */
  canonical: V;
  hint?: string;
}

export const coverageOptionGroups: readonly OptionGroup<CoverageGroup, CoverageStatus>[] = [
  { group: 'UNVISITED', label: '未到訪', covers: ['UNKNOWN', 'UNVISITED'], canonical: 'UNVISITED' },
  { group: 'INCOMPLETE', label: '未能完成探訪', covers: ['ATTEMPTED', 'INACCESSIBLE', 'PARTIAL'], canonical: 'ATTEMPTED', hint: '未能進入或只完成一部分' },
  { group: 'COMPLETED', label: '已完成探訪', covers: ['VISITED_NO_FINDING', 'VISITED_WITH_FINDING'], canonical: 'VISITED_NO_FINDING', hint: '住房線索請在「住房判斷」記錄' },
];

export const CONTACT_GROUPS = ['NOT_ATTEMPTED', 'NOT_REACHED', 'CONTACTED'] as const;
export type ContactGroup = (typeof CONTACT_GROUPS)[number];

export const contactOptionGroups: readonly OptionGroup<ContactGroup, ContactOutcome>[] = [
  { group: 'NOT_ATTEMPTED', label: '未嘗試接觸', covers: ['NOT_ATTEMPTED'], canonical: 'NOT_ATTEMPTED' },
  { group: 'NOT_REACHED', label: '未能接觸', covers: ['NO_ANSWER', 'DECLINED', 'UNKNOWN'], canonical: 'NO_ANSWER', hint: '無人應門或住戶婉拒' },
  { group: 'CONTACTED', label: '已接觸', covers: ['CONTACTED'], canonical: 'CONTACTED' },
];

/** Housing and source may be left blank, which is not the same as picking a value. */
export const assessmentOptions: readonly { value: HousingAssessment; label: string }[] = [
  { value: 'NO_INDICATION', label: '未見相關跡象' },
  { value: 'SUSPECTED', label: assessmentLabels.SUSPECTED },
  { value: 'STAFF_VERIFIED', label: '已確認' },
];

export const sourceOptions: readonly { value: SourceType; label: string }[] = [
  { value: 'STAFF_OBSERVATION', label: '工作人員觀察' },
  { value: 'RESIDENT_REPORT', label: '居民口述' },
  // "We could not establish the source" — not the same as the row's 「其他」, which is a
  // source the list does not name and the recorder writes out in their own words.
  { value: 'UNKNOWN', label: '來源未能確定' },
];

/** The value a blank housing choice stores: "this visit did not revisit housing". */
export const BLANK_ASSESSMENT: HousingAssessment = 'NOT_UPDATED';

export function coverageGroupOf(status: CoverageStatus): CoverageGroup {
  return coverageOptionGroups.find(option => option.covers.includes(status))?.group ?? 'UNVISITED';
}
export function canonicalCoverageOf(group: CoverageGroup): CoverageStatus {
  return coverageOptionGroups.find(option => option.group === group)?.canonical ?? 'UNVISITED';
}
export function contactGroupOf(outcome: ContactOutcome): ContactGroup {
  return contactOptionGroups.find(option => option.covers.includes(outcome))?.group ?? 'NOT_ATTEMPTED';
}

/* ---------------------------------------------------- accepted vocabulary --- */
/*
 * Input compatibility, not a colour standard (§10.5). Every wording that has ever
 * been written into a sheet stays readable: simplifying what the form offers must
 * never make an old file unreadable. These tables are only ever added to.
 */

/** Wordings an earlier version of this product wrote, and no longer writes. */
export const retiredLabels = {
  coverage: { '覆蓋未明': 'UNKNOWN', '曾嘗試': 'ATTEMPTED', '已訪，無記錄發現': 'VISITED_NO_FINDING' },
  contact: {},
  assessment: { '由工作人員確認': 'STAFF_VERIFIED' },
  source: {},
} as const;

/**
 * Every wording that means a value — the interface's, the paper's, the retired ones
 * and the entry options' — collapsed onto that value. Reading an old sheet and
 * reading a new one land on the same stored enum.
 */
function acceptedMap<V extends string>(values: readonly V[], tables: readonly Record<string, string>[], retired: Record<string, string>, extras: readonly (readonly [string, V])[]): Record<string, V> {
  // A retired table is already keyed by its wording, so it merges as it stands.
  const map: Record<string, V> = { ...retired } as Record<string, V>;
  for (const value of values) for (const table of tables) { const wording = table[value]; if (wording) map[wording] = value; }
  for (const [wording, value] of extras) map[wording] = value;
  return map;
}

export const acceptedCoverage = acceptedMap(COVERAGE_STATUSES, [exportCoverageLabels, coverageLabels], retiredLabels.coverage, coverageOptionGroups.map(option => [option.label, option.canonical] as const));
export const acceptedContact = acceptedMap(CONTACT_OUTCOMES, [exportContactLabels, contactLabels], retiredLabels.contact, contactOptionGroups.map(option => [option.label, option.canonical] as const));
export const acceptedAssessment = acceptedMap(HOUSING_ASSESSMENTS, [exportAssessmentLabels, assessmentLabels], retiredLabels.assessment, assessmentOptions.map(option => [option.label, option.value] as const));
export const acceptedSource = acceptedMap(SOURCE_TYPES, [exportSourceLabels, sourceLabels], retiredLabels.source, sourceOptions.map(option => [option.label, option.value] as const));

function vocabulary<V extends string>(values: readonly V[], accepted: Record<string, V>): string[] {
  return [...new Set([...values, ...Object.keys(accepted)])];
}

/** What the W0 detector may call a known value. Only ever grows. */
export const recognitionCoverageValues = vocabulary(COVERAGE_STATUSES, acceptedCoverage);
export const recognitionContactValues = vocabulary(CONTACT_OUTCOMES, acceptedContact);
export const recognitionAssessmentValues = vocabulary(HOUSING_ASSESSMENTS, acceptedAssessment);
export const recognitionSourceValues = vocabulary(SOURCE_TYPES, acceptedSource);
export const recognitionCategoryValues = [...SUPPORT_CATEGORIES, ...Object.values(supportCategoryLabels)];
