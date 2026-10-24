/**
 * The standalone assistant dialog (`docs/AI_ASSISTANT.md` 6.1).
 *
 * Two screens, not five: put in a note or a workbook, then read the list of things that
 * will happen — 「在裕安樓 · 5F B室 新增 1 筆到訪記錄」 — and press one button. A note is
 * sent as typed; a workbook first says, on the same screen, how many rows and columns will
 * leave the device, and personal-looking columns are withheld. The column mapping lives
 * inside the target list rather than in front of it, and the columns nobody mapped are
 * kept in the note rather than put to a vote — both are details of how the rows were read,
 * not decisions the person came here to make (the reading rules never invent a value).
 *
 * Nothing here writes on the provider's word: the list exists before anything happens, and
 * only the actions in it are handed to the existing batch write. The AI marker is added
 * there, so an unconfirmed reply can never carry one.
 *
 * The assistant creates nothing on its own: a floor or unit the sheet names but the
 * workspace lacks is an action in the same list, created through the existing structure
 * edit, never as a side effect of a reply — and only when it makes a row writable. A
 * building, person or date is never created, an existing record is never rewritten (a
 * correction is a new row with `correctsObservationId`), and nothing is deleted. A row
 * that looks like a repeat is never written automatically (`CLAUDE.md` 3.2).
 */
import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Sparkles, Upload, X } from 'lucide-react';
import { assessmentLabels, contactLabels, coverageLabels } from '../domain/presentation';
import { buildReminders, type ReminderBook, type ReminderTask, type ReminderViewer } from '../domain/reminders';
import { proposeLocation, type LocationProposal } from '../domain/structure';
import type { AiAssist, ContactOutcome, CoverageStatus, HousingAssessment, OutreachSnapshot, SaveObservationInput } from '../domain/types';
import { detectWorkbook } from '../imports/detector';
import { parseGenericRows, type GenericParseInput, type GenericParseResult } from '../imports/genericRows';
import type { CanonicalField } from '../imports/profiles';
import { REQUIRED_FIELDS, shownFields } from './aiMappingFields';
import { placeKey, placesToCreate, planActions, plannedRows } from './aiPlan';
import { aiCredential, type AiCredential } from '../ai/credential';
import { canonicalOptions, type AiDraft, type AiSuggestion } from '../ai/contract';
import { buildPreview, outboundSummary, type OutboundPreview } from '../ai/preview';
import { isReminderQuestion, readReminderQuestion } from '../ai/reminderQuery';
import { SCOPE_REFUSAL, outOfScope } from '../ai/scope';
import { suggestDraft, suggestFileMapping } from '../ai/suggest';
import { ReminderAnswer } from './ReminderAnswer';

export interface AiAssistantDialogProps {
  open: boolean;
  onClose: () => void;
  snapshot?: OutreachSnapshot;
  /** Absent only in demo mode, where the assistant has no institution to read a key from. */
  orgId?: string;
  /** The existing batch write; the dialog never touches the store itself. */
  onWrite: (inputs: readonly SaveObservationInput[]) => void;
  /**
   * The existing structure edit, used only when the plan creates a floor or unit the
   * workspace does not have. Absent when structure editing is switched off, and then
   * nothing is created.
   */
  onApplyProposal?: (proposal: LocationProposal) => { unitId: string; snapshot: OutreachSnapshot } | { error: string };
  /**
   * Who is asking. An employee's task questions are answered with their own tasks only;
   * absent in demo mode, where there is nobody to narrow to.
   */
  viewer?: ReminderViewer;
  /** Opens a task's building and unit. Absent when the dialog cannot move the map. */
  onOpenTask?: (task: ReminderTask) => void;
}

/** A workbook read with its confirmed mapping, and what that produced. */
export interface FilePlan {
  source: 'file';
  credential: AiCredential;
  preview: OutboundPreview;
  suggestion: AiSuggestion;
  columns: Partial<Record<CanonicalField, number | null>>;
  parse: ParseRun;
  result: GenericParseResult;
}

interface TextPlan { source: 'text'; credential: AiCredential; value: AiDraft }

type Plan = FilePlan | TextPlan;

/** A chosen workbook, read locally; nothing has left the device yet. */
interface FileDraft { buffer: ArrayBuffer; preview: OutboundPreview; known: boolean }

type Stage =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'reminder'; book: ReminderBook; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; message: string };

/** What a sheet was read with, kept so a changed mapping can be read in again. */
type ParseRun = Omit<GenericParseInput, 'snapshot' | 'now' | 'newId' | 'extraColumns'>;

