import { assessmentOptions, contactOptionGroups, coverageOptionGroups, sourceOptions } from './presentation';
import { OPTION_FIELDS, type CoverageStatus, type OptionField } from './types';

/*
 * Self-defined choices (COLOR_PIPELINE_DESIGN.md §10.4).
 *
 * A custom option is a person's own wording plus a declaration of which built-in
 * choice it stands for. The declaration is the whole point: the four-state pipeline
 * reads `mapsTo` and nothing else, so a custom option can never invent a fifth state
 * or make a colour ambiguous. The wording is display only.
 *
 * Storage follows the same split: the observation keeps its ordinary enum value, and
 * the person's wording goes beside it in `optionNotes`. No custom text ever enters an
 * enum, so old records keep reading exactly as they did.
 *
 * Only what a person adds lives here. The built-in choices are the pipeline's own
 * vocabulary and are never editable — see `builtInChoices`.
 */

export interface CustomOption {
  id: string;
  label: string;
  /** One of the field's built-in values. The only thing the pipeline ever reads. */
  mapsTo: string;
  /** Hidden options stay out of the menu; records that used them still display. */
  hidden?: boolean;
}

export type CustomOptions = Partial<Record<OptionField, CustomOption[]>>;

/** One built-in choice, flattened from whichever shape its field uses. */
export interface FieldChoice { value: string; label: string; hint?: string }

/**
 * The three built-in choices of a field — locked, never deletable (§10.4: the
 * pipeline depends on them). Compliance with the three-choice rule is a test, not a
 * convention: see optionPrefs.test.ts.
 */
export function builtInChoices(field: OptionField): readonly FieldChoice[] {
  switch (field) {
    case 'coverage': return coverageOptionGroups.map(option => ({ value: option.canonical, label: option.label, hint: option.hint }));
    case 'contactOutcome': return contactOptionGroups.map(option => ({ value: option.canonical, label: option.label, hint: option.hint }));
    case 'assessment': return assessmentOptions.map(option => ({ value: option.value, label: option.label }));
    case 'sourceType': return sourceOptions.map(option => ({ value: option.value, label: option.label }));
  }
}

/** A custom option may only stand for a value its own field actually accepts. */
export function isMappedValue(field: OptionField, mapsTo: string): boolean {
  return builtInChoices(field).some(choice => choice.value === mapsTo);
}

/** What the menu offers: every built-in, then the custom options left visible. */
export function menuChoices(field: OptionField, prefs: CustomOptions): { value: string; label: string; hint?: string }[] {
  return [
    ...builtInChoices(field).map(choice => ({ value: choice.value, label: choice.label, hint: choice.hint })),
    ...customOptions(prefs, field).filter(option => !option.hidden).map(option => ({ value: choiceValue(option), label: option.label })),
  ];
}

/*
 * A custom choice needs a value that survives the form round trip and stays
 * distinguishable from the built-ins, which are bare enum values. The prefix keeps
 * the two apart; the id keeps two custom options with the same wording apart.
 */
const CUSTOM_PREFIX = 'custom:';
export const choiceValue = (option: CustomOption) => `${CUSTOM_PREFIX}${option.id}`;
export const customIdOf = (value: string) => value.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : undefined;

/** The custom option a submitted value refers to, or undefined for a built-in. */
export function customOptionFor(field: OptionField, prefs: CustomOptions, value: string): CustomOption | undefined {
  const id = customIdOf(value);
  return id ? customOptions(prefs, field).find(option => option.id === id) : undefined;
}

export function customOptions(prefs: CustomOptions, field: OptionField): CustomOption[] {
  return prefs[field] ?? [];
}

/**
 * Ids are derived from the wording rather than drawn at random, so adding the same
 * option twice is reproducible and a stored preference list stays readable. Uniqueness
 * only has to hold inside one field, which is where the menu reads it.
 */
