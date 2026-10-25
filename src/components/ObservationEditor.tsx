import { AlertCircle, CalendarDays, Save, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { previewState, type CoverageStatus, type HousingAssessment, type OptionField, type OptionNotes, type Observation } from "../domain/types";
import { assessmentLabels, coverageNotUpdatedLabel, stateColors, supportCategoryLabels } from "../domain/presentation";
import { applyCoverageChange, markTouched, menuChoices, customOptionFor, type CustomOptions, type DependentFields } from "../domain/optionPrefs";

/**
 * One field's choices as a row of tappable labels rather than a dropdown. A native
 * `<option>` cannot hold markup, so a colour dot per choice is only possible this way
 * — and it puts every choice on screen at once instead of behind a click.
 */
function ChoiceRow({ legend, note, name, choices, value, onChange, dotFor, required }: {
  legend: string;
  /** Said beside the legend about the value already chosen there, not about any one choice. */
  note?: string;
  name: string;
  choices: readonly { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (next: string) => void;
  /** Only the coverage row decides a colour, so only it shows dots. */
  dotFor?: (choice: string) => string | undefined;
  required?: boolean;
}) {
  return (
    <fieldset className="cf-choice-row">
      <legend>{legend}{note && <span className="cf-choice-row__hint">{note}</span>}{required && <span className="cf-required-mark" aria-hidden="true"> *</span>}</legend>
      <div className="cf-choice-row__items">
        {choices.map(choice => {
          const dot = dotFor?.(choice.value);
          return (
            <label key={choice.value} className={`cf-choice${value === choice.value ? " is-on" : ""}`} title={choice.hint}>
              <input type="radio" name={name} value={choice.value} checked={value === choice.value} required={required} onChange={() => onChange(choice.value)} />
              {dot && <i className="cf-choice__dot" style={{ "--cf-state": dot } as CSSProperties} aria-hidden="true" />}
              <span>{choice.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface ObservationDraft {
  /** The place being recorded. Absent when a whole selection is recorded at once. */
  subjectId?: string;
  /** A date alone is a complete answer: time is not required and is never invented. */
  occurredAt: string;
  /** Absent when the visit stated no coverage; the place's earlier result keeps standing. */
  coverage?: CoverageStatus;
  assessment?: HousingAssessment;
  sourceType?: "STAFF_OBSERVATION" | "RESIDENT_REPORT" | "UNKNOWN";
  optionNotes?: OptionNotes;
  note: string;
  evidence: string[];
  followUp?: Observation['followUp'];
  /** Batch only: also confirm every unit in the selection free of 劏房. */
  confirmNoSubdivision?: boolean;
}

export interface ObservationEditorProps {
  open: boolean;
  targetLabel: string;
  subjectId?: string;
  subjectType?: "UNIT" | "BUILDING";
  /**
   * Recording one result at several units at once. The units are the caller's business —
   * the form is told how many there are so it can say so, and so it can offer the
   * statements that only make sense for a set: 跟進 is left out, because a follow-up is one
   * place needing one thing done, and ticking it here would open one task per unit without
   * anyone asking for that.
   */
  batch?: { units: number };
  /** This account's self-defined choices. They are managed under 設定 › 高級設定. */
  optionPrefs?: CustomOptions;
  /**
   * Pre-selects 住房判斷 where the subject itself already answers the question — a
   * 劏房 room exists only because someone split its unit into rooms, so "工作人員已
   * 確認" restates that split rather than adding to it. Visible and changeable: it is
   * a starting point on the form, not a value written behind the recorder's back.
   */
  defaultAssessment?: HousingAssessment;
  /**
   * Pre-selects 覆蓋狀態 with what the subject's own last record stands at. Unlike
   * `defaultAssessment` this is not a restatement of anything already known — it is a
   * previous visit's result, so the form says 沿用上次結果 beside it to be checked.
   * Absent where there is no such record: 已完成探訪 is the ordinary outcome, but a form
   * must not answer for a visit nobody has described yet.
   */
  defaultCoverage?: CoverageStatus;
  onClose: () => void;
  onSubmit: (draft: ObservationDraft) => Promise<void> | void;
}

const nowLocal = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
/** The date the form opens on. A date is required; the time is not prefilled, because nobody stated it. */
const todayLocal = () => nowLocal().slice(0, 10);
/**
 * The stored occurrence string. A time, when given, makes a full instant; without one the
 * date stays a date — the record keeps date precision rather than inventing 00:00 (CLAUDE.md §4).
 */
const occurredAtValue = (date: string, time: string): string => (time ? new Date(`${date}T${time}`).toISOString() : date);

/*
 * The fields a form opens with, from the two defaults. A default is marked touched:
 * an untouched seed would be treated as an automatic suggestion and wiped by the next
 * coverage change — and `assessment` is exactly the field `impliedByCoverage` resets to
 * blank, so the housing answer would vanish the moment someone corrected the coverage.
 *
 * Used both as the first state and by the reset, so the pre-selection is on screen from
 * the first paint rather than after an effect has flushed.
 */
const seedFields = (defaultCoverage?: CoverageStatus, defaultAssessment?: HousingAssessment): DependentFields => ({
  ...(defaultCoverage ? { coverage: { value: defaultCoverage, touched: true } } : {}),
  ...(defaultAssessment ? { assessment: { value: defaultAssessment, touched: true } } : {}),
});

/*
 * v1 entry form. Nothing is pre-chosen for coverage on an ordinary unit. Leaving it at
 * the blank choice is a complete answer: the record says what this visit did
 * observe and the place's earlier coverage result keeps standing — the same reading the
 * housing row already uses for its own blank choice. Everything optional sits behind 「更多」.
 * Tasks are closed from the task itself (標記完成), not from this form.
 *
 * A 劏房 room is the one subject that opens with a field already answered, and the two
 * fields are answered for different reasons. 住房判斷 (`defaultAssessment`) restates what
 * the room already is: it is a room because someone split its unit. 覆蓋狀態
 * (`defaultCoverage`) is carried over from the room's own last record and is labelled as
 * carried over, because it is a previous visit's result rather than a restatement of this
 * one — and there is nothing to carry over for a room with no record, so it opens blank.
 * The recorder replaces either with one tap.
 */
export function ObservationEditor({ open, targetLabel, subjectId, batch, optionPrefs = {}, defaultAssessment, defaultCoverage, onClose, onSubmit }: ObservationEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /*
   * The dependent fields are controlled so a coverage change can fill them in. Reset
   * whenever the dialog opens, so a finished entry never seeds the next one.
   */
  const [fields, setFields] = useState<DependentFields>(() => seedFields(defaultCoverage, defaultAssessment));
  const [category, setCategory] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      triggerRef.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Reset when the dialog opens, so a finished entry never seeds the next one.
    setFields(seedFields(defaultCoverage, defaultAssessment));
    setCategory(""); setError("");
  }, [open, defaultCoverage, defaultAssessment]);

  const close = () => {
    if (saving) return;
    dialogRef.current?.close();
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  /*
   * A self-defined choice and a built-in one arrive through the same field. A custom
   * choice stores its declared value and keeps its own wording beside it; a built-in
   * stores itself and keeps nothing. The colour pipeline never sees the wording.
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
      const occurredDate = value("occurredDate");
      if (!occurredDate) throw new Error("請選擇發生日期。");
      if (!value("followUpReason") && ["assignee", "timingNote", "followUpDueAt"].some(key => value(key)) || !value("followUpReason") && category) throw new Error("已填跟進資料，請寫明跟進行動。");
      const coverage = resolve("coverage", value("coverageStatus"));
      const assessment = resolve("assessment", fields.assessment?.value ?? "");
      const sourceType = resolve("sourceType", fields.sourceType?.value ?? "");
      // 接觸結果 is not asked, so it is not stored: a value nobody confirmed is not a fact.
      const optionNotes: OptionNotes = { coverage: coverage.note, assessment: assessment.note, sourceType: sourceType.note };
      await onSubmit({
        subjectId,
        coverage: coverage.value as CoverageStatus | undefined,
        assessment: assessment.value as HousingAssessment | undefined,
        sourceType: sourceType.value as ObservationDraft["sourceType"],
        optionNotes: Object.values(optionNotes).some(Boolean) ? optionNotes : undefined,
        occurredAt: occurredAtValue(occurredDate, value("occurredTime")),
        note: value("note"),
        evidence: value("evidence").split(/\n|；/).map((item) => item.trim()).filter(Boolean),
        followUp: value("followUpReason") ? { action: value("followUpReason"), dueDate: value("followUpDueAt") || undefined, status: "OPEN", category: (category || undefined) as NonNullable<Observation['followUp']>['category'], assignee: value("assignee") || undefined, timingNote: value("timingNote") || undefined } : undefined,
        confirmNoSubdivision: data.has("confirmNoSubdivision") || undefined,
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
        <header className="cf-dialog__header"><div><span className="cf-eyebrow">記錄今次結果</span><h2 id="observation-title">{targetLabel}</h2></div><button type="button" className="cf-icon-button" onClick={close} aria-label="關閉"><X /></button></header>
        {/* One batch writes the same result to every picked unit; the follow-up blocks are gone
            because a follow-up is one place needing one thing done. */}
        {batch ? <p className="cf-editor__batch">會為已選的 {batch.units} 個單位各寫入一筆相同的記錄。</p> : null}
        {/* The dot beside a coverage choice is the colour it produces, from the same rule the map uses. */}
        <div className="cf-choice-grid">
          {/* Not required: the blank choice is a real answer, and it stores nothing, so
              the unit's last coverage result — and its colour — stands unchanged. */}
          <ChoiceRow legend="覆蓋狀態" name="coverageStatus"
            // Said only while the carried-over value is the one still chosen: once the
            // recorder picks another, nothing here is following the last record any more.
            note={defaultCoverage && fields.coverage?.value === defaultCoverage ? "沿用上次結果" : undefined}
            choices={[{ value: "", label: coverageNotUpdatedLabel }, ...menuChoices("coverage", optionPrefs)]}
            value={fields.coverage?.value ?? ""}
            onChange={next => setFields({ ...applyCoverageChange(fields, resolved("coverage", next)), coverage: { value: next, touched: true } })}
            dotFor={choice => choice ? stateColors[previewState(resolved("coverage", choice) as CoverageStatus, undefined, false)] : undefined} />
          {/* The blank choice stores nothing, so the unit's last judgement stands. Its
              wording comes from the one table the elevation key and the ledger read. */}
          <ChoiceRow legend="住房判斷" name="housingAssessment"
            choices={[{ value: "", label: assessmentLabels.NOT_UPDATED }, ...menuChoices("assessment", optionPrefs)]}
            value={fields.assessment?.value ?? ""}
            onChange={next => setFields(markTouched(fields, "assessment", next))} />
          <ChoiceRow legend="資料來源" name="sourceType"
            choices={menuChoices("sourceType", optionPrefs)}
            value={fields.sourceType?.value ?? ""}
            onChange={next => setFields(markTouched(fields, "sourceType", next))} />
        </div>
        <div className="cf-form-grid">
          {/* Required, and only the date: leaving the time empty keeps the record at date
              precision instead of inventing an hour from the entry moment. */}
          <label><span>發生日期</span><input type="date" name="occurredDate" defaultValue={todayLocal()} required /></label>
          <label><span>發生時間（可選）</span><input type="time" name="occurredTime" /></label>
          <label className="cf-field--wide"><span>記錄內容{batch ? "（會寫進每個單位）" : ""}</span><textarea name="note" rows={3} placeholder="看到、聽到或獲告知的內容，以及原話；不確定的地方照實寫。" /></label>
        </div>
        <details className="cf-more"><summary>更多</summary>
          <div className="cf-form-grid"><label className="cf-field--wide"><span>依據</span><input name="evidence" placeholder="例如：門牌細分；居民口述" /></label></div>
        </details>
        {batch ? (
          <label className="cf-editor__confirm"><input type="checkbox" name="confirmNoSubdivision" /><span>同時確認這些單位無劏房</span></label>
        ) : (
          <>
            <fieldset className="cf-followup-fields"><legend><CalendarDays size={17} />跟進（可選）</legend><label><span>跟進行動</span><input name="followUpReason" placeholder="例如：傍晚再訪" /></label><label><span>限期</span><input type="date" name="followUpDueAt" /></label></fieldset>
            <details className="cf-more"><summary>更多跟進資料</summary>
              {/* A blank category is allowed: "not classified" is not the same as "general". */}
              <div className="cf-choice-grid cf-choice-grid--followup">
                <ChoiceRow legend="跟進類別" name="category"
                  choices={[{ value: "", label: "未分類" }, ...Object.entries(supportCategoryLabels).map(([key, label]) => ({ value: key, label }))]}
                  value={category}
                  onChange={setCategory} />
              </div>
              <div className="cf-form-grid"><label><span>負責人</span><input name="assignee" /></label><label className="cf-field--wide"><span>時間原話／待確認</span><input name="timingNote" placeholder="例如：翌日午後，實際日期待確認" /></label></div>
            </details>
          </>
        )}
        {error && <p role="alert" className="cf-error"><AlertCircle size={17} />{error}</p>}
        <footer className="cf-dialog__footer"><span>儲存後舊記錄仍會保留。</span><div><button type="button" className="cf-button cf-button--ghost" onClick={close}>取消</button><button className="cf-button cf-button--primary" disabled={saving}><Save size={17} />{saving ? "儲存中…" : "儲存記錄"}</button></div></footer>
      </form>
    </dialog>
  );
}
