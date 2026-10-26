/**
 * The standalone assistant dialog (`docs/AI_ASSISTANT.md` 6.1).
 *
 * Two screens, not five: put in a note, a workbook, or both, then read the list of things
 * that will happen — 「在裕安樓 · 5F B室 新增 1 筆到訪記錄」 — and press one button. A note is
 * sent as typed; a workbook first says, on the same screen, how many rows and columns will
 * leave the device, and personal-looking columns are withheld. Each input keeps its own
 * provenance — the note is one draft, the sheet is one row per record — but they are read
 * together and confirmed once, because a person who drops a sheet and types 「另外今日去咗
 * 5 樓 B 室」 means one piece of work. The column mapping lives
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
import { AlertTriangle, CheckCircle2, FileSpreadsheet, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import { assessmentLabels, contactLabels, coverageLabels, aiCoverageLabels, sourceLabels } from '../domain/presentation';
import type { ReminderAdvice, ReminderBook, ReminderTask, ReminderViewer } from '../domain/reminders';
import type { NamedBuilding } from '../domain/buildingMentions';
import { yearlessDate } from '../domain/sheetDate';
import { mentionedPlace } from '../domain/locationMentions';
import { proposeLocation, type LocationProposal } from '../domain/structure';
import type { ContactOutcome, CoverageStatus, HousingAssessment, OutreachSnapshot, SaveObservationInput, SourceType } from '../domain/types';
import { detectWorkbook } from '../imports/detector';
import { parseGenericRows, readSheetMatrix, type GenericParseInput, type GenericParseResult, type SheetMatrix } from '../imports/genericRows';
import type { CanonicalField } from '../imports/profiles';
import { REQUIRED_FIELDS, shownFields } from './aiMappingFields';
import { placeKey, placesToCreate, planActions, plannedRows } from './aiPlan';
import { NO_EDITS, cellKey, editCounts, fieldKey, planInput, toMapping, withEdit, withoutEdit, type EditSource, type PlanEdits } from './planEdits';
import { PlanRowEditor, RowDetails, SkippedSection } from './AiPlanRows';
import type { AiAssistMarker } from '../ai/client';
import { canonicalOptions, type AiDraft, type AiSuggestion } from '../ai/contract';
import { buildPreview, outboundSummary, type OutboundPreview } from '../ai/preview';
import { looksLikeTaskFollowUp, reminderAnswer, shouldAnswerReminder } from '../ai/reminderQuery';
import { SCOPE_REFUSAL } from '../ai/scope';
import { suggestDraft, suggestFileMapping, suggestPatches } from '../ai/suggest';
import { ReminderAdviceView, ReminderAnswer } from './ReminderAnswer';

export interface AiAssistantDialogProps {
  open: boolean;
  onClose: () => void;
  snapshot?: OutreachSnapshot;
  /**
   * The institution whose workspace the confirmed records are written into. Absent only in
   * demo mode; the server takes the institution it calls for from the session, never from here.
   */
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
  /**
   * The Hong Kong day the dialog is open on. Task answers use it instead of reading the
   * clock here, so the reminder and the sidebar badge always name the same day, including
   * after the page has sat open past midnight.
   */
  today?: string;
  /**
   * Whether the institution has the AI assistant switched on. When it is off the dialog is
   * still the place to ask about open follow-ups: that answer is computed on this device
   * and must not disappear with a server-side switch. Everything that would leave the
   * device stays unavailable.
   */
  aiEnabled?: boolean;
  /** Opens a task's building and unit. Absent when the dialog cannot move the map. */
  onOpenTask?: (task: ReminderTask) => void;
}

/** A workbook read with its confirmed mapping, and what that produced. */
export interface FilePlan {
  /** The request that decided this sheet's mapping; every record it produces carries it. */
  aiAssist: AiAssistMarker;
  preview: OutboundPreview;
  suggestion: AiSuggestion;
  columns: Partial<Record<CanonicalField, number | null>>;
  parse: ParseRun;
  /** The sheet, read once, so every edit re-parses without decoding the workbook again. */
  matrix: SheetMatrix;
  result: GenericParseResult;
}

/** Everything a `FilePlan` is built from; the parse itself is always recomputed. */
type FilePlanBase = Omit<FilePlan, 'result'>;

/** One turn of the plan's chat, kept so the person can see what the assistant did. */
export interface PlanChatTurn { question: string; answer: string; changed: number; failed?: boolean }

export interface PlanChat {
  turns: readonly PlanChatTurn[];
  value: string;
  asking: boolean;
  onChange: (value: string) => void;
  onAsk: () => void;
}

interface TextPlan { aiAssist: AiAssistMarker; value: AiDraft }

/**
 * One screen, one confirmation. A file and a note can be put in together; each keeps its
 * own provenance and its own rules, but they are read once and confirmed once, because a
 * person who drops a sheet and types 「另外今日去咗 5 樓 B 室」 means one piece of work.
 */
export type Plan =
  | { source: 'file'; file: FilePlan }
  | { source: 'text'; text: TextPlan }
  | { source: 'both'; file: FilePlan; text: TextPlan };

/** A chosen workbook, read locally; nothing has left the device yet. */
interface FileDraft { buffer: ArrayBuffer; preview: OutboundPreview; known: boolean; matrix: SheetMatrix }

type Stage =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'plan'; plan: Plan; notice?: string }
  | {
    kind: 'reminder';
    book: ReminderBook;
    text: string;
    advice?: ReminderAdvice;
    /** Names the question mentioned but could not be narrowed to one. */
    ambiguous?: string[];
    /** The narrowing to keep for the next question, when it names nobody new. */
    narrow?: { buildingId?: string; assignee?: string };
  }
  | { kind: 'error'; message: string }
  | { kind: 'done'; message: string };

/** What a sheet was read with, kept so a changed mapping can be read in again. */
type ParseRun = Omit<GenericParseInput, 'snapshot' | 'now' | 'newId' | 'extraColumns'>;

