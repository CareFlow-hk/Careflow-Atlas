import { Printer, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getOpenFollowUps, type OutreachSnapshot } from '../domain/types';
import { assessmentOptions, coverageOptionGroups } from '../domain/presentation';
import './paper.css';

export function PaperForm({ snapshot, buildingId, onClose }: { snapshot: OutreachSnapshot; buildingId?: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const active = document.activeElement as HTMLElement | null; dialogRef.current?.showModal(); return () => active?.focus(); }, []);
  const [selected, setSelected] = useState(buildingId ?? snapshot.buildings[0]?.id);
  const building = snapshot.buildings.find(b => b.id === selected);
  if (!building) return null;
  const tasks = getOpenFollowUps(snapshot).filter(f => f.buildingId === building.id);
  return <dialog ref={dialogRef} className="paper-shell" aria-label="大廈紙本預覽" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="paper-controls"><label>大廈<select value={selected} onChange={e => setSelected(e.target.value)}>{snapshot.buildings.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label><span>一幢大廈一張表 · A4 直向</span><button className="cf-button cf-button--primary" onClick={() => window.print()}><Printer size={17} />列印</button><button className="cf-icon-button" aria-label="關閉紙本預覽" autoFocus onClick={onClose}><X /></button></div>
    <article className="paper-page"><header><span>CareFlow Atlas · 合成示範</span><h1>大廈外展記錄表</h1><p>{building.name} {building.address}</p><small>大廈編號：{building.id}</small></header>
      <div className="paper-fields"><span>到訪日期：________________</span><span>工作員：________________</span><span>外出編號：________________</span><span>紙本編號：________________</span></div>
      <p className="paper-scope">本次範圍：________________ 入口情況：________________ 時間（未知可留空）：________</p>
      <table><thead><tr>{['行號', '樓層／單位', '覆蓋狀態', '觀察／居民原話', '跟進行動／負責人／時間原話'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{Array.from({ length: 10 }, (_, i) => <tr key={i}><td>{i + 1}</td><td /><td /><td /><td /></tr>)}</tbody></table>
      {/* The printed key uses the paper/Excel wording, the same the workbook writes, so the
          sheet and the form are read with one vocabulary. */}
      {/* The same three choices as the entry form; older wordings still import. */}
      <p className="paper-key">覆蓋狀態：{coverageOptionGroups.map(option => option.label).join('／')}。住房判斷（可留空）：{assessmentOptions.map(option => option.label).join('／')}。</p>
      <section><h2>出發前參考</h2>{tasks.length ? <ul>{tasks.slice(0, 3).map(t => <li key={t.observationId}>{snapshot.units.find(u => u.id === t.unitId)?.label ?? '大廈層面'}：{t.action}</li>)}</ul> : <p>暫無已記錄的待跟進事項。</p>}{tasks.length > 3 && <p>另有 {tasks.length - 3} 項，請參閱工作台或 Excel 待跟進頁。</p>}</section>
      <footer>未知不等於無發現。居民原話與工作員判斷分開記；「明年二月」「翌日」先保留原話。<br />回中心後將本表各行新增至 Excel「紙本回錄」，保留紙本編號與行號。此為暫擬表，非機構原表。</footer>
    </article>
  </dialog>;
}
