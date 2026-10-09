import { useState } from "react";
import { useWorkspace } from "../app/store";
import { OptionManager } from "./OptionManager";

/** 設定 › 高級設定: this account's self-defined entry options. Everyday use needs none of it. */
export function WorkspaceAdvancedSettings() {
  const optionPrefs = useWorkspace(state => state.optionPrefs);
  const setOptionPrefs = useWorkspace(state => state.setOptionPrefs);
  return (
    <>
      <section className="cf-settings-advanced">
        <h3>常用選項</h3>
        <p className="cf-custom-options__note">把經常用到的說法存成選項，之後會出現在「記錄今次結果」的選單。每個自訂選項都要歸入一個內置類別，顏色只按類別計算。</p>
        <OptionManager prefs={optionPrefs} onChange={setOptionPrefs} />
      </section>
      <ClearWorkspace />
    </>
  );
}

/** Two steps, with an export beside the button: clearing cannot be undone. */
function ClearWorkspace() {
  const snapshot = useWorkspace(state => state.snapshot);
  const clearWorkspace = useWorkspace(state => state.clearWorkspace);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const counts = snapshot ? `${snapshot.buildings.length} 幢大廈、${snapshot.observations.length} 筆記錄` : '';
  const exportExcel = async () => {
    if (!snapshot) return;
    try {
      const { exportWorkflowWorkbook } = await import('../data/workflowWorkbook');
      const url = URL.createObjectURL(new Blob([exportWorkflowWorkbook(snapshot)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = 'CareFlow_紙本回錄工作簿.xlsx';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage('Excel 已交由瀏覽器下載。');
    } catch { setMessage('Excel 匯出失敗，請重試。'); }
  };
  const clear = () => {
    try { clearWorkspace(); setConfirming(false); setMessage('已清空工作區。回到地圖後可重新載入示範資料或匯入 Excel。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '未能清空，原有記錄仍保留。'); }
  };
  return (
    <section className="cf-settings-advanced">
      <h3>清空工作區</h3>
      <p className="cf-custom-options__note">刪除這個帳號在這個瀏覽器裡的所有大廈、樓層、人員及到訪記錄，用於重新開始示範或測試。帳號和常用選項會保留。清空後不能復原，需要的話請先匯出 Excel。</p>
      {!snapshot ? <p className="cf-custom-options__note">工作區目前是空的。</p> : !confirming
        ? <div className="cf-clear-actions"><button type="button" onClick={() => void exportExcel()}>先匯出 Excel</button><button type="button" onClick={() => { setMessage(''); setConfirming(true); }}>清空工作區…</button></div>
        : <div className="cf-clear-confirm" role="alert">
            <p>確定清空？將刪除 {counts}，不能復原。</p>
            <div className="cf-clear-actions"><button type="button" onClick={() => setConfirming(false)}>取消</button><button type="button" className="cf-danger" onClick={clear}>確定清空</button></div>
          </div>}
      {message && <p className="cf-custom-options__note" role="status">{message}</p>}
    </section>
  );
}
