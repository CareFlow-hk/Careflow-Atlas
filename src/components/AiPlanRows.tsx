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
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { IDENTITY_FIELDS, canonicalOptions } from '../ai/contract';
import type { OutboundPreview } from '../ai/preview';
import { acceptedAssessment, acceptedContact, acceptedCoverage, acceptedSource, assessmentLabels, contactLabels, aiCoverageLabels, sourceLabels } from '../domain/presentation';
import { GENERIC_FIELDS, readOption, type ParsedRow } from '../imports/genericRows';
import type { CanonicalField } from '../imports/profiles';
import { cellKey, fieldEditKey, fieldKey, type EditSource, type PlanEdits } from './planEdits';

/**
 * Fields worth offering when the sheet has no column for them. Not every canonical field:
 * a blank row of thirty inputs is noise, and an unmapped identity field would be a way to
 * claim another record.
 */
const FILLABLE = new Set<CanonicalField>([
  'buildingName', 'floor', 'unit', 'occurredAt', 'occurredTime', 'worker', 'coverage',
  'contactOutcome', 'assessment', 'sourceType', 'note', 'followUpAction', 'followUpDueDate',
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
  /** A date or time input reads and writes the same string the parser does. */
  type?: 'text' | 'date' | 'time';
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
  return <input type={item.type ?? 'text'} value={text_} readOnly={item.readOnly} aria-readonly={item.readOnly}
    onChange={event => setText(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

/** Why a row is not in the plan, in the person's words rather than an issue code. */
function skipReason(row: ParsedRow): string {
  if (row.suspectedDuplicateOf) return '疑似與現有記錄重複，未自動寫入；請先在記錄歷史核對。';
  if (row.suspectedDuplicateOfRow) return `疑似與檔內第 ${row.suspectedDuplicateOfRow} 行重複，未自動寫入；請先核對原表。`;
  return row.issues.map(issue => issue.message).join(' ') || '缺少必要內容。';
}

/* ---------------------------------------------------------------------------------------
 * The rows that will not be written, as one compact table.
 *
 * A list of cards made a person open each row to find the one empty cell that kept it out
 * of the plan. The table puts every row on one line and every field under its own heading,
 * so the same missing 覆蓋結果 is the same column on every row: click a cell to supply it,
 * or tick several rows and fill that column once. A tick here only chooses which rows a
 * bulk value lands on; it never decides which rows run — the plan is still confirmed as a
 * whole (docs/AI_ASSISTANT.md 6.1).
 * ------------------------------------------------------------------------------------- */

interface TableField {
  field: CanonicalField;
  label: string;
  kind: 'text' | 'date' | 'time' | 'select';
  options?: { key: string; label: string }[];
  /** Reads a sheet wording into an option key; `false` means it is not one of the options. */
  parse?: (raw: string) => string | undefined | false;
  /** The parser cannot write the row without it. */
  required?: boolean;
}

const optionField = (
  field: CanonicalField,
  label: string,
  labels: Record<string, string>,
  accepted: Record<string, string>,
  required = false,
): TableField => ({
  field, label, kind: 'select', required,
  options: Object.keys(labels).map(key => ({ key, label: labels[key] })),
  parse: raw => { const value = readOption(raw, labels, accepted); return value && !Object.hasOwn(labels, value) ? false : value; },
});

const TABLE_FIELDS: readonly TableField[] = [
  { field: 'buildingName', label: '大廈', kind: 'text', required: true },
  { field: 'floor', label: '樓層', kind: 'text' },
  { field: 'unit', label: '單位', kind: 'text' },
  { field: 'occurredAt', label: '到訪日期', kind: 'date', required: true },
  { field: 'occurredTime', label: '到訪時間', kind: 'time' },
  { field: 'worker', label: '工作員', kind: 'text', required: true },
  optionField('coverage', '覆蓋結果', aiCoverageLabels, acceptedCoverage, true),
  optionField('contactOutcome', '接觸結果', contactLabels, acceptedContact),
  optionField('assessment', '住房判斷', assessmentLabels, acceptedAssessment, true),
  optionField('sourceType', '資料來源', sourceLabels, acceptedSource, true),
  { field: 'note', label: '備註', kind: 'text' },
];

/** Whether the parser still has no value for a field that a row cannot be written without. */
const stillMissing = (row: ParsedRow, field: CanonicalField): boolean =>
  field === 'buildingName' ? !row.buildingName
    : field === 'occurredAt' ? !row.occurredAt
    : field === 'worker' ? !row.workerName
    : row.issues.some(issue => issue.code === ({ coverage: 'MISSING_COVERAGE', assessment: 'MISSING_ASSESSMENT', sourceType: 'MISSING_SOURCE' } as Record<string, string>)[field]);

const dayOf = (row: ParsedRow) => row.occurredAt?.slice(0, 10) ?? '';
const timeOf = (row: ParsedRow) => row.occurredAt && row.occurredAt.length > 10 ? row.occurredAt.slice(11, 16) : '';

interface CellState extends Item { field: TableField; missing: boolean }

function cellState(row: ParsedRow, field: TableField, values: readonly unknown[], columns: Partial<Record<CanonicalField, number | null>>, edits: PlanEdits): CellState {
  const column = columns[field.field];
  const key = fieldEditKey(row.rowNumber, field.field, columns);
  const sheetText = typeof column === 'number' ? text(values[column]) : '';
  // Dates and times are shown in the parser's own reading, so an Excel serial or a spoken
  // date is not displayed as a number; editing one still writes the cell it came from.
  const original = field.field === 'occurredAt' ? dayOf(row) : field.field === 'occurredTime' ? timeOf(row) : sheetText;
  const edited = edits.values[key];
  return {
    key, label: field.label, hint: sheetText, original, readOnly: false,
    type: field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : undefined,
    value: edited ?? original, source: edits.sources[key], field,
    missing: !!field.required && stillMissing(row, field.field),
  };
}

/** One option cell: the key is what the parser reads, the label is what the person sees. */
function SelectCell({ item, onEdit }: { item: CellState; onEdit: PlanRowFieldsProps['onEdit'] }) {
  const field = item.field;
  const parse = field.parse!;
  const shown = parse(item.value);
  const originalKey = parse(item.original);
  const value = shown === false ? (field.field === 'coverage' ? '' : item.value) : shown ?? '';
  const changed = item.source ? `（${item.source === 'ai' ? 'AI 提議' : '人手改'}）` : '';
  return <select className={item.missing ? 'is-missing' : undefined} value={value} title={`${field.label}${changed}${shown === false ? `（原值：${item.value}，請重選）` : ''}`}
    onChange={event => {
      const next = event.target.value;
      if (next === value) return;
      // Picking the sheet's own wording again is not an edit; it removes the override.
      const back = originalKey === false ? item.original : originalKey ?? '';
      onEdit(item.key, next === back ? null : next, 'person');
    }}>
    <option value="">未填</option>
    {shown === false && field.field !== 'coverage' && <option value={item.value}>{item.value}（看不懂，請重選）</option>}
    {field.options!.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
  </select>;
}

export interface SkippedRowsProps {
  readyRows?: ReadonlySet<number>;
  onConfirmRows?: (rows: readonly number[]) => void;
  rows: readonly ParsedRow[];
  /** The worksheet row as it is, for the cells and for the full editor. */
  valuesOf: (rowNumber: number) => readonly unknown[];
  preview: OutboundPreview;
  columns: Partial<Record<CanonicalField, number | null>>;
  edits: PlanEdits;
  onEdit: (key: string, value: string | null, source: EditSource) => void;
  /** Several cells changed at once: one re-parse, not one per row. */
  onEditMany: (changes: readonly { key: string; value: string | null }[], source: EditSource) => void;
}

export function SkippedRowsTable({ rows, valuesOf, preview, columns, edits, onEdit, onEditMany, readyRows, onConfirmRows }: SkippedRowsProps) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [batchField, setBatchField] = useState<CanonicalField>('coverage');
  const [batchValue, setBatchValue] = useState('');
  const picked = rows.filter(row => selected.has(row.rowNumber));
  const all = rows.length > 0 && picked.length === rows.length;
  const field = TABLE_FIELDS.find(item => item.field === batchField) ?? TABLE_FIELDS[0];
  const toggle = (rowNumber: number) => setSelected(current => {
    const next = new Set(current);
    if (next.has(rowNumber)) next.delete(rowNumber); else next.add(rowNumber);
    return next;
  });
  const apply = () => {
    if (!picked.length) return;
    onEditMany(picked.map(row => ({ key: fieldEditKey(row.rowNumber, field.field, columns), value: batchValue })), 'person');
  };
  return <>
    <button type="button" className="cf-button cf-button--ghost" disabled={!rows.some(row => readyRows?.has(row.rowNumber))} onClick={() => onConfirmRows?.(rows.map(row => row.rowNumber))}>更新清單</button>
    <div className="cf-ai__batch">
      <span>批量補欄位：已選 {picked.length} 行</span>
      <select aria-label="批量補哪一欄" value={field.field} onChange={event => { setBatchField(event.target.value as CanonicalField); setBatchValue(''); }}>
        {TABLE_FIELDS.map(item => <option key={item.field} value={item.field}>{item.label}</option>)}
      </select>
      {field.kind === 'select'
        ? <select aria-label="批量補上的值" value={batchValue} onChange={event => setBatchValue(event.target.value)}>
          <option value="">未填（清空）</option>
          {field.options!.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
        : <input aria-label="批量補上的值" type={field.kind} value={batchValue} placeholder="要補上的值" onChange={event => setBatchValue(event.target.value)} />}
      <button type="button" className="cf-button cf-button--ghost" disabled={!picked.length} onClick={apply}>套用到已選行</button>
    </div>
    <div className="cf-ai__tablewrap">
      <table className="cf-ai__table">
        <thead><tr>
          <th className="cf-ai__pick">
            <input type="checkbox" checked={all} aria-label="選取全部不會寫入的行"
              onChange={event => setSelected(event.target.checked ? new Set(rows.map(row => row.rowNumber)) : new Set())} />
          </th>
          <th>行</th>
          {TABLE_FIELDS.map(item => <th key={item.field}>{item.label}{item.required && <b className="cf-ai__required">必須</b>}</th>)}
          <th>缺什麼／原因</th>
          <th>更多</th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const values = valuesOf(row.rowNumber);
          const ready = readyRows?.has(row.rowNumber);
          const reason = ready ? '已補齊，待確認' : skipReason(row);
          return <Fragment key={row.rowNumber}>
            <tr className={selected.has(row.rowNumber) ? 'is-selected' : undefined}>
              <td className="cf-ai__pick">
                <input type="checkbox" checked={selected.has(row.rowNumber)} aria-label={`選取第 ${row.rowNumber} 行（批量補欄位）`} onChange={() => toggle(row.rowNumber)} />
              </td>
              <td className="cf-ai__rownum">第 {row.rowNumber} 行</td>
              {TABLE_FIELDS.map(item => {
                const cell = cellState(row, item, values, columns, edits);
                const classes = [cell.missing ? 'is-missing' : '', cell.source ? 'is-edited' : ''].filter(Boolean).join(' ');
                return <td key={item.field} className={classes || undefined}
                  title={cell.source ? `已由${cell.source === 'ai' ? 'AI' : '你'}改為「${cell.value}」`
                    : cell.hint && cell.hint !== cell.value ? `原表：${cell.hint}` : undefined}>
                  {item.kind === 'select' ? <SelectCell item={cell} onEdit={onEdit} /> : <Cell item={cell} onEdit={onEdit} />}
                </td>;
              })}
              <td className="cf-ai__why" title={reason}>{reason}{ready && <button type="button" className="cf-ai__link" onClick={() => onConfirmRows?.([row.rowNumber])}>確認這一行</button>}</td>
              <td className="cf-ai__more">
                <button type="button" className="cf-ai__link" onClick={() => setOpenRow(current => current === row.rowNumber ? null : row.rowNumber)}>
                  {openRow === row.rowNumber ? '收起' : '詳情'}
                </button>
              </td>
            </tr>
            {openRow === row.rowNumber && <tr className="cf-ai__detailrow">
              <td colSpan={TABLE_FIELDS.length + 4}>
                <PlanRowEditor row={row} values={values} preview={preview} columns={columns} edits={edits} onEdit={onEdit} />
              </td>
            </tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
  </>;
}

/** The collapsed section that holds the table; the inputs mount only once it is opened. */
export function SkippedSection(props: SkippedRowsProps) {
  const [open, setOpen] = useState(false);
  return <details className="cf-ai__skipped" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>不會寫入的 {props.rows.length} 行（可以展開修正）</summary>
    <p className="cf-ai__note">一行一筆記錄，一行一欄。直接點格仔就可以補，或勾選幾行一次補同一欄；補好之後會留在原位，按「確認這一行」或「更新清單」才移到上面的目標清單。</p>
    {open && <SkippedRowsTable {...props} />}
  </details>;
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