export interface DraftForm {
  buildingId: string; floor: string; unit: string; date: string; time: string; worker: string;
  coverage: CoverageStatus | ''; contact: ContactOutcome | ''; assessment: HousingAssessment | ''; sourceType: SourceType | ''; note: string;
  action: string; dueDate: string; assignee: string;
}

const blankDraft: DraftForm = { buildingId: '', floor: '', unit: '', date: '', time: '', worker: '', coverage: '', contact: '', assessment: '', sourceType: '', note: '', action: '', dueDate: '', assignee: '' };

/**
 * Said when the note beside a sheet is not a second record. It is not a failure: 「在裕安樓」
 * is how the uploaded file gets a building, and answering it with 「為什麼沒有記錄」 would
 * treat the person's own words as a broken upload. The text stays in the box for rewriting.
 */
const TEXT_CONTEXT_ONLY = '這段文字沒有另外整理成一筆記錄，只用作這次讀表的補充說明（例如「在裕安樓」）。文字仍留在輸入框，可以改寫後再上傳。';

/**
 * Whether a draft says anything about a visit. A reply that only repeats where the sheet
 * belongs («裕安樓») is context for the file, not a second record to confirm — showing it
 * would put an empty form beside the sheet and block the single confirmation on fields
 * nobody meant to fill.
 */
const draftIsRecord = (value: AiDraft) =>
  !!value.occurredDate || !!value.occurredTime || !!value.coverage || !!value.contactOutcome || !!value.assessment || !!value.followUp;
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

