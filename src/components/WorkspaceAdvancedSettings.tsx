import { useWorkspace } from "../app/store";
import { OptionManager } from "./OptionManager";

/** 設定 › 高級設定: this account's self-defined entry options. Everyday use needs none of it. */
export function WorkspaceAdvancedSettings() {
  const optionPrefs = useWorkspace(state => state.optionPrefs);
  const setOptionPrefs = useWorkspace(state => state.setOptionPrefs);
  return (
    <section className="cf-settings-advanced">
      <h3>常用選項</h3>
      <p className="cf-custom-options__note">把經常用到的說法存成選項，之後會出現在「記錄今次結果」的選單。每個自訂選項都要歸入一個內置類別，顏色只按類別計算。</p>
      <OptionManager prefs={optionPrefs} onChange={setOptionPrefs} />
    </section>
  );
}
