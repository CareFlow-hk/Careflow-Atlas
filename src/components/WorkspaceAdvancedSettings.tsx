import { useState } from "react";
import { useWorkspace } from "../app/store";
import { deleteGate, type BackupAttempt } from "../domain/structure";
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
  const role = useWorkspace(state => state.role);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState<BackupAttempt>('IDLE');
  const [message, setMessage] = useState('');
  const gate = deleteGate(attempt);
  const counts = snapshot ? `${snapshot.buildings.length} 幢大廈、${snapshot.observations.length} 筆記錄` : '';
  /*
   * Clearing empties the whole institution's shared workspace, not one person's copy, so
   * only an administrator is offered it. The server refuses it for anyone else anyway;
   * hiding the button keeps the screen honest about what this account can do.
   */
  if (role === 'MEMBER') return (
    <section className="cf-settings-advanced">
      <h3>清空工作區</h3>
      <p className="cf-custom-options__note">清空會刪除整個機構的大廈、樓層、人員及到訪記錄，只有管理員可以執行。如需移除個別記錄，請在該記錄按「撤回這筆記錄」；撤回會保留歷史。</p>
    </section>
  );
  /** Answers whether the browser was handed the file; the answer is what opens the delete. */
  const exportExcel = async (): Promise<boolean> => {
    if (!snapshot) return false;
    setAttempt('WORKING');
    try {
      const { exportWorkflowWorkbook } = await import('../data/workflowWorkbook');
      const url = URL.createObjectURL(new Blob([exportWorkflowWorkbook(snapshot)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = 'CareFlow_紙本回錄工作簿.xlsx';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage('Excel 已交由瀏覽器下載。');
      setAttempt('DONE');
      return true;
    } catch { setMessage('Excel 匯出失敗，請重試。'); setAttempt('FAILED'); return false; }
  };
  const clear = () => {
    // The gate is enforced here too: a keyboard path must not skip the backup.
    if (!gate.allowed) return;
    try { clearWorkspace(); setConfirming(false); setAttempt('IDLE'); setMessage('已清空機構工作區（包括帳號端的副本）。所有同事重新整理後都會看到空白工作區。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '未能清空，原有記錄仍保留。'); }
  };
  return (
    <section className="cf-settings-advanced">
      <h3>清空工作區</h3>
      <p className="cf-custom-options__note">刪除整個機構的所有大廈、樓層、人員及到訪記錄：既刪瀏覽器裡的共享副本，也刪帳號端的副本。所有同事都會受影響；帳號和常用選項會保留。清空後不能復原，所以要先下載 Excel 備份。</p>
      {!snapshot ? <p className="cf-custom-options__note">工作區目前是空的。</p> : !confirming
        ? <div className="cf-clear-actions"><button type="button" onClick={() => void exportExcel()}>先匯出 Excel</button><button type="button" onClick={() => { setMessage(''); setAttempt('IDLE'); setConfirming(true); }}>清空工作區…</button></div>
        : <div className="cf-clear-confirm" role="alert">
            <p>確定清空？將刪除 {counts}，包括帳號端的副本，不能復原。</p>
            <div className="cf-clear-actions"><button type="button" onClick={() => void exportExcel()} disabled={attempt === 'WORKING'}>下載當前 Excel 備份</button><button type="button" className="cf-danger" disabled={!gate.allowed} onClick={clear}>確定清空</button><button type="button" onClick={() => setConfirming(false)}>取消</button></div>
            <p className={`cf-structure__gate${gate.allowed ? ' is-ready' : ''}`} role={attempt === 'FAILED' ? 'alert' : undefined}>{gate.note}</p>
          </div>}
      {message && <p className="cf-custom-options__note" role="status">{message}</p>}
    </section>
  );
}