interface DraftForm {
  buildingId: string; floor: string; unit: string; date: string; time: string; worker: string;
  coverage: CoverageStatus | ''; contact: ContactOutcome | ''; assessment: HousingAssessment | ''; note: string;
  action: string; dueDate: string; assignee: string;
}

const blankDraft: DraftForm = { buildingId: '', floor: '', unit: '', date: '', time: '', worker: '', coverage: '', contact: '', assessment: '', note: '', action: '', dueDate: '', assignee: '' };
const message = (error: unknown) => error instanceof Error ? error.message : '未能完成，請再試一次。';
const loose = (text: string) => text.replace(/[\s\u3000·・]/g, '').toLowerCase();

/** The unit a draft names, by the label already on record. Never creates one. */
function draftLocation(snapshot: OutreachSnapshot, buildingId: string, floorText: string, unitText: string): { floorId?: string; unitId?: string } | { error: string } {
  if (!floorText && !unitText) return {};
  if (floorText && !unitText) return { error: '只填了樓層，未填單位。整幢的記錄請兩格都留空。' };
  const floors = snapshot.floors.filter(floor => floor.buildingId === buildingId);
  const floor = floorText ? floors.find(item => loose(item.label) === loose(floorText)) : undefined;
  if (floorText && !floor) return { error: `這幢大廈沒有「${floorText}」這一層。` };
  const pool = snapshot.units.filter(unit => unit.buildingId === buildingId && (!floor || unit.floorId === floor.id));
  const matches = pool.filter(unit => loose(unit.label) === loose(unitText) || loose(unit.label.slice((floor?.label ?? '').length)) === loose(unitText));
  if (matches.length === 1) return { floorId: matches[0].floorId, unitId: matches[0].id };
  return { error: matches.length ? `「${unitText}」對應到多個單位，請把寫法寫清楚。` : `找不到「${unitText}」。請照樓層立面的寫法填，或把位置留空。` };
}

/** The mapping in the shape the parser takes, dropping the fields left unmapped. */
const toMapping = (columns: Partial<Record<CanonicalField, number | null>>) =>
  (Object.entries(columns) as [CanonicalField, number | null][])
    .filter(([, index]) => index !== null)
    .map(([key, index]) => ({ key, columnIndex: index as number }));

/** Columns with no canonical field: every one is kept in each row's note (`CLAUDE.md` 3.1). */
const unmappedColumns = (preview: OutboundPreview, columns: Partial<Record<CanonicalField, number | null>>) => {
  const mapped = new Set(Object.values(columns).filter((index): index is number => typeof index === 'number'));
  return preview.headers
    .map((header, columnIndex) => ({ header, columnIndex }))
    .filter(column => !mapped.has(column.columnIndex));
};

/** The same list in the shape the parser takes. */
const extraColumnsFor = (preview: OutboundPreview, columns: Partial<Record<CanonicalField, number | null>>) =>
  unmappedColumns(preview, columns);