export function nextOptionId(prefs: CustomOptions, field: OptionField, label: string): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "") || "option";
  const taken = new Set(customOptions(prefs, field).map(option => option.id));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) if (!taken.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

export function addCustomOption(prefs: CustomOptions, field: OptionField, option: { label: string; mapsTo: string }): CustomOptions {
  const label = option.label.trim();
  if (!label || !isMappedValue(field, option.mapsTo)) return prefs;
  return { ...prefs, [field]: [...customOptions(prefs, field), { id: nextOptionId(prefs, field, label), label, mapsTo: option.mapsTo }] };
}

export function setCustomOptionHidden(prefs: CustomOptions, field: OptionField, id: string, hidden: boolean): CustomOptions {
  return { ...prefs, [field]: customOptions(prefs, field).map(option => option.id === id ? { ...option, hidden } : option) };
}

/**
 * Deleting is safe for the same reason hiding is: a record keeps its enum value and
 * its own wording, so nothing it wrote depends on this list still containing the
 * option. The two are offered separately because "not in my way" and "gone" differ.
 */
export function removeCustomOption(prefs: CustomOptions, field: OptionField, id: string): CustomOptions {
  return { ...prefs, [field]: customOptions(prefs, field).filter(option => option.id !== id) };
}

/**
 * Reads stored preferences back. Anything that does not resolve to a built-in value
 * is dropped rather than repaired: a preference that cannot name its state would
 * colour something by a rule nobody chose.
 */
/* ------------------------------------------------ dependent defaults (§ entry) --- */
/*
 * The four fields are not independent, and making a person set each one says otherwise.
 * "Not visited" already answers "did you reach anyone" and "did you reassess housing",
 * so those two are filled in rather than asked.
 *
 * "Already answered" is judged against the value the dependent field had when the
 * controlling field last changed — not against the last automatic suggestion. So a
 * person who deliberately picks "reached them" and then changes coverage to "not
 * visited" gets the pair reset, because the two now contradict each other; but a
 * person who picks "reached them" afterwards keeps it.
 */

/** The built-in value a field falls back to when the controlling coverage implies it. */
export function impliedByCoverage(field: OptionField, coverage: string): string | undefined {
  const choice = coverageOptionChoices(coverage);
  if (!choice) return undefined;
  switch (field) {
    case 'coverage': return undefined;
    case 'contactOutcome': return choice.contact;
    /*
     * "Not updated" is the empty choice in the form, not the stored NOT_UPDATED value:
     * leaving a field out of the record is how "we did not look this time" is kept apart
     * from "we looked and saw nothing".
     */
    case 'assessment': return '';
    case 'sourceType': return choice.source;
  }
}

interface ImpliedChoice { contact: string; source: string }

function coverageOptionChoices(coverage: string): ImpliedChoice | undefined {
  /* Read off the built-in grouping rather than retyped, so a renamed option follows
     along. Which contact a coverage implies is a reading of that coverage: "not
     visited" cannot have reached anyone, "completed" got in. */
  const group = coverageOptionGroups.find(option => option.covers.includes(coverage as CoverageStatus) || option.canonical === coverage)?.group;
  switch (group) {
    case 'UNVISITED': return { contact: 'NOT_ATTEMPTED', source: 'STAFF_OBSERVATION' };
    case 'INCOMPLETE': return { contact: 'NO_ANSWER', source: 'STAFF_OBSERVATION' };
    case 'COMPLETED': return { contact: 'CONTACTED', source: 'STAFF_OBSERVATION' };
    default: return undefined;
  }
}

export interface DependentFieldState { value: string; touched: boolean }
export type DependentFields = Partial<Record<OptionField, DependentFieldState>>;

/** The values a coverage choice would set the dependent fields to. */
export function dependentDefaults(coverage: string): DependentFields {
  const next: DependentFields = {};
  for (const field of OPTION_FIELDS) {
    const implied = impliedByCoverage(field, coverage);
    if (implied !== undefined) next[field] = { value: implied, touched: false };
  }
  return next;
}

/**
 * Applies a coverage change to the dependent fields. A field the person has answered
 * since the last coverage change is left exactly as they set it.
 */
export function applyCoverageChange(fields: DependentFields, coverage: string): DependentFields {
  const defaults = dependentDefaults(coverage);
  const next: DependentFields = { ...fields };
  for (const field of OPTION_FIELDS) {
    const fallback = defaults[field];
    if (!fallback) continue;
    const current = fields[field];
    if (current?.touched) continue;
    next[field] = fallback;
  }
  return next;
}

/** Records a deliberate answer, which later coverage changes must not overwrite. */
export function markTouched(fields: DependentFields, field: OptionField, value: string): DependentFields {
  return { ...fields, [field]: { value, touched: true } };
}

export function parseCustomOptions(value: unknown): CustomOptions {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const result: CustomOptions = {};
  for (const field of OPTION_FIELDS) {
    const list = source[field];
    if (!Array.isArray(list)) continue;
    const kept = list.flatMap((item): CustomOption[] => {
      if (!item || typeof item !== 'object') return [];
      const option = item as Partial<CustomOption>;
      if (typeof option.id !== 'string' || typeof option.label !== 'string' || typeof option.mapsTo !== 'string') return [];
      if (!option.id || !option.label.trim() || !isMappedValue(field, option.mapsTo)) return [];
      return [{ id: option.id, label: option.label, mapsTo: option.mapsTo, ...(option.hidden ? { hidden: true } : {}) }];
    });
    if (kept.length) result[field] = kept;
  }
  return result;
}
