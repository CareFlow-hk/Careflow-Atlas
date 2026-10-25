/**
 * One row of the plan, opened into the cells it was read from (`docs/AI_ASSISTANT.md` 6.2).
 *
 * The person sees a value per header, not a parsed object: 「探訪日期 · 第 2 欄 · 2026-10-09」.
 * Changing one writes an override and the whole sheet is read again — the same path the
 * assistant's chat takes — so a hand edit cannot land in a row the rules would otherwise
 * refuse. A field the sheet has no column for is offered only when it is required or
 * already filled; filling it gives the parser a column of its own (`planEdits.ts`).
 *
 * Identity cells (record number, paper line, correction target) are shown but not editable:
 * changing them would rewrite which record this is, which is not an edit of its content.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { IDENTITY_FIELDS, canonicalOptions } from '../ai/contract';
import type { OutboundPreview } from '../ai/preview';
import { GENERIC_FIELDS, type ParsedRow } from '../imports/genericRows';
import type { CanonicalField } from '../imports/profiles';
import { cellKey, fieldKey, type EditSource, type PlanEdits } from './planEdits';

/**
 * Fields worth offering when the sheet has no column for them. Not every canonical field:
 * a blank row of thirty inputs is noise, and an unmapped identity field would be a way to
 * claim another record.
 */
const FILLABLE = new Set<CanonicalField>([
  'buildingName', 'floor', 'unit', 'occurredAt', 'occurredTime', 'worker', 'coverage',
  'contactOutcome', 'assessment', 'note', 'followUpAction', 'followUpDueDate',
]);

interface Item {
  key: string;
  label: string;
  hint: string;
  value: string;
  /** What the sheet itself says; typing it back removes the override. */
  original: string;
  readOnly: boolean;
  source?: EditSource;
}

export interface PlanRowFieldsProps {
  row: ParsedRow;
  /** The worksheet row as it is (raw cells), used only to show and restore the original. */
  values: readonly unknown[];
  preview: OutboundPreview;
  columns: Partial<Record<CanonicalField, number | null>>;
  edits: PlanEdits;
  onEdit: (key: string, value: string | null, source: EditSource) => void;
}

const text = (value: unknown) => value == null ? '' : String(value).trim();

function itemsOf({ row, values, preview, columns, edits }: Omit<PlanRowFieldsProps, 'onEdit'>): Item[] {
  const labels = new Map(canonicalOptions().map(option => [option.key, option.label]));
  const items: Item[] = [];
  const mapped = new Set<number>();

  for (const field of GENERIC_FIELDS) {
    const column = columns[field];
    if (typeof column !== 'number' || mapped.has(column)) continue;
    mapped.add(column);
    const key = cellKey(row.rowNumber, column);
    const original = text(values[column]);
    items.push({
      key, label: labels.get(field) ?? field,
      hint: `第 ${column + 1} 欄 · ${preview.headers[column] || '（無表頭）'}`,
      value: edits.values[key] ?? original, original,
      readOnly: IDENTITY_FIELDS.has(field), source: edits.sources[key],
    });
  }

  // A required field with no column can still be supplied here; the parser reads it like
  // any other cell (planEdits gives it a column past the sheet's width).
  for (const field of GENERIC_FIELDS) {
    if (typeof columns[field] === 'number' || !FILLABLE.has(field)) continue;
    const key = fieldKey(row.rowNumber, field);
    const edited = edits.values[key];
    if (edited === undefined) continue;
    items.push({
      key, label: labels.get(field) ?? field, hint: '原表沒有此欄（由你補上）',
      value: edited, original: '', readOnly: false, source: edits.sources[key],
    });
  }

  // Columns nobody mapped are not dropped: their values go into the note. They stay
  // editable because a typo in them is still a typo.
  for (let column = 0; column < preview.headers.length; column++) {
    if (mapped.has(column)) continue;
    const key = cellKey(row.rowNumber, column);
    const original = text(values[column]);
    const personal = preview.sensitiveColumns.includes(column);
    items.push({
      key, label: preview.headers[column] || `第 ${column + 1} 欄`,
      hint: personal ? '個人資料 · 會記在備註' : '原表有、未對應 · 會記在備註',
      value: edits.values[key] ?? original, original, readOnly: false, source: edits.sources[key],
    });
  }

  return items;
}

/**
 * A row that opens into its cells. The editor is mounted only once the row is opened: a
 * 700-row sheet would otherwise put thousands of inputs in the page before anyone asked
 * for one.
 */
export function RowDetails({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="cf-ai__rowedit" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {open ? children : null}
  </details>;
}

/** Fields the person may add when the sheet has no column for them. Rendered as a picker. */
export function PlanRowEditor(props: PlanRowFieldsProps) {
  const items = itemsOf(props);
  const missing = GENERIC_FIELDS.filter(field => FILLABLE.has(field)
    && typeof props.columns[field] !== 'number'
    && props.edits.values[fieldKey(props.row.rowNumber, field)] === undefined);
  return <>
    <div className="cf-ai__form">
      {items.map(item => <label key={item.key}>
        <span className="cf-ai__fieldlabel">
          {item.label}
          {item.source && <b className={`cf-ai__source is-${item.source}`}>{item.source === 'ai' ? 'AI 提議' : '人手改'}</b>}
        </span>
        <Cell item={item} onEdit={props.onEdit} />
        <small className="cf-ai__fieldhint">{item.hint}{item.readOnly ? '；此格決定記錄身分，不能改' : ''}</small>
      </label>)}
    </div>
    {missing.length > 0 && <AddField row={props.row.rowNumber} fields={missing} onEdit={props.onEdit} />}
  </>;
}

function Cell({ item, onEdit }: { item: Item; onEdit: PlanRowFieldsProps['onEdit'] }) {
  const [text_, setText] = useState(item.value);
  // The effective value can change under the input when a chat patch lands on this cell.
  useEffect(() => setText(item.value), [item.value]);
  const commit = () => {
    if (text_ === item.value) return;
    onEdit(item.key, text_ === item.original ? null : text_, 'person');
  };
  return <input value={text_} readOnly={item.readOnly} aria-readonly={item.readOnly}
    onChange={event => setText(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

/** Adds a value for a field this sheet never carried. */
function AddField({ row, fields, onEdit }: { row: number; fields: CanonicalField[]; onEdit: PlanRowFieldsProps['onEdit'] }) {
  const labels = new Map(canonicalOptions().map(option => [option.key, option.label]));
  const [field, setField] = useState<CanonicalField | ''>('');
  const [value, setValue] = useState('');
  const key = field ? fieldKey(row, field) : '';
  const commit = () => {
    if (!key || !value.trim()) return;
    onEdit(key, value.trim(), 'person');
    setField(''); setValue('');
  };
  return <div className="cf-ai__addfield">
    <span>這一行還缺什麼，可以直接補：</span>
    <select aria-label={`第 ${row} 行要補哪一欄`} value={field} onChange={event => setField(event.target.value as CanonicalField | '')}>
      <option value="">選擇欄位</option>
      {fields.map(item => <option key={item} value={item}>{labels.get(item) ?? item}</option>)}
    </select>
    <input aria-label={`第 ${row} 行補上的值`} value={value} placeholder="填寫內容" onChange={event => setValue(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter') commit(); }} />
    <button type="button" className="cf-button cf-button--ghost" disabled={!field || !value.trim()} onClick={commit}>補上</button>
  </div>;
}