export function AiAssistantDialog({ open, onClose, snapshot, orgId, onWrite, onApplyProposal, viewer, onOpenTask }: AiAssistantDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fileDraft, setFileDraft] = useState<FileDraft | null>(null);
  const [form, setForm] = useState<DraftForm>(blankDraft);

  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => {
    if (!open) {
      setStage({ kind: 'idle' }); setText(''); setDragging(false);
      setFileDraft(null); setForm(blankDraft);
    }
  }, [open]);

  if (!open) return null;

  const fail = (error: unknown) => setStage({ kind: 'error', message: message(error) });

  /** Reading is local: the person gets the row/column summary before anything is sent. */
  const readFile = async (file: File) => {
    if (!snapshot) { setStage({ kind: 'error', message: '尚未載入工作區資料，無法核對大廈與單位。' }); return; }
    setStage({ kind: 'busy', label: '正在讀取檔案…' });
    try {
      const buffer = await file.arrayBuffer();
      const recognition = detectWorkbook(buffer);
      const built = buildPreview(buffer, recognition, file.name);
      if (!built.ok) { setStage({ kind: 'error', message: built.reason }); return; }
      setFileDraft({ buffer, preview: built.preview, known: recognition.status === 'KNOWN' });
      setStage({ kind: 'idle' });
    } catch (error) { fail(error); }
  };

  /** Read the whole file and show the plan; the person sees the actions, not the columns. */
  const showFilePlan = (run: ParseRun, credential: AiCredential, preview: OutboundPreview, suggestion: AiSuggestion, columns: FilePlan['columns']) => {
    const result = parseGenericRows({ ...run, snapshot: snapshot!, extraColumns: extraColumnsFor(preview, columns) });
    setStage({ kind: 'plan', plan: { source: 'file', credential, preview, suggestion, columns, parse: run, result } });
  };

  const sendFile = async () => {
    const draft = fileDraft;
    if (!draft) return;
    // Personal-looking columns never leave the device by default; their content is still
    // kept in the note. This is stricter than the old opt-out and needs no extra screen.
    const withheld = draft.preview.sensitiveColumns;
    setStage({ kind: 'busy', label: '正在請 AI 核對欄位…' });
    try {
      if (!orgId) throw new Error('未設定機構，無法使用 AI 助手。');
      const credential = await aiCredential(orgId);
      const { suggestion } = await suggestFileMapping({ preview: draft.preview, credential, withheld }, (index, count) => setStage({ kind: 'busy', label: `正在請 AI 核對欄位（第 ${index}/${count} 段）…` }));
      if (suggestion.status === 'REFUSE') { setStage({ kind: 'error', message: SCOPE_REFUSAL }); return; }
      if (suggestion.status === 'NO_MATCH') { setStage({ kind: 'error', message: 'AI 看不出哪一欄對應哪一個既有欄位，沒有提出建議。可以只匯入工作表中間那一段，或改用人手對應。' }); return; }
      const headerRow = suggestion.headerRow ?? draft.preview.headerRow;
      if (headerRow === null || headerRow === undefined) { setStage({ kind: 'error', message: 'AI 找不到表頭，無法確定哪一行才是資料。請在工作表加上表頭後再試。' }); return; }
      const columns = Object.fromEntries(suggestion.fields.map(field => [field.key, field.columnIndex]));
      const run: ParseRun = { buffer: draft.buffer, sheetName: draft.preview.sheetName, headerRow: headerRow + 1, mapping: toMapping(columns), fileName: draft.preview.fileName };
      showFilePlan(run, credential, draft.preview, suggestion, columns);
    } catch (error) { fail(error); }
  };

  /** A different mapping: read the file again, plan again. */
  const reread = (plan: FilePlan, columns: FilePlan['columns']) => {
    if (!snapshot) return;
    const run: ParseRun = { ...plan.parse, mapping: toMapping(columns) };
    showFilePlan(run, plan.credential, plan.preview, plan.suggestion, columns);
  };

  /**
   * A question about open follow-ups is answered here, from the workspace, and never
   * leaves the device: follow-up text is encrypted on this device, so sending it to a
   * provider just to count tasks would break the promise the encryption makes. The
   * office can overrule the reading with 「改為整理成記錄」 and send it as a draft.
   */
  const answerReminder = (raw: string) => {
    if (!snapshot) return;
    const question = readReminderQuestion(raw);
    const book = buildReminders(snapshot, { viewer, from: question.from, to: question.to });
    setStage({ kind: 'reminder', book, text: raw });
  };

  const sendText = async (raw: string, asReminder = true) => {
    if (!snapshot) { setStage({ kind: 'error', message: '尚未載入工作區資料，無法核對大廈與單位。' }); return; }
    if (asReminder && isReminderQuestion(raw)) { answerReminder(raw); return; }
    if (outOfScope(raw)) { setStage({ kind: 'error', message: SCOPE_REFUSAL }); return; }
    setStage({ kind: 'busy', label: '正在整理草稿…' });
    try {
      if (!orgId) throw new Error('未設定機構，無法使用 AI 助手。');
      const credential = await aiCredential(orgId);
      const value = await suggestDraft({ text: raw, snapshot, credential });
      if (value.status === 'REFUSE') { setStage({ kind: 'error', message: SCOPE_REFUSAL }); return; }
      setForm({
        ...blankDraft,
        buildingId: value.buildingId ?? '',
        floor: value.floorLabel ?? '',
        unit: value.unitLabel ?? '',
        date: value.occurredDate ?? '',
        time: value.occurredTime ?? '',
        worker: value.workerName ?? '',
        coverage: value.coverage ?? '',
        contact: value.contactOutcome ?? '',
        assessment: value.assessment ?? '',
        note: value.note ?? '',
        action: value.followUp?.action ?? '',
        dueDate: value.followUp?.dueDate ?? '',
        assignee: value.followUp?.assignee ?? '',
      });
      setStage({ kind: 'plan', plan: { source: 'text', credential, value } });
    } catch (error) { fail(error); }
  };

  const filePlan = stage.kind === 'plan' && stage.plan.source === 'file' ? stage.plan : undefined;
  const textPlan = stage.kind === 'plan' && stage.plan.source === 'text' ? stage.plan : undefined;

  const changeColumn = (key: CanonicalField, index: number | null) => {
    const plan = stage.kind === 'plan' ? stage.plan : undefined;
    if (plan?.source !== 'file') return;
    reread(plan, { ...plan.columns, [key]: index });
  };
  const runPlan = () => {
    const plan = stage.kind === 'plan' ? stage.plan : undefined;
    if (!plan) return;
    if (plan.source === 'file') runFilePlan(plan); else runDraftPlan(plan);
  };

  /** Run the plan: create the floors/units it needs, read the file once more, write the rows. */
  const runFilePlan = (plan: FilePlan) => {
    if (!snapshot) return;
    let latest = snapshot;
    const places = placesToCreate(plan.result);
    if (places.length && !onApplyProposal) {
      setStage({ kind: 'error', message: '結構編輯目前關閉，不能在這裡新增樓層或單位。請先在「編輯結構」新增，再回來執行。' });
      return;
    }
    for (const place of places) {
      const proposal = proposeLocation(latest, place.buildingId, place.floorLabel, place.unitLabel);
      if (!proposal) { setStage({ kind: 'error', message: `系統讀不出「${place.floorLabel} ${place.unitLabel}」該怎樣建（只認數字樓層＋字母單位）。請在「編輯結構」手動新增，再回來執行。` }); return; }
      const applied = onApplyProposal!(proposal);
      if ('error' in applied) { setStage({ kind: 'error', message: applied.error }); return; }
      latest = applied.snapshot;
    }
    // Read again against the workspace as it now stands; the rows that waited for a place
    // are writable, and anything still short of a date, worker or result stays out.
    const result = parseGenericRows({ ...plan.parse, snapshot: latest, extraColumns: extraColumnsFor(plan.preview, plan.columns) });
    const chosen = plannedRows(result, new Set());
    if (!chosen.length) { setStage({ kind: 'error', message: '沒有任何一行可以寫入。未寫入的行都列在目標清單下面，並寫了原因。' }); return; }
    try {
      onWrite(chosen.map(row => ({ ...row.input!, aiAssist: assistOf(plan.credential) })));
      const made = places.length ? `，也新增了 ${places.length} 個樓層／單位` : '';
      setStage({ kind: 'done', message: `已寫入 ${chosen.length} 筆記錄${made}。每筆都標了「由 AI 協助」。` });
    } catch (error) { fail(error); }
  };

  /** Run the draft: create its floor/unit if the workspace lacks it, then write the record. */
  const runDraftPlan = (plan: TextPlan) => {
    if (!snapshot) return;
    if (!form.buildingId || !form.date || !form.coverage || !form.worker.trim()) {
      setStage({ kind: 'error', message: '大廈、日期、覆蓋結果與工作員都必須由人填寫。' });
      return;
    }
    let latest = snapshot;
    let location = draftLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim());
    if ('error' in location) {
      const proposal = form.floor.trim() && form.unit.trim() ? proposeLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim()) : undefined;
      if (!proposal || !onApplyProposal) { setStage({ kind: 'error', message: location.error }); return; }
      const applied = onApplyProposal(proposal);
      if ('error' in applied) { setStage({ kind: 'error', message: applied.error }); return; }
      latest = applied.snapshot;
      location = draftLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim());
      if ('error' in location) { setStage({ kind: 'error', message: location.error }); return; }
    }
    const input: SaveObservationInput = {
      id: `ai:${crypto.randomUUID()}`, visitId: `ai-visit:${crypto.randomUUID()}`, buildingId: form.buildingId,
      floorId: location.floorId, unitId: location.unitId,
      occurredAt: form.time ? `${form.date}T${form.time}:00+08:00` : form.date,
      recordedAt: new Date().toISOString(), workerName: form.worker.trim(), coverage: form.coverage,
      contactOutcome: form.contact || undefined, assessment: form.assessment || undefined,
      note: form.note.trim() || undefined, evidence: [],
      followUp: form.action.trim() ? { action: form.action.trim(), status: 'OPEN', assignee: form.assignee.trim() || undefined, dueDate: form.dueDate || undefined } : undefined,
      aiAssist: assistOf(plan.credential),
    };
    try {
      onWrite([input]);
      setStage({ kind: 'done', message: '已寫入 1 筆記錄，標了「由 AI 協助」。' });
    } catch (error) { fail(error); }
  };

  return <dialog aria-labelledby="ai-title" ref={dialogRef} className="cf-dialog cf-dialog--ai" onCancel={event => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
    <div className="cf-ai">
      <header className="cf-dialog__header"><div><span className="cf-eyebrow">AI 助手</span><h2 id="ai-title">說一句，或放一份表</h2></div><button className="cf-icon-button" onClick={onClose} aria-label="關閉"><X /></button></header>

      {stage.kind === 'idle' && <>
        <p className="cf-callout">AI 只提出草稿或欄位建議，<strong>不會寫入任何資料</strong>。下一步會列出「將執行的目標」；你看過、按下「確認並執行」，記錄才會以你的身分存入，並標明「由 AI 協助」。貼上的文字會送交 AI，但問未完成跟進除外（那一類在本機回答）；檔案會先顯示行數與欄數，姓名、電話等欄不會送出。</p>
        {!snapshot && <p className="cf-error" role="alert"><AlertTriangle />尚未載入工作區資料，先載入後再使用。</p>}
        <label className="cf-ai__label" htmlFor="ai-note">貼一段紙本原話或口述</label>
        <textarea id="ai-note" className="cf-ai__text" rows={5} value={text} placeholder="例如：10月9日晚上 7 點，3樓 A 室拍門無人應門，門外有水電單；下星期再上門。" onChange={event => setText(event.target.value)} />
        <div className="cf-ai__send"><button className="cf-button cf-button--secondary" disabled={!snapshot || !text.trim()} onClick={() => void sendText(text)}><Sparkles size={16} />整理成目標</button></div>
        <p className="cf-ai__note">也可以直接問「今天還有什麼未完成的跟進？」。這一類問題在工作區本機計算，內容不會送交 AI；員工帳號只會看到指派給自己的任務。</p>
        <div className={`cf-dropzone ${dragging ? 'is-dragging' : ''}`} role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file); }}>
          <Upload size={26} /><strong>拖放 Excel／CSV 檔案到這裡</strong><span>或按此選擇檔案。上限 5 MB、5000 行、64 欄；超出會請你先拆檔，不會偷偷截斷。</span>
        </div>
        <input ref={inputRef} className="cf-visually-hidden" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void readFile(file); }} />
        {fileDraft && <section className="cf-ai__file">
          <h3><FileSpreadsheet size={16} />{fileDraft.preview.fileName}</h3>
          <p>{outboundSummary(fileDraft.preview, fileDraft.preview.sensitiveColumns)}</p>
          {fileDraft.known && <p className="cf-ai__note">系統的規則識別已認得這個格式。多數情況可以直接用「紙本與 Excel」匯入；仍然想請 AI 核對欄位的話可以繼續。</p>}
          <div className="cf-ai__send">
            <button className="cf-button cf-button--ghost" onClick={() => setFileDraft(null)}>換一個檔案</button>
            <button className="cf-button cf-button--primary" disabled={!snapshot} onClick={() => void sendFile()}><Sparkles size={16} />整理這份表</button>
          </div>
        </section>}
        <p className="cf-ai__note">對談內容只留在這部裝置，不上傳、不進匯出檔。AI 不會自己新增或改寫任何資料：表格寫到而工作區沒有的樓層／單位，會列在「將執行的目標」裡，由你確認後才建立；大廈本身仍要在地圖上新增。要更正舊記錄，只會產生一筆帶「更正原記錄」的追加記錄。</p>
      </>}

      {stage.kind === 'busy' && <p className="cf-ai__busy" role="status"><Sparkles size={18} />{stage.label}</p>}

      {filePlan && <FilePlanPanel
        plan={filePlan} canCreate={!!onApplyProposal}
        onChangeColumn={changeColumn} onRun={runPlan} onBack={() => setStage({ kind: 'idle' })} />}

      {textPlan && <DraftPlanPanel
        snapshot={snapshot!} value={textPlan.value} form={form}
        onChange={(key, value) => setForm({ ...form, [key]: value })}
        canCreate={!!onApplyProposal} onRun={runPlan} onBack={() => setStage({ kind: 'idle' })} />}

      {stage.kind === 'reminder' && <>
        <ReminderAnswer book={stage.book} onOpenTask={onOpenTask} />
        <footer className="cf-dialog__footer">
          <span>這份清單在工作區本機計算，沒有送交 AI，也沒有寫入任何資料。</span>
          <div>
            <button className="cf-button cf-button--ghost" onClick={() => void sendText(stage.text, false)}>這不是提醒，改為整理成記錄</button>
            <button className="cf-button cf-button--primary" onClick={() => setStage({ kind: 'idle' })}>返回</button>
          </div>
        </footer>
      </>}

      {stage.kind === 'error' && <>
        <p className="cf-error" role="alert"><AlertTriangle />{stage.message}</p>
        <footer className="cf-dialog__footer"><span>沒有寫入任何資料。</span><div><button className="cf-button cf-button--primary" onClick={() => setStage({ kind: 'idle' })}>返回</button></div></footer>
      </>}

      {stage.kind === 'done' && <>
        <p className="cf-success" role="status"><CheckCircle2 />{stage.message}</p>
        <footer className="cf-dialog__footer"><span>可以在記錄歷史看到「由 AI 協助」，管理員的操作記錄也有這筆。</span><div><button className="cf-button cf-button--primary" onClick={() => { setStage({ kind: 'idle' }); onClose(); }}>完成</button></div></footer>
      </>}
    </div>
  </dialog>;
}

