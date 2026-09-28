import { Eye, EyeOff, Lock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { OPTION_FIELDS, type OptionField } from "../domain/types";
import { addCustomOption, builtInChoices, customOptions, removeCustomOption, setCustomOptionHidden, type CustomOptions } from "../domain/optionPrefs";

/*
 * The four fields whose menu can be extended, in the order the entry form shows them.
 * The wording is the form's own, so a person recognises the section they came from.
 */
const FIELD_LABELS: Record<OptionField, string> = {
  coverage: "覆蓋狀態", contactOutcome: "接觸結果", assessment: "住房判斷", sourceType: "資料來源",
};

export interface OptionManagerProps {
  prefs: CustomOptions;
  onChange: (prefs: CustomOptions) => void;
}

/**
 * Add, hide and delete self-defined choices (§10.4).
 *
 * Deliberately inline rather than a second dialog: the editor is already a modal, and
 * a nested one would put the menu behind the form that needs it. Nothing here carries
 * a `name`, so the surrounding form's FormData never picks up the manager's fields.
 */
export function OptionManager({ prefs, onChange }: OptionManagerProps) {
  const [drafts, setDrafts] = useState<Partial<Record<OptionField, { label: string; mapsTo: string }>>>({});

  return (
    <div className="cf-option-manager">
      <p className="cf-option-manager__note">
        自訂選項要聲明「歸入哪一類」，顏色管線只看這個歸類。內置選項不可刪除。
      </p>
      {OPTION_FIELDS.map(field => {
        const choices = builtInChoices(field);
        const custom = customOptions(prefs, field);
        const draft = drafts[field] ?? { label: "", mapsTo: choices[0].value };
        const add = () => {
          if (!draft.label.trim()) return;
          onChange(addCustomOption(prefs, field, { label: draft.label, mapsTo: draft.mapsTo }));
          setDrafts(current => ({ ...current, [field]: { label: "", mapsTo: draft.mapsTo } }));
        };
        return (
          <section className="cf-option-group" key={field}>
            <h4>{FIELD_LABELS[field]}</h4>
            <ul className="cf-option-list">
              {choices.map(choice => (
                <li key={choice.value} className="cf-option-built-in">
                  <Lock size={12} aria-hidden="true" />
                  <span>{choice.label}</span>
                  <small>內置</small>
                </li>
              ))}
              {custom.map(option => (
                <li key={option.id} className={option.hidden ? "is-hidden" : ""}>
                  <span>{option.label}</span>
                  <small>歸入「{choices.find(choice => choice.value === option.mapsTo)?.label ?? option.mapsTo}」</small>
                  <button type="button" className="cf-icon-button" aria-pressed={!!option.hidden}
                    title={option.hidden ? "重新顯示" : "隱藏（舊記錄仍會顯示）"}
                    onClick={() => onChange(setCustomOptionHidden(prefs, field, option.id, !option.hidden))}>
                    {option.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                  <button type="button" className="cf-icon-button" title="刪除"
                    onClick={() => onChange(removeCustomOption(prefs, field, option.id))}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="cf-option-add">
              <input value={draft.label} maxLength={24} placeholder="新增選項文字"
                onChange={event => setDrafts(current => ({ ...current, [field]: { ...draft, label: event.target.value } }))} />
              <select value={draft.mapsTo} aria-label={`${FIELD_LABELS[field]} 歸入哪一類`}
                onChange={event => setDrafts(current => ({ ...current, [field]: { ...draft, mapsTo: event.target.value } }))}>
                {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
              <button type="button" className="cf-button cf-button--secondary" disabled={!draft.label.trim()} onClick={add}>
                <Plus size={16} />新增
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
