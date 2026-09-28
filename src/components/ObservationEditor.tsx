import { AlertCircle, CalendarDays, FileText, Save, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { previewState, type ContactOutcome, type CoverageStatus, type HousingAssessment, type OpenFollowUp, type OptionField, type OptionNotes, type Observation } from "../domain/types";
import { stateColors, supportCategoryLabels } from "../domain/presentation";
import { applyCoverageChange, dependentDefaults, descriptiveAnswer, impliedByCoverage, markTouched, menuChoices, customOptionFor, OTHER_CHOICE, type CustomOptions, type DependentFields } from "../domain/optionPrefs";
import { OptionManager } from "./OptionManager";

const DEFAULT_COVERAGE: CoverageStatus = "ATTEMPTED";

/** The three rows that offer a free-text 「其他」. None of them decides a colour. */
const blankOtherText = () => ({ assessment: "", sourceType: "", followUpCategory: "" });
type OtherKey = keyof ReturnType<typeof blankOtherText>;

/**
 * One field's choices as a row of tappable labels rather than a dropdown. A native
 * `<option>` cannot hold markup, so a colour dot per choice is only possible this way
 * — and it puts every choice on screen at once instead of behind a click.
 */
function ChoiceRow({ legend, hint, name, choices, value, onChange, dotFor, other }: {
  legend: string; hint?: string; name: string;
  choices: readonly { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (next: string) => void;
  /** Undefined for the fields that do not decide a colour. */
  dotFor?: (choice: string) => string | undefined;
  /** Adds a free-text 「其他」 at the end of the row. Descriptive only — see OTHER_CHOICE. */
  other?: { text: string; placeholder: string; onText: (next: string) => void };
}) {
  const isOther = Boolean(other) && value === OTHER_CHOICE;
  return (
    <fieldset className="cf-choice-row">
      <legend>{legend}</legend>
      {hint && <p className="cf-choice-row__hint">{hint}</p>}
      <div className="cf-choice-row__items">
        {choices.map(choice => {
          const dot = dotFor?.(choice.value);
          return (
            <label key={choice.value} className={`cf-choice${value === choice.value ? " is-on" : ""}`} title={choice.hint}>
              <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
              {dot && <i className="cf-choice__dot" style={{ "--cf-state": dot } as CSSProperties} aria-hidden="true" />}
              <span>{choice.label}</span>
            </label>
          );
        })}
        {other && <label className={`cf-choice cf-choice--other${isOther ? " is-on" : ""}`}>
          <input type="radio" name={name} value={OTHER_CHOICE} checked={isOther} onChange={() => onChange(OTHER_CHOICE)} />
          <span>其他</span>
        </label>}
        {/* The box sits in the row it belongs to, so writing your own wording costs one click. */}
        {other && isOther && <input className="cf-choice__other" value={other.text} placeholder={other.placeholder}
          aria-label={`${legend}：其他`} onChange={event => other.onText(event.target.value)} />}
      </div>
    </fieldset>
  );
}

export interface ObservationDraft {
  subjectId: string;
  occurredAt: string;
  coverage: CoverageStatus;
  contactOutcome?: ContactOutcome;
  assessment?: HousingAssessment;
  sourceType?: "STAFF_OBSERVATION" | "RESIDENT_REPORT" | "UNKNOWN";
  optionNotes?: OptionNotes;
  note: string;
  evidence: string[];
  followUp?: Observation['followUp'];
  resolvesObservationId?: string;
}

export interface ObservationEditorProps {
  open: boolean;
  targetLabel: string;
  subjectId: string;
  subjectType?: "UNIT" | "BUILDING";
  openFollowUps?: OpenFollowUp[];
  /** This account's self-defined choices, and a way to change them. */
  optionPrefs?: CustomOptions;
  onOptionPrefsChange?: (prefs: CustomOptions) => void;
  onClose: () => void;
  onSubmit: (draft: ObservationDraft) => Promise<void> | void;
}

const nowLocal = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};

export function ObservationEditor({ open, targetLabel, subjectId, openFollowUps = [], optionPrefs = {}, onOptionPrefsChange, onClose, onSubmit }: ObservationEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  /*
   * The dependent fields are controlled so a coverage change can fill them in. Reset
   * whenever the dialog opens, so a finished entry never seeds the next one.
   */
  const [fields, setFields] = useState<DependentFields>(() => dependentDefaults(DEFAULT_COVERAGE));
  /** The free-text 「其他」 wording, held only while 「其他」 is the chosen value. */
  const [otherText, setOtherText] = useState<Record<OtherKey, string>>(blankOtherText);
  const [category, setCategory] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => { if (open) { setFields(dependentDefaults(DEFAULT_COVERAGE)); setOtherText(blankOtherText); setCategory(""); setManaging(false); setError(""); } }, [open]);

  const close = () => {
    if (saving) return;
    dialogRef.current?.close();
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  /*
   * A self-defined choice and a built-in one arrive through the same field. A custom
   * choice stores its declared value and keeps its own wording beside it; a built-in
   * stores itself and keeps nothing. The pipeline above never sees the wording.
   */
  const resolve = (field: OptionField, chosen: string): { value?: string; note?: string } => {
    const custom = customOptionFor(field, optionPrefs, chosen);
    return custom ? { value: custom.mapsTo, note: custom.label } : { value: chosen || undefined };
  };
  /** What a chosen menu entry would actually store — a custom entry stores its declared value. */
  const resolved = (field: OptionField, chosen: string | undefined) => resolve(field, chosen ?? "").value ?? "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    setSaving(true); setError("");
    try {
      if (!String(data.get('followUpReason') ?? '').trim() && ['assignee', 'timingNote', 'followUpDueAt'].some(key => String(data.get(key) ?? '').trim())) throw new Error('已填跟進資料，請寫明跟進行動。');
      const coverage = resolve("coverage", value("coverageStatus"));
      /* The three descriptive rows answer through `descriptiveAnswer`: 「其他」 keeps the
         wording and stores no value, so none of them can invent a marker or a category. */
      const assessment = descriptiveAnswer(fields.assessment?.value, otherText.assessment, next => resolve("assessment", next));
      const sourceType = descriptiveAnswer(fields.sourceType?.value, otherText.sourceType, next => resolve("sourceType", next));
      // 跟進類別 offers the built-in categories only, so its own value is what gets stored.
      const categoryAnswer = descriptiveAnswer(category, otherText.followUpCategory, next => ({ value: next || undefined }));
      const chosenCategory = categoryAnswer.value ?? "";
      /*
       * 接觸結果 is no longer asked: it followed the coverage so closely that the two rows
       * read as one question. It is still stored, derived from the coverage, so a new
       * record and an old one are read by the pipeline exactly the same way.
       */
      const contactOutcomeValue = impliedByCoverage("contactOutcome", coverage.value ?? "UNVISITED") as ContactOutcome | undefined;
      /*
       * Each note is whatever the row kept: the sentence typed under 「其他」, or the
       * wording of the custom option that was picked instead of a built-in.
       */
      const optionNotes: OptionNotes = {
        coverage: value("noteCoverage") || coverage.note || undefined,
        assessment: assessment.note || undefined,
        sourceType: sourceType.note || undefined,
        followUpCategory: categoryAnswer.note || undefined,
      };
      await onSubmit({
        subjectId,
        coverage: (coverage.value ?? "UNVISITED") as CoverageStatus,
        contactOutcome: contactOutcomeValue,
        assessment: assessment.value as HousingAssessment | undefined,
        sourceType: sourceType.value as ObservationDraft["sourceType"],
        optionNotes: Object.values(optionNotes).some(Boolean) ? optionNotes : undefined,
        occurredAt: new Date(String(data.get("occurredAt"))).toISOString(),
        note: [String(data.get("finding") ?? ""), String(data.get("note") ?? "")].filter(Boolean).join("\n"),
        evidence: String(data.get("evidence") ?? "").split(/\n|；/).map((item) => item.trim()).filter(Boolean),
        followUp: String(data.get("followUpReason") ?? "") ? { action: String(data.get("followUpReason")), dueDate: String(data.get("followUpDueAt") ?? "") || undefined, status: "OPEN", category: (chosenCategory || undefined) as NonNullable<Observation['followUp']>['category'], assignee: value("assignee") || undefined, timingNote: value("timingNote") || undefined } : undefined,
        resolvesObservationId: value("resolvesObservationId") || undefined,
      });
      dialogRef.current?.close();
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "未能儲存，草稿仍保留在表格中。請稍後再試。");
    } finally { setSaving(false); }
  };

  return (
    <dialog aria-labelledby="observation-title" ref={dialogRef} className="cf-dialog" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { if (open && !saving) onClose(); }}>
      <form className="cf-editor" onSubmit={submit}>
        <header className="cf-dialog__header"><div><span className="cf-eyebrow">中心補錄／追加結果</span><h2 id="observation-title">{targetLabel}</h2></div><button type="button" className="cf-icon-button" onClick={close} aria-label="關閉"><X /></button></header>
        <p className="cf-callout"><AlertCircle size={17} />三個結果分開記錄；「無人應門」不會清除住房線索。</p>
        {/*
          * Each field writes one canonical value, so old records keep theirs. The dot
          * beside a choice is the colour that choice produces, asked of the same rule the
          * map and the lists use, so it can never drift from what saving would do.
          */}
        <div className="cf-choice-grid">
          <ChoiceRow legend="覆蓋狀態" hint="顏色小點＝這個選擇會得出的底色（未計跟進）" name="coverageStatus"
            choices={menuChoices("coverage", optionPrefs)}
            value={fields.coverage?.value ?? DEFAULT_COVERAGE}
            onChange={next => setFields({ ...applyCoverageChange(fields, resolved("coverage", next)), coverage: { value: next, touched: true } })}
            dotFor={choice => stateColors[previewState(resolved("coverage", choice) as CoverageStatus, impliedByCoverage("contactOutcome", resolved("coverage", choice)) as ContactOutcome | undefined, false)]} />
          {/* Neither of the next two decides a colour, so neither gets a dot. */}
          <ChoiceRow legend="住房判斷" hint="不影響底色；自填文字不會自動變成線索標記" name="housingAssessment"
            choices={[{ value: "", label: "（今次未更新）" }, ...menuChoices("assessment", optionPrefs)]}
            value={fields.assessment?.value ?? ""}
            onChange={next => setFields(markTouched(fields, "assessment", next))}
            other={{ text: otherText.assessment, placeholder: "例如：走廊見到分間門牌", onText: text => setOtherText({ ...otherText, assessment: text }) }} />
          <ChoiceRow legend="資料來源" hint="只作記錄，不影響底色" name="sourceType"
            choices={menuChoices("sourceType", optionPrefs)}
            value={fields.sourceType?.value ?? ""}
            onChange={next => setFields(markTouched(fields, "sourceType", next))}
            other={{ text: otherText.sourceType, placeholder: "例如：樓下商戶告知", onText: text => setOtherText({ ...otherText, sourceType: text }) }} />
        </div>
        <div className="cf-form-grid">
          <label className="cf-field--wide"><span>發生時間</span><input type="datetime-local" name="occurredAt" defaultValue={nowLocal()} required /></label>
          <label className="cf-field--wide"><span>觀察／發現</span><textarea name="finding" rows={2} placeholder="只寫下看到、聽到或獲告知的內容；保留不確定性。" /></label>
          <label className="cf-field--wide"><span><FileText size={15} />補充備註</span><textarea name="note" rows={2} placeholder="例如：敲門次數、未能定位的樓層線索" /></label>
          <label className="cf-field--wide"><span>證據說明</span><input name="evidence" placeholder="例如：門牌細分；居民口述（不會自動判定）" /></label>
        </div>
        {/*
          * The three descriptive rows write their own wording inline now. Coverage keeps
          * its box here: it is the one field the pipeline reads, so a sentence beside it
          * has to stay clearly separate from the value that decides the colour.
          */}
        <details className="cf-custom-options"><summary>覆蓋狀態原話與常用選項（可選）</summary><p className="cf-custom-options__note">覆蓋狀態的選項都不貼切時，在此寫下原話。記錄會同時保留所選項目和這段文字。</p>
          <div className="cf-form-grid"><label><span>覆蓋狀態原話</span><input name="noteCoverage" placeholder="例如：只走到樓梯口" /></label></div>
          <p className="cf-custom-options__note">經常用到的原話，可以存成選項，下次直接揀。</p>
          <button type="button" className="cf-button cf-button--ghost" aria-expanded={managing} onClick={() => setManaging(!managing)}><Settings2 size={16} />管理常用選項</button>
        </details>
        {managing && onOptionPrefsChange && <OptionManager prefs={optionPrefs} onChange={onOptionPrefsChange} />}
        <fieldset className="cf-followup-fields"><legend><CalendarDays size={17} />可選跟進</legend><label><span>跟進行動</span><input name="followUpReason" placeholder="例如：與同事討論後再訪" /></label><label><span>限期</span><input type="date" name="followUpDueAt" /></label></fieldset>
        {/* A blank category is allowed: "not classified" is not the same as "general". */}
        <div className="cf-choice-grid cf-choice-grid--followup">
          <ChoiceRow legend="跟進類別" hint="不影響底色；自填類別會依原話記錄，不歸入任何分類" name="category"
            choices={[{ value: "", label: "未分類" }, ...Object.entries(supportCategoryLabels).map(([key, label]) => ({ value: key, label }))]}
            value={category}
            onChange={setCategory}
            other={{ text: otherText.followUpCategory, placeholder: "例如：水電維修轉介", onText: text => setOtherText({ ...otherText, followUpCategory: text }) }} />
          <div className="cf-form-grid"><label><span>負責人（可選）</span><input name="assignee" /></label><label className="cf-field--wide"><span>時間原話／待確認</span><input name="timingNote" placeholder="例如：翌日午後，實際日期待確認" /></label></div>
        </div>
        {openFollowUps.length > 0 && <label className="cf-resolve-field"><span>同時結束既有復訪（可選）</span><select name="resolvesObservationId" defaultValue=""><option value="">保留所有待跟進項目</option>{openFollowUps.map((item) => <option key={item.observationId} value={item.observationId}>{item.action}{item.dueDate ? ` · ${item.dueDate}` : ""}</option>)}</select><small>舊記錄仍保留；這次新增的事件會註明已結束哪一項復訪。</small></label>}
        {error && <p role="alert" className="cf-error"><AlertCircle size={17} />{error}</p>}
        <footer className="cf-dialog__footer"><span>儲存會追加新事件，不會覆蓋舊記錄。</span><div><button type="button" className="cf-button cf-button--ghost" onClick={close}>取消</button><button className="cf-button cf-button--primary" disabled={saving}><Save size={17} />{saving ? "儲存中…" : "儲存記錄"}</button></div></footer>
      </form>
    </dialog>
  );
}