const assistOf = (credential: AiCredential): AiAssist => ({ at: new Date().toISOString(), provider: credential.provider, model: credential.model });

/** The list of things that will happen, one line each, and the details folded behind it. */
export function FilePlanPanel({ plan, canCreate, onChangeColumn, onRun, onBack }: {
  plan: FilePlan; canCreate: boolean;
  onChangeColumn: (key: CanonicalField, index: number | null) => void; onRun: () => void; onBack: () => void;
}) {
  const { result, preview, suggestion } = plan;
  // Without the structure edit nothing can be created, so the rows that wait for a new
  // floor/unit are not counted as writable — the footer must not promise them. A place is
  // only created when it turns a row into something writable.
  const places = canCreate ? placesToCreate(result) : [];
  const chosen = new Set(places.map(placeKey));
  const writable = plannedRows(result, chosen);
  const actions = planActions(places, writable);
  const creating = places.length;
  const planned = new Set(writable.map(row => row.rowNumber));
  const skipped = result.rows.filter(row => !planned.has(row.rowNumber));
  const extras = unmappedColumns(preview, plan.columns);
  return <>
    <section className="cf-ai__preview">
      <h3>將執行的目標</h3>
      <p className="cf-ai__note">{preview.fileName}：「{preview.sheetName}」共 {preview.totalRows} 行 → 寫入 {writable.length} 筆記錄{creating ? `，並新增 ${creating} 個樓層／單位` : ''}{skipped.length ? `；${skipped.length} 行不會寫入（原因在下面）` : ''}。</p>
      {result.notes.map((note, index) => <p className="cf-error" key={index}><AlertTriangle />{note}</p>)}
      {actions.length ? <ul className="cf-ai__actions">{actions.map(action => <li key={action.key} className={`is-${action.kind}`}>
        <span className="cf-ai__rowmark">＋</span>
        <div><strong>{action.sentence}</strong>{action.detail && <small>{action.detail}</small>}</div>
      </li>)}</ul> : <p className="cf-ai__note">這份表沒有任何可以直接執行的事。下面列出的行都缺了必要內容，沒有人可以替你補。</p>}
      {extras.length > 0 && <p className="cf-ai__note">原表另有 {extras.length} 欄系統沒有對應（{extras.map(column => column.header || `第 ${column.columnIndex + 1} 欄`).join('、')}）：不用的話不用管，寫入時會把每一行的內容原樣記在備註，不會丟掉。</p>}
      {result.pending.length > 0 && !canCreate && <p className="cf-error"><AlertTriangle />結構編輯目前關閉，不能在這裡新增樓層或單位。請先在「編輯結構」新增，再回來執行。</p>}
      {skipped.length > 0 && <details className="cf-ai__skipped">
        <summary>不會寫入的 {skipped.length} 行</summary>
        <ul>{skipped.map(row => <li key={row.rowNumber}>
          <strong>第 {row.rowNumber} 行 · {row.buildingName ?? '未知大廈'}{row.location ? ` · ${row.location}` : ''}</strong>
          <small>{skipReason(row)}</small>
        </li>)}</ul>
      </details>}
    </section>
    <details className="cf-ai__mapping-details">
      <summary>AI 讀到的欄位對應（{suggestion.fields.length} 欄）</summary>
      <MappingTable preview={preview} suggestion={suggestion} columns={plan.columns} onChange={onChangeColumn} />
    </details>
    <footer className="cf-dialog__footer">
      <span>按下確認才執行；以你的帳號署名，並標明「由 AI 協助」。</span>
      <div><button className="cf-button cf-button--ghost" onClick={onBack}>取消</button><button className="cf-button cf-button--primary" disabled={!writable.length} onClick={onRun}>確認並執行</button></div>
    </footer>
  </>;
}