export function AiAssistantDialog({ open, onClose, snapshot, orgId, onWrite, onApplyProposal, viewer, today, aiEnabled = true, onOpenTask }: AiAssistantDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fileDraft, setFileDraft] = useState<FileDraft | null>(null);
  const [form, setForm] = useState<DraftForm>(blankDraft);
  /** Cells changed after the plan was shown — by hand or by the chat, one layer. */
  const [edits, setEdits] = useState<PlanEdits>(NO_EDITS);
  const [chat, setChat] = useState<PlanChatTurn[]>([]);
  const [ask, setAsk] = useState('');
  const [asking, setAsking] = useState(false);
  /** A further question typed on the task screen; each one is read on its own. */
  const [followUp, setFollowUp] = useState('');

  useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => {
    if (!open) {
      setStage({ kind: 'idle' }); setText(''); setDragging(false);
      setFileDraft(null); setForm(blankDraft);
      setEdits(NO_EDITS); setChat([]); setAsk(''); setAsking(false); setFollowUp('');
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
      const matrix = readSheetMatrix(buffer, built.preview.sheetName);
      if (!matrix) { setStage({ kind: 'error', message: `讀不到工作表「${built.preview.sheetName}」。` }); return; }
      // A new file starts from its own cells: edits made to the previous one do not follow.
      setEdits(NO_EDITS); setChat([]);
      setFileDraft({ buffer, preview: built.preview, known: recognition.status === 'KNOWN', matrix });
      setStage({ kind: 'idle' });
    } catch (error) { fail(error); }
  };

  /**
   * Read the whole file against the workspace, with every confirmed cell change applied to
   * the sheet first. The person sees the actions, not the columns — but the actions are
   * always the product of the rules run on the changed sheet, never of the edit alone.
   */
  const withResult = (base: FilePlanBase, changes: PlanEdits): FilePlan => {
    const { mapping, overrides } = planInput(base.columns, changes);
    return {
      ...base,
      result: parseGenericRows({
        ...base.parse, mapping, matrix: base.matrix, overrides,
        snapshot: snapshot!, extraColumns: extraColumnsFor(base.preview, base.columns),
      }),
    };
  };


  /** A plan without the parse that is about to be recomputed. */
  const baseOf = (file: FilePlan): FilePlanBase => ({
    aiAssist: file.aiAssist, preview: file.preview, suggestion: file.suggestion,
    columns: file.columns, parse: file.parse, matrix: file.matrix,
  });

  /** One stage for one confirmed piece of work, whichever inputs went into it. */
  const showPlan = (file: FilePlan | undefined, text: TextPlan | undefined, notice?: string) => {
    if (file && text) setStage({ kind: 'plan', plan: { source: 'both', file, text }, notice });
    else if (file) setStage({ kind: 'plan', plan: { source: 'file', file }, notice });
    else if (text) setStage({ kind: 'plan', plan: { source: 'text', text } });
  };

  /**
   * Map the dropped sheet. What the person typed beside it goes along as context, so
   * 「大廈名稱在第 3 欄」 can explain the sheet; it can never add a column or a value.
   * Returns `null` when it has already put a reason on screen.
   */
  const planFile = async (
    context: string, defaultBuilding?: NamedBuilding,
    defaultPlace?: { buildingId: string; floorLabel: string; unitLabel: string },
  ): Promise<FilePlan | null | undefined> => {
    const draft = fileDraft;
    if (!draft) return undefined;
    // Personal-looking columns never leave the device by default; their content is still
    // kept in the note. This is stricter than the old opt-out and needs no extra screen.
    const { suggestion, aiAssist } = await suggestFileMapping(
      { preview: draft.preview, withheld: draft.preview.sensitiveColumns, context: context || undefined },
      (index, count) => setStage({ kind: 'busy', label: `正在請 AI 核對欄位（第 ${index}/${count} 段）…` }),
    );
    if (suggestion.status === 'REFUSE') { setStage({ kind: 'error', message: SCOPE_REFUSAL }); return null; }
    if (suggestion.status === 'NO_MATCH') { setStage({ kind: 'error', message: 'AI 看不出哪一欄對應哪一個既有欄位，沒有提出建議。可以只匯入工作表中間那一段，或改用人手對應。' }); return null; }
    const headerRow = suggestion.headerRow ?? draft.preview.headerRow;
    if (headerRow === null || headerRow === undefined) { setStage({ kind: 'error', message: 'AI 找不到表頭，無法確定哪一行才是資料。請在工作表加上表頭後再試。' }); return null; }
    const columns = Object.fromEntries(suggestion.fields.map(field => [field.key, field.columnIndex]));
    const run: ParseRun = { buffer: draft.buffer, sheetName: draft.preview.sheetName, headerRow: headerRow + 1, mapping: toMapping(columns), fileName: draft.preview.fileName, defaultBuilding, defaultPlace };
    return withResult({ aiAssist, preview: draft.preview, suggestion, columns, parse: run, matrix: draft.matrix }, edits);
  };

  /**
   * A question about open follow-ups is answered here, from the workspace, and never
   * leaves the device: follow-up text is encrypted on this device, so sending it to a
   * provider just to count tasks would break the promise the encryption makes. The
   * office can overrule the reading with 「改為整理成記錄」 and send it as a draft.
   */
  const answerReminder = (raw: string, keep?: { buildingId?: string; assignee?: string }) => {
    if (!snapshot) return;
    // One reading for the first question and every question after it (`src/ai/reminderQuery.ts`).
    const { book, advice, scope } = reminderAnswer(snapshot, raw, { viewer, now: today, keep });
    setFollowUp('');
    setStage({
      kind: 'reminder', book, text: raw, advice,
      ambiguous: scope.ambiguous,
      narrow: { buildingId: book.buildingId, assignee: book.assignee },
    });
  };

  /** Put the reviewed draft into the form; the person can still change every field. */
  const applyDraft = (value: AiDraft) => setForm({
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
    sourceType: value.sourceType ?? '',
    note: value.note ?? '',
    action: value.followUp?.action ?? '',
    dueDate: value.followUp?.dueDate ?? '',
    assignee: value.followUp?.assignee ?? '',
  });

  /**
   * One button for one piece of work. The sheet is mapped with the typed note as context, the
   * note is drafted on its own rules, and both land in one list with one confirmation. A
   * question about open follow-ups is still answered here, from the workspace, and never
   * leaves the device — so that path only applies when no file came with it.
   */
  const submit = async (asReminder = true, raw?: string) => {
    const typed = (raw ?? text).trim();
    if (!fileDraft && !typed) return;
    if (!snapshot) { setStage({ kind: 'error', message: '尚未載入工作區資料，無法核對大廈與單位。' }); return; }
    // A sheet in the box keeps the sheet route: the note beside it is its heading, not a question.
    // Task questions are answered before any AI check, so switching the assistant off never
    // takes away the person's own task list (`docs/AI_ASSISTANT.md` 8).
    if (shouldAnswerReminder(typed, { hasFile: !!fileDraft, asReminder })) { answerReminder(typed); return; }
    if (!aiEnabled) { setStage({ kind: 'error', message: 'AI 助手目前未開啟。這裡仍然可以問未完成的跟進；整理文字或表格要等管理員開啟 AI 助手。' }); return; }
    if (!orgId) { setStage({ kind: 'error', message: '未設定機構，無法使用 AI 助手。' }); return; }
    // No local keyword check otherwise: the assistant's own reply decides (`docs/AI_ASSISTANT.md` 7).
    setStage({ kind: 'busy', label: fileDraft ? '正在讀取檔案…' : '正在整理草稿…' });
    try {
      // The note the person typed is how a sheet with no 大廈 column gets one, and how a
      // sheet that never prints 樓層／單位 gets the place they named — 「在裕安樓 5 樓 B 室」.
      // Both are matched locally against the workspace's own names, so only a building and
      // a place they actually wrote can be used, and only for rows that name none
      // (CLAUDE.md §4). Two places in one sentence is not a choice the system may make.
      const mentioned = fileDraft ? mentionedPlace(snapshot.buildings, typed) : undefined;
      const fallback = mentioned?.building;
      const placeNotice = mentioned?.ambiguousPlaces
        ? `你在文字裡提到多個地點（${mentioned.ambiguousPlaces.join('、')}），系統沒有替你挑一個，所以沒有套用到沒有填樓層／單位的行。請只寫一個地點，或直接在表內補上。`
        : undefined;
      const file = await planFile(typed, fallback, mentioned?.place && fallback ? { buildingId: fallback.id, ...mentioned.place } : undefined);
      if (file === null) return;
      let draft: TextPlan | undefined;
      let notice: string | undefined;
      if (typed) {
        setStage({ kind: 'busy', label: '正在整理文字草稿…' });
        try {
          const { draft: value, aiAssist } = await suggestDraft({ text: typed, snapshot });
          if (value.status === 'REFUSE') {
            // A sheet that read cleanly is not thrown away because the note beside it was not a record.
            if (!file) { setStage({ kind: 'error', message: SCOPE_REFUSAL }); return; }
            notice = TEXT_CONTEXT_ONLY;
          } else if (file && !draftIsRecord(value)) {
            // It named a place but no visit: that is the file's heading, not a record.
            notice = TEXT_CONTEXT_ONLY;
          } else { applyDraft(value); draft = { aiAssist, value }; }
        } catch (error) {
          if (!file) { fail(error); return; }
          notice = `文字部分沒有整理成功（${message(error)}），下面只有檔案的部分。`;
        }
      }
      showPlan(file ?? undefined, draft, [notice, placeNotice].filter(Boolean).join(' ') || undefined);
    } catch (error) { fail(error); }
  };

  const plan = stage.kind === 'plan' ? stage.plan : undefined;

  const changeColumn = (key: CanonicalField, index: number | null) => {
    if (!plan || plan.source === 'text') return;
    const base = baseOf(plan.file);
    showPlan(withResult({ ...base, columns: { ...base.columns, [key]: index } }, edits), plan.source === 'both' ? plan.text : undefined, stage.kind === 'plan' ? stage.notice : undefined);
  };

  /** A cell changed by hand. The whole sheet is read again; nothing is patched in place. */
  const editCell = (key: string, value: string | null, source: EditSource) => {
    if (!plan || plan.source === 'text') return;
    const next = value === null ? withoutEdit(edits, key) : withEdit(edits, key, value, source);
    setEdits(next);
    showPlan(withResult(baseOf(plan.file), next), plan.source === 'both' ? plan.text : undefined, stage.kind === 'plan' ? stage.notice : undefined);
  };

  /** A bulk fill from the skipped table: one override layer, one re-parse of the sheet. */
  const editCells = (changes: readonly { key: string; value: string | null }[], source: EditSource) => {
    if (!plan || plan.source === 'text' || !changes.length) return;
    const next = changes.reduce((current, change) => change.value === null
      ? withoutEdit(current, change.key)
      : withEdit(current, change.key, change.value, source), edits);
    setEdits(next);
    showPlan(withResult(baseOf(plan.file), next), plan.source === 'both' ? plan.text : undefined, stage.kind === 'plan' ? stage.notice : undefined);
  };

  const runPlan = () => {
    if (!plan) return;
    runPlanWith(plan.source === 'text' ? undefined : plan.file, plan.source === 'file' ? undefined : plan.text);
  };

  /**
   * Run the whole list as one batch: create the floors/units it needs, read the file once
   * more against that workspace, build the draft's record, then write everything in one
   * call — one confirmation is one write.
   */
  const runPlanWith = (file: FilePlan | undefined, draft: TextPlan | undefined) => {
    if (!snapshot || (!file && !draft)) return;
    let latest = snapshot;
    const made: string[] = [];
    if (file) {
      const places = placesToCreate(file.result);
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
        made.push(`${place.floorLabel} ${place.unitLabel}`);
      }
    }
    const inputs: SaveObservationInput[] = [];
    if (file) {
      // Read again against the workspace as it now stands; the rows that waited for a place
      // are writable, and anything still short of a date, worker or result stays out.
      const { mapping, overrides } = planInput(file.columns, edits);
      const result = parseGenericRows({ ...file.parse, mapping, matrix: file.matrix, overrides, snapshot: latest, extraColumns: extraColumnsFor(file.preview, file.columns) });
      const chosen = plannedRows(result, new Set());
      if (!chosen.length && !draft) { setStage({ kind: 'error', message: '沒有任何一行可以寫入。未寫入的行都列在目標清單下面，並寫了原因。' }); return; }
      inputs.push(...chosen.map(row => ({ ...row.input!, aiAssist: file.aiAssist })));
    }
    if (draft) {
      const record = draftRecord(draft, latest);
      if (!record) return;
      inputs.push(record.input);
      if (record.created) made.push(record.created);
    }
    try {
      onWrite(inputs);
      const extra = made.length ? `，也新增了 ${made.length} 個樓層／單位` : '';
      setStage({ kind: 'done', message: `已寫入 ${inputs.length} 筆記錄${extra}。每筆都標了「由 AI 協助」。` });
    } catch (error) { fail(error); }
  };

  /** Turn the reviewed form into one record, creating its floor/unit first if the workspace lacks it. */
  const draftRecord = (draft: TextPlan, start: OutreachSnapshot): { input: SaveObservationInput; created?: string } | undefined => {
    if (!draftComplete(form)) {
      setStage({ kind: 'error', message: '大廈、日期與工作員都必須由人填寫。覆蓋結果可以留空。' });
      return undefined;
    }
    let latest = start;
    let created: string | undefined;
    let location = draftLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim());
    if ('error' in location) {
      const proposal = form.floor.trim() && form.unit.trim() ? proposeLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim()) : undefined;
      if (!proposal || !onApplyProposal) { setStage({ kind: 'error', message: location.error }); return undefined; }
      const applied = onApplyProposal(proposal);
      if ('error' in applied) { setStage({ kind: 'error', message: applied.error }); return undefined; }
      latest = applied.snapshot;
      created = `${form.floor.trim()} ${form.unit.trim()}`;
      location = draftLocation(latest, form.buildingId, form.floor.trim(), form.unit.trim());
      if ('error' in location) { setStage({ kind: 'error', message: location.error }); return undefined; }
    }
    return {
      created,
      input: {
        id: `ai:${crypto.randomUUID()}`, visitId: `ai-visit:${crypto.randomUUID()}`, buildingId: form.buildingId,
        floorId: location.floorId, unitId: location.unitId,
        occurredAt: form.time ? `${form.date}T${form.time}:00+08:00` : form.date,
        recordedAt: new Date().toISOString(), workerName: form.worker.trim(), coverage: form.coverage || undefined,
        contactOutcome: form.contact || undefined, assessment: form.assessment || undefined, sourceType: form.sourceType || undefined,
        note: form.note.trim() || undefined, evidence: [],
        followUp: form.action.trim() ? { action: form.action.trim(), status: 'OPEN', assignee: form.assignee.trim() || undefined, dueDate: form.dueDate || undefined } : undefined,
        aiAssist: draft.aiAssist,
      },
    };
  };

  /**
   * The plan's chat (`docs/AI_ASSISTANT.md` 6.2). The assistant proposes cells, never a new
   * row: every proposal goes into the same override layer a hand edit uses, and the sheet is
   * read again. A refusal is an answer too — it is kept in the transcript with its reason.
   */
  const askPlan = async () => {
    if (!plan || plan.source === 'text' || asking) return;
    const question = ask.trim();
    if (!question) return;
    const file = plan.file;
    setAsking(true);
    try {
      const answer = await suggestPatches({
        text: question, preview: file.preview, columns: file.columns,
        rows: file.result.rows.map(row => row.rowNumber),
        withheld: file.preview.sensitiveColumns,
      });
      if (answer.status === 'REFUSE') {
        setChat(turns => [...turns, { question, answer: answer.explanation, changed: 0 }]);
        setAsk('');
        return;
      }
      let next = edits;
      for (const patch of answer.patches) {
        const column = patch.column !== null ? patch.column
          : typeof file.columns[patch.field!] === 'number' ? file.columns[patch.field!]!
          : null;
        const key = column === null ? fieldKey(patch.row, patch.field!) : cellKey(patch.row, column);
        next = withEdit(next, key, patch.value, 'ai');
      }
      setEdits(next);
      showPlan(withResult(baseOf(file), next), plan.source === 'both' ? plan.text : undefined, stage.kind === 'plan' ? stage.notice : undefined);
      setChat(turns => [...turns, { question, answer: answer.explanation, changed: answer.patches.length }]);
      setAsk('');
    } catch (error) {
      setChat(turns => [...turns, { question, answer: message(error), changed: 0, failed: true }]);
    } finally { setAsking(false); }
  };

  return <dialog aria-labelledby="ai-title" ref={dialogRef} className="cf-dialog cf-dialog--ai" onCancel={event => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
    <div className="cf-ai">
      <header className="cf-dialog__header"><div><span className="cf-eyebrow">AI 助手</span><h2 id="ai-title">{aiEnabled ? '說一句，或放一份表' : '問未完成的跟進'}</h2></div><button className="cf-icon-button" onClick={onClose} aria-label="關閉"><X /></button></header>

      {stage.kind === 'idle' && <>
        {!snapshot && <p className="cf-error" role="alert"><AlertTriangle />尚未載入工作區資料，先載入後再使用。</p>}

        {/* One sheet, not a wall of instructions: the box is the whole screen, the
            examples are grey text under it, and everything about what leaves the device
            sits in one line plus a folded note. */}
        <div className="cf-ai__compose">
          <label className="cf-visually-hidden" htmlFor="ai-note">{aiEnabled ? '說一句，或貼上一段文字' : '問未完成的跟進'}</label>
          <textarea
            id="ai-note"
            className="cf-ai__text"
            rows={4}
            value={text}
            placeholder={aiEnabled ? '貼上紙本原話、口述，或問一句…' : '問一句，例如：這兩天有什麼跟進？'}
            onChange={event => setText(event.target.value)}
          />
          {/* Examples, not a menu: the box above takes any sentence, and these only fill it in. */}
          <p className="cf-ai__hints">
            <span>試試</span>
            {['今天有什麼未完成的跟進？', '這兩天有什麼跟進？', '給我行動建議'].map(question => <button key={question} type="button" className="cf-ai__hint" onClick={() => { setText(question); void submit(true, question); }}>{question}</button>)}
          </p>
        </div>

        {aiEnabled && <>
          <div
            className={`cf-ai__drop ${dragging ? 'is-dragging' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
            onDragOver={event => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void readFile(file); }}
          >
            <Upload size={17} />
            <strong>拖放 Excel／CSV 檔案到這裡</strong>
            <span>5 MB · 5000 行 · 64 欄，超出會請你先拆檔，不會偷偷截斷</span>
          </div>
          <input ref={inputRef} className="cf-visually-hidden" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void readFile(file); }} />
        </>}

        {fileDraft && <section className="cf-ai__file">
          <h3><FileSpreadsheet size={16} />{fileDraft.preview.fileName}</h3>
          <p>{outboundSummary(fileDraft.preview, fileDraft.preview.sensitiveColumns)}</p>
          {fileDraft.known && <p className="cf-ai__note">系統的規則識別已認得這個格式。多數情況可以直接用「紙本與 Excel」匯入；仍然想請 AI 核對欄位的話可以繼續。</p>}
          <div className="cf-ai__send">
            <button className="cf-button cf-button--ghost" onClick={() => setFileDraft(null)}>換一個檔案</button>
          </div>
        </section>}

        <div className="cf-ai__submit">
          <p className="cf-ai__promise"><ShieldCheck size={15} />
            {aiEnabled
              ? <span>AI 只提出草稿，<strong>不會寫入任何資料</strong>；你看過、按下「確認並執行」，記錄才會以你的身分存入，並標明「由 AI 協助」。</span>
              : <span>AI 助手目前未開啟，只可以使用任務提醒。清單和先後次序都在這部裝置計算，不會送交 AI，也沒有寫入任何資料。</span>}
          </p>
          <button className="cf-button cf-button--primary" disabled={!snapshot || (!fileDraft && !text.trim())} onClick={() => void submit()}>{aiEnabled ? <Upload size={16} /> : <Sparkles size={16} />}{aiEnabled ? '上傳' : '問一問'}</button>
        </div>

        <details className="cf-ai__about">
          <summary>使用說明</summary>
          {aiEnabled && <p>文字和檔案可以一起處理：文字整理成 1 筆記錄，檔案整理成逐行記錄，列在同一份「將執行的目標」裡，按一次確認全部寫入。對談內容<strong>只留在這部裝置</strong>，不上傳、不進匯出檔。</p>}
          <p>問未完成跟進、或問「給我行動建議」，都在工作區本機計算，內容不會送交 AI；<strong>建議按記錄上的到期日排出先後</strong>，不會替任務補日期或分派負責人。員工帳號只會看到指派給自己的任務。</p>
          {aiEnabled && <>
            <p>貼上的文字會送交 AI；檔案會先顯示行數與欄數，姓名、電話等欄不會送出。放了檔案時，這段文字也是整份表的抬頭：寫「在裕安樓 5 樓 B 室」，沒有填大廈／樓層／單位的行就按它處理；行裡自己寫了位置就照行裡的。</p>
            <p>AI 不會自己新增或改寫任何資料：表格寫到而工作區沒有的樓層／單位，會列在「將執行的目標」裡，由你確認後才建立；大廈本身仍要在地圖上新增。要更正舊記錄，只會產生一筆帶「更正原記錄」的追加記錄。</p>
          </>}
        </details>
      </>}

      {stage.kind === 'busy' && <p className="cf-ai__busy" role="status"><Sparkles size={18} />{stage.label}</p>}

      {plan && <PlanView
        plan={plan} snapshot={snapshot!} form={form} canCreate={!!onApplyProposal}
        notice={stage.kind === 'plan' ? stage.notice : undefined}
        edits={edits}
        chat={plan.source === 'text' ? undefined : { turns: chat, value: ask, asking, onChange: setAsk, onAsk: () => void askPlan() }}
        onChangeYear={year => {
          if (plan.source === 'text') return;
          const base = baseOf(plan.file);
          showPlan(withResult({ ...base, parse: { ...base.parse, sheetYear: year } }, edits), plan.source === 'both' ? plan.text : undefined);
        }}
        onChangeColumn={changeColumn} onChangeForm={(key, value) => setForm({ ...form, [key]: value })}
        onEdit={editCell} onEditMany={editCells}
        onRun={runPlan} onBack={() => { setStage({ kind: 'idle' }); setEdits(NO_EDITS); setChat([]); setAsk(''); }} />}

      {stage.kind === 'reminder' && <>
        {stage.advice
          ? <ReminderAdviceView book={stage.book} advice={stage.advice} onOpenTask={onOpenTask} />
          : <ReminderAnswer book={stage.book} onOpenTask={onOpenTask} />}

        {stage.ambiguous && stage.ambiguous.length > 0 && <p className="cf-reminder__hidden">
          <AlertTriangle size={14} />你在句子裡提到多個名字（{stage.ambiguous.join('、')}），系統沒有替你挑一個，所以沒有按名字篩選。請只寫一個名字。
        </p>}
        {stage.book.assignee && <p className="cf-reminder__note">已只看 {stage.book.assignee} 的任務；問「全部」或寫另一個名字可以換回。</p>}

        {/* Not a fixed menu: any sentence is read on the spot, and the shortcuts are
            examples in grey rather than choices that limit what can be asked. */}
        <form className="cf-reminder__ask" onSubmit={event => {
          event.preventDefault();
          const question = followUp.trim();
          if (!question || !snapshot) return;
          if (!looksLikeTaskFollowUp(snapshot, question)) {
            // A sentence that is not about tasks is offered as a record instead of being ignored.
            if (aiEnabled) void submit(false, question);
            else setStage({ kind: 'error', message: '這句話不像在問未完成的跟進。可以寫「明天有什麼？」「裕安樓有什麼？」「陳大文要做什麼？」或「給我行動建議」。' });
            return;
          }
          answerReminder(question, stage.narrow);
        }}>
          <label className="cf-visually-hidden" htmlFor="cf-reminder-ask">再問一句</label>
          <input id="cf-reminder-ask" className="cf-reminder__askinput" value={followUp} placeholder="再問一句，例如：明天呢？／裕安樓有什麼？／陳大文要做什麼？" onChange={event => setFollowUp(event.target.value)} />
          <button type="submit" className="cf-button cf-button--primary" disabled={!followUp.trim()}>問</button>
        </form>
        <p className="cf-reminder__hints">
          <span>可以這樣問：</span>
          {['明天呢？', '未來 7 天', '所有未完成', '裕安樓有什麼？', '給我行動建議'].map(example => <button key={example} type="button" className="cf-reminder__hint" onClick={() => setFollowUp(example)}>{example}</button>)}
        </p>

        <footer className="cf-dialog__footer">
          <span>{stage.advice ? '這份先後次序在工作區本機排出，沒有送交 AI，也沒有替任何人分派工作。' : '這份清單在工作區本機計算，沒有送交 AI，也沒有寫入任何資料。'}</span>
          <div>
            {stage.advice
              ? <button type="button" className="cf-reminder__softlink" onClick={() => setStage({ ...stage, advice: undefined })}>只看清單</button>
              : <button type="button" className="cf-reminder__softlink" onClick={() => answerReminder('給我行動建議', stage.narrow)}>按負責人看先後次序</button>}
            {aiEnabled && <button type="button" className="cf-reminder__softlink" onClick={() => void submit(false, stage.text)}>改成整理成一筆記錄</button>}
            <button type="button" className="cf-button cf-button--primary" onClick={() => setStage({ kind: 'idle' })}>返回</button>
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

/**
 * The plan screen: what will happen, from whichever inputs went in, and the one button that
 * writes it. Two sources stack with their own headings and their own rules, but they share
 * one footer — one press always means the whole list, never only the half that was ready.
 */
export function PlanView({ plan, snapshot, form, canCreate, notice, edits, chat, onChangeYear, onChangeColumn, onChangeForm, onEdit, onEditMany, onRun, onBack }: {
  plan: Plan; snapshot: OutreachSnapshot; form: DraftForm; canCreate: boolean; notice?: string;
  edits: PlanEdits; chat?: PlanChat;
  onChangeYear?: (year: number | undefined) => void;
  onChangeColumn: (key: CanonicalField, index: number | null) => void;
  onChangeForm: (key: keyof DraftForm, value: string) => void;
  onEdit: (key: string, value: string | null, source: EditSource) => void;
  onEditMany: (changes: readonly { key: string; value: string | null }[], source: EditSource) => void;
  onRun: () => void; onBack: () => void;
}) {
  const file = plan.source === 'text' ? undefined : plan.file;
  const text = plan.source === 'file' ? undefined : plan.text;
  const both = plan.source === 'both' ? plan : undefined;
  // The combined footer holds both halves' conditions, so one press can never write only
  // the part that happened to be ready.
  const writable = both ? filePlanRows(both.file, canCreate).writable.length : 0;
  const ready = !!both && writable > 0 && draftComplete(form);
  const note = !both ? '' : !writable
    ? '檔案部分沒有可以寫入的行（原因列在上面），請先修正欄位對應或取消。'
    : !draftComplete(form) ? '文字部分還有必填內容未填妥。'
    : '兩部分會在同一次寫入裡完成，以你的帳號署名，並標明「由 AI 協助」。';
  return <>
    {file && <FilePlanPanel plan={file} canCreate={canCreate} label={both ? `檔案：${file.preview.fileName}` : undefined}
      edits={edits} chat={chat} onChangeYear={onChangeYear} onChangeColumn={onChangeColumn} onEdit={onEdit} onEditMany={onEditMany} onRun={both ? undefined : onRun} onBack={onBack} />}
    {text && <DraftPlanPanel snapshot={snapshot} value={text.value} form={form} canCreate={canCreate}
      label={both ? '文字：由這段原話整理的 1 筆記錄' : undefined} onChange={onChangeForm}
      onRun={both ? undefined : onRun} onBack={onBack} />}
    {notice && <p className="cf-ai__note" role="status">{notice}</p>}
    {both && <footer className="cf-dialog__footer">
      <span>{note}</span>
      <div>
        <button className="cf-button cf-button--ghost" onClick={onBack}>取消</button>
        <button className="cf-button cf-button--primary" disabled={!ready} onClick={onRun}>確認並執行</button>
      </div>
    </footer>}
  </>;
}

/** The rows the file part can write, and the places it has to create first. */
function filePlanRows(plan: FilePlan, canCreate: boolean) {
  // Without the structure edit nothing can be created, so the rows that wait for a new
  // floor/unit are not counted as writable — no footer may promise them. A place is only
  // created when it turns a row into something writable.
  const places = canCreate ? placesToCreate(plan.result) : [];
  return { places, writable: plannedRows(plan.result, new Set(places.map(placeKey))) };
}

/** What a draft record needs from the person, whichever screen is asking. */
export const draftComplete = (form: DraftForm) => !!form.buildingId && !!form.date && !!form.worker.trim() && !!form.coverage && !!form.assessment && !!form.sourceType;

/**
 * The list of things that will happen, one line each, and the details folded behind it.
 * Each record opens into the cells it came from: a value per header, the source of the
 * last change (人 or AI), and a way to supply a field the sheet never printed.
 */
export function FilePlanPanel({ plan, canCreate, label, edits, chat, onChangeYear, onChangeColumn, onEdit, onEditMany, onRun, onBack }: {
  plan: FilePlan; canCreate: boolean; label?: string; edits: PlanEdits; chat?: PlanChat;
  onChangeYear?: (year: number | undefined) => void;
  onChangeColumn: (key: CanonicalField, index: number | null) => void;
  onEdit: (key: string, value: string | null, source: EditSource) => void;
  onEditMany: (changes: readonly { key: string; value: string | null }[], source: EditSource) => void;
  onRun?: () => void; onBack: () => void;
}) {
  const { result, preview, suggestion } = plan;
  const dateColumns = [plan.columns.occurredAt, plan.columns.followUpDueDate].filter((index): index is number => typeof index === 'number');
  const needsYear = plan.matrix.matrix.slice(plan.parse.headerRow).some(row => dateColumns.some(index => yearlessDate(row[index])));
  const { places, writable } = filePlanRows(plan, canCreate);
  const actions = planActions(places, writable);
  const creating = places.length;
  const planned = new Set(writable.map(row => row.rowNumber));
  const skipped = result.rows.filter(row => !planned.has(row.rowNumber));
  const extras = unmappedColumns(preview, plan.columns);
  const changed = editCounts(edits);
  const totalChanged = changed.person + changed.ai;
  const valuesOf = (rowNumber: number) => plan.matrix.matrix[rowNumber - 1] ?? [];
  const editor = (rowNumber: number) => {
    const row = result.rows.find(item => item.rowNumber === rowNumber);
    if (!row) return null;
    return <PlanRowEditor row={row} values={valuesOf(rowNumber)} preview={preview} columns={plan.columns} edits={edits} onEdit={onEdit} />;
  };
  return <>
    <section className="cf-ai__preview">
      <h3>{label ?? '將執行的目標'}</h3>
      {needsYear && <label className="cf-ai__year">這份表是哪一年？<input aria-label="這份表是哪一年？" type="number" min="1000" max="9999" step="1" placeholder="請填四位數年份" value={plan.parse.sheetYear ?? ''}
        onChange={event => onChangeYear?.(event.target.value ? Number(event.target.value) : undefined)} /><small>只套用原表沒有年份的日期，整份表會重新核對。</small></label>}
      <p className="cf-ai__note">{preview.fileName}：「{preview.sheetName}」共 {preview.totalRows} 行 → 寫入 {writable.length} 筆記錄{creating ? `，並新增 ${creating} 個樓層／單位` : ''}{skipped.length ? `；${skipped.length} 行不會寫入（原因在下面）` : ''}。</p>
      {totalChanged > 0 && <p className="cf-ai__note" role="status">已改 {totalChanged} 格（人手 {changed.person}、AI {changed.ai}）。每次改動都由系統重新核對整份表，不是只改畫面上的字。</p>}
      {result.notes.map((note, index) => <p className="cf-error" key={index}><AlertTriangle />{note}</p>)}
      {actions.length ? <ul className="cf-ai__actions">{actions.map(action => action.kind === 'place'
        ? <li key={action.key} className="is-place">
          <span className="cf-ai__rowmark">＋</span>
          <div><strong>{action.sentence}</strong>{action.detail && <small>{action.detail}</small>}</div>
        </li>
        : <li key={action.key} className="is-record">
          <span className="cf-ai__rowmark">＋</span>
          <div><RowDetails summary={<span><strong>{action.sentence}</strong>{action.detail && <small>{action.detail} · 可以改這一行</small>}</span>}>
            {editor(action.rowNumber)}
          </RowDetails></div>
        </li>)}</ul>
        : <p className="cf-ai__note">這份表沒有任何可以直接執行的事。下面列出的行都缺了必要內容，可以直接在行內補上，或叫 AI 幫你改。</p>}
      {extras.length > 0 && <p className="cf-ai__note">原表另有 {extras.length} 欄系統沒有對應（{extras.map(column => column.header || `第 ${column.columnIndex + 1} 欄`).join('、')}）：不用的話不用管，寫入時會把每一行的內容原樣記在備註，不會丟掉。</p>}
      {result.pending.length > 0 && !canCreate && <p className="cf-error"><AlertTriangle />結構編輯目前關閉，不能在這裡新增樓層或單位。請先在「編輯結構」新增，再回來執行。</p>}
      {skipped.length > 0 && <SkippedSection rows={skipped} valuesOf={valuesOf} preview={preview}
        columns={plan.columns} edits={edits} onEdit={onEdit} onEditMany={onEditMany} />}
      {chat && <PlanChatBox chat={chat} />}
    </section>
    <details className="cf-ai__mapping-details">
      <summary>AI 讀到的欄位對應（{suggestion.fields.length} 欄）</summary>
      <MappingTable preview={preview} suggestion={suggestion} columns={plan.columns} onChange={onChangeColumn} />
    </details>
    {onRun && <footer className="cf-dialog__footer">
      <span>按下確認才執行；以你的帳號署名，並標明「由 AI 協助」。</span>
      <div><button className="cf-button cf-button--ghost" onClick={onBack}>取消</button><button className="cf-button cf-button--primary" disabled={!writable.length} onClick={onRun}>確認並執行</button></div>
    </footer>}
  </>;
}

/** The chat beside the plan: one instruction in, cell changes out, nothing written yet. */
function PlanChatBox({ chat }: { chat: PlanChat }) {
  return <section className="cf-ai__chat">
    <h3>直接叫 AI 改這份表</h3>
    <p className="cf-ai__note">例如「第 3、4 行都是已嘗試接觸」、「這幾行日期改成 2026-10-11」。AI 只會改上面列出的行，改完系統會重新核對；寫入前仍要你按一次「確認並執行」。</p>
    {chat.turns.length > 0 && <ol className="cf-ai__turns">{chat.turns.map((turn, index) => <li key={index} className={turn.failed ? 'is-failed' : undefined}>
      <p className="cf-ai__ask">你：{turn.question}</p>
      <p>AI：{turn.answer}{turn.changed > 0 ? `（改了 ${turn.changed} 格）` : ''}</p>
    </li>)}</ol>}
    <form className="cf-ai__askform" onSubmit={event => { event.preventDefault(); chat.onAsk(); }}>
      <input aria-label="叫 AI 改這份表" value={chat.value} disabled={chat.asking} placeholder="用一句話說明要改什麼"
        onChange={event => chat.onChange(event.target.value)} />
      <button className="cf-button cf-button--primary" type="submit" disabled={chat.asking || !chat.value.trim()}>{chat.asking ? '正在核對…' : '請 AI 改'}</button>
    </form>
  </section>;
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

function DraftPlanPanel({ snapshot, value, form, canCreate, label, onChange, onRun, onBack }: {
  snapshot: OutreachSnapshot; value: AiDraft; form: DraftForm; canCreate: boolean; label?: string;
  onChange: (key: keyof DraftForm, value: string) => void; onRun?: () => void; onBack: () => void;
}) {
  const complete = draftComplete(form);
  const building = snapshot.buildings.find(item => item.id === form.buildingId);
  const target = form.buildingId ? draftLocation(snapshot, form.buildingId, form.floor.trim(), form.unit.trim()) : undefined;
  const proposal = target && 'error' in target && form.floor.trim() && form.unit.trim()
    ? proposeLocation(snapshot, form.buildingId, form.floor.trim(), form.unit.trim())
    : undefined;
  const where = building ? `${building.name}${form.floor.trim() || form.unit.trim() ? ` · ${[form.floor.trim(), form.unit.trim()].filter(Boolean).join(' ')}` : '（整幢）'}` : '尚未選擇大廈';
  return <>
    <section className="cf-ai__preview">
      <h3>{label ?? '將執行的目標'}</h3>
      <ul className="cf-ai__actions">
        {proposal && <li className="is-place">
          <span className="cf-ai__rowmark">＋</span>
          <div><strong>在「{building?.name}」新增「{form.floor.trim()} {form.unit.trim()}」</strong><small>{proposal.steps.join('；')}（工作區原本沒有）</small></div>
        </li>}
        <li className="is-record"><span className="cf-ai__rowmark">＋</span><div>
          <strong>在「{where}」新增 1 筆到訪記錄</strong>
          <small>{[form.date, form.worker.trim(), form.coverage ? coverageLabels[form.coverage] : '未更新覆蓋狀態'].filter(Boolean).join(' · ') || '尚未填寫'}</small>
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
        <label>覆蓋結果<select value={form.coverage} onChange={event => onChange('coverage', event.target.value)}><option value="">未填</option>{Object.entries(aiCoverageLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>接觸結果<select value={form.contact} onChange={event => onChange('contact', event.target.value)}><option value="">未填</option>{Object.entries(contactLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>住房判斷<select value={form.assessment} onChange={event => onChange('assessment', event.target.value)}><option value="">未填</option>{Object.entries(assessmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>資料來源<select value={form.sourceType} onChange={event => onChange('sourceType', event.target.value)}><option value="">未填</option>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="is-wide">備註<textarea rows={3} value={form.note} onChange={event => onChange('note', event.target.value)} /></label>
        <label className="is-wide">跟進行動<input value={form.action} placeholder="留空表示不需要跟進" onChange={event => onChange('action', event.target.value)} /></label>
        <label>跟進日期<input type="date" value={form.dueDate} onChange={event => onChange('dueDate', event.target.value)} /></label>
        <label>負責人<input value={form.assignee} onChange={event => onChange('assignee', event.target.value)} /></label>
      </div>
    </details>
    {onRun && <footer className="cf-dialog__footer">
      <span>{complete ? '寫入後會標明由 AI 協助，署名是你的帳號。' : '請填妥大廈、日期、工作員、覆蓋結果、住房判斷及資料來源。'}</span>
      <div><button className="cf-button cf-button--ghost" onClick={onBack}>取消</button><button className="cf-button cf-button--primary" disabled={!complete} onClick={onRun}>確認並執行</button></div>
    </footer>}
  </>;
}