/** Why a row is not in the plan, in the person's words rather than an issue code. */
function skipReason(row: FilePlan['result']['rows'][number]): string {
  if (row.suspectedDuplicateOf) return '疑似與現有記錄重複，未自動寫入；請先在記錄歷史核對。';
  if (row.suspectedDuplicateOfRow) return `疑似與檔內第 ${row.suspectedDuplicateOfRow} 行重複，未自動寫入；請先核對原表。`;
  return row.issues.map(issue => issue.message).join(' ') || '缺少必要內容。';
}

function MappingTable({ preview, suggestion, columns, onChange }: {
  preview: OutboundPreview; suggestion: AiSuggestion; columns: Partial<Record<CanonicalField, number | null>>;
  onChange: (key: CanonicalField, index: number | null) => void;
}) {
  const labels = new Map(canonicalOptions().map(option => [option.key, option.label]));
  const suggested = new Set(suggestion.fields.map(field => field.key));
  const { keys, shown: shownKeys, folded: foldedKeys } = shownFields(suggested, columns);
  const options = keys.map(key => ({ key, label: labels.get(key) ?? key }));
  const shown = options.filter(option => shownKeys.includes(option.key));
  const folded = options.filter(option => foldedKeys.includes(option.key));
  const used = new Set(Object.values(columns).filter((index): index is number => typeof index === 'number'));
  const extras = unmappedColumns(preview, columns);
  const row = (option: { key: CanonicalField; label: string }) => {
    const field = suggestion.fields.find(item => item.key === option.key);
    const value = columns[option.key] ?? null;
    return <tr key={option.key} className={value !== null ? 'is-mapped' : undefined}>
      <th>{option.label}{REQUIRED_FIELDS.has(option.key) && <b className="cf-ai__required">必須</b>}</th>
      <td><select aria-label={`${option.label} 對應哪一欄`} value={value === null ? '' : String(value)} onChange={event => onChange(option.key, event.target.value === '' ? null : Number(event.target.value))}>
        <option value="">原表沒有此欄</option>
        {preview.headers.map((header, index) => <option key={index} value={index} disabled={used.has(index) && index !== value}>第 {index + 1} 欄 · {header || '（無表頭）'}</option>)}
        {preview.sensitiveColumns.map(index => <option key={`s${index}`} value={index} disabled>第 {index + 1} 欄（未送交 AI）</option>)}
      </select></td>
      <td>{field?.reason ?? ''}</td>
    </tr>;
  };
  return <section className="cf-ai__preview">
    <p className="cf-ai__note">AI 認出 {suggestion.fields.length} 欄；必須的欄位若沒對上，該行就不會寫入。改動對應會重新整理上面的目標。</p>
    <table className="cf-ai__mapping"><thead><tr><th>既有欄位</th><th>工作表的欄</th><th>AI 的理由</th></tr></thead>
      <tbody>{shown.map(row)}</tbody>
      {folded.length > 0 && <tbody className="cf-ai__folded"><tr><td colSpan={3}><details><summary>其他欄位（{folded.length}）</summary><table className="cf-ai__mapping"><tbody>{folded.map(row)}</tbody></table></details></td></tr></tbody>}
    </table>
    {extras.length > 0 && <section className="cf-ai__unmapped">
      <h3>原表有、系統沒有對應的欄</h3>
      <p className="cf-ai__note">不用逐欄確認：寫入時會把每一行這些欄的內容原樣記在備註（例如「原表「電話」：2111 1111」），不會丟掉。</p>
      <ul className="cf-ai__extras">{extras.map(column => <li key={column.columnIndex}>
        <span>第 {column.columnIndex + 1} 欄 · {column.header || '（無表頭）'}</span>
        {preview.sensitiveColumns.includes(column.columnIndex) && <b>個人資料</b>}
        <b>記在備註</b>
      </li>)}</ul>
    </section>}
    {suggestion.warnings.length > 0 && <ul className="cf-ai__warnings">{suggestion.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
  </section>;
}

function DraftPlanPanel({ snapshot, value, form, canCreate, onChange, onRun, onBack }: {
  snapshot: OutreachSnapshot; value: AiDraft; form: DraftForm; canCreate: boolean;
  onChange: (key: keyof DraftForm, value: string) => void; onRun: () => void; onBack: () => void;
}) {
  const complete = !!form.buildingId && !!form.date && !!form.coverage && !!form.worker.trim();
  const building = snapshot.buildings.find(item => item.id === form.buildingId);
  const target = form.buildingId ? draftLocation(snapshot, form.buildingId, form.floor.trim(), form.unit.trim()) : undefined;
  const proposal = target && 'error' in target && form.floor.trim() && form.unit.trim()
    ? proposeLocation(snapshot, form.buildingId, form.floor.trim(), form.unit.trim())
    : undefined;
  const where = building ? `${building.name}${form.floor.trim() || form.unit.trim() ? ` · ${[form.floor.trim(), form.unit.trim()].filter(Boolean).join(' ')}` : '（整幢）'}` : '尚未選擇大廈';
  return <>
    <section className="cf-ai__preview">
      <h3>將執行的目標</h3>
      <ul className="cf-ai__actions">
        {proposal && <li className="is-place">
          <span className="cf-ai__rowmark">＋</span>
          <div><strong>在「{building?.name}」新增「{form.floor.trim()} {form.unit.trim()}」</strong><small>{proposal.steps.join('；')}（工作區原本沒有）</small></div>
        </li>}
        <li className="is-record"><span className="cf-ai__rowmark">＋</span><div>
          <strong>在「{where}」新增 1 筆到訪記錄</strong>
          <small>{[form.date, form.worker.trim(), form.coverage ? coverageLabels[form.coverage] : '', form.coverage ? '' : '缺覆蓋結果'].filter(Boolean).join(' · ') || '尚未填寫'}</small>
        </div></li>
      </ul>
      {proposal && !canCreate && <p className="cf-error"><AlertTriangle />結構編輯目前關閉，不能在這裡新增樓層或單位。請先在「編輯結構」新增，再回來執行。</p>}
      {target && 'error' in target && !proposal && <p className="cf-error"><AlertTriangle />{target.error}</p>}
      {value.warnings.map((warning, index) => <p key={index} className="cf-ai__note">{warning}</p>)}
      {value.missing.length > 0 && <p className="cf-ai__note">文字裡沒有提到：{value.missing.join('、')}。系統不會替你補。</p>}
    </section>
    <details className="cf-ai__mapping-details" open>
      <summary>記錄內容（文字裡沒有的留空，可逐項核對）</summary>
      <div className="cf-ai__form">
        <label>大廈<select value={form.buildingId} onChange={event => onChange('buildingId', event.target.value)}><option value="">請選擇（AI 不會代為新增）</option>{snapshot.buildings.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>樓層<input value={form.floor} placeholder={building ? '例：3樓' : ''} onChange={event => onChange('floor', event.target.value)} /></label>
        <label>單位<input value={form.unit} placeholder="例：A室" onChange={event => onChange('unit', event.target.value)} /></label>
        <label>到訪日期<input type="date" value={form.date} onChange={event => onChange('date', event.target.value)} /></label>
        <label>到訪時間<input type="time" value={form.time} onChange={event => onChange('time', event.target.value)} /></label>
        <label>工作員<input value={form.worker} onChange={event => onChange('worker', event.target.value)} /></label>
        <label>覆蓋結果<select value={form.coverage} onChange={event => onChange('coverage', event.target.value)}><option value="">請選擇</option>{Object.entries(coverageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>接觸結果<select value={form.contact} onChange={event => onChange('contact', event.target.value)}><option value="">未填</option>{Object.entries(contactLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>住房判斷<select value={form.assessment} onChange={event => onChange('assessment', event.target.value)}><option value="">未填</option>{Object.entries(assessmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="is-wide">備註<textarea rows={3} value={form.note} onChange={event => onChange('note', event.target.value)} /></label>
        <label className="is-wide">跟進行動<input value={form.action} placeholder="留空表示不需要跟進" onChange={event => onChange('action', event.target.value)} /></label>
        <label>跟進日期<input type="date" value={form.dueDate} onChange={event => onChange('dueDate', event.target.value)} /></label>
        <label>負責人<input value={form.assignee} onChange={event => onChange('assignee', event.target.value)} /></label>
      </div>
    </details>
    <footer className="cf-dialog__footer">
      <span>{complete ? '寫入後會標明由 AI 協助，署名是你的帳號。' : '大廈、日期、覆蓋結果與工作員都必須由人填寫。'}</span>
      <div><button className="cf-button cf-button--ghost" onClick={onBack}>取消</button><button className="cf-button cf-button--primary" disabled={!complete} onClick={onRun}>確認並執行</button></div>
    </footer>
  </>;
}
