import { useEffect, useRef } from 'react';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { useDeviceLocation } from './deviceLocationContext';

/** Our explanation comes first; only this explicit click may invoke the browser's own permission prompt. */
export function DeviceLocationConsent() {
  const location = useDeviceLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !location.consentOpen) return;
    if (!element.open) element.showModal();
    return () => { if (element.open) element.close(); };
  }, [location.consentOpen]);
  if (!location.consentOpen) return null;
  return <dialog ref={dialog} className="location-consent" aria-labelledby="location-consent-title" aria-describedby="location-consent-description"
    onCancel={event => { event.preventDefault(); location.decline(); }}>
    <span className="location-consent__icon" aria-hidden="true"><LocateFixed size={25} /></span>
    <p className="location-consent__eyebrow">這部裝置的個人設定</p>
    <h2 id="location-consent-title">要開啟裝置定位嗎？</h2>
    <p id="location-consent-description">定位可讓工作台更方便配合你所在的位置：</p>
    <ul>
      <li><Search size={17} aria-hidden="true" /><span>新增大廈時，按地址相關程度及裝置遠近排序搜尋結果。</span></li>
      <li><MapPin size={17} aria-hidden="true" /><span>每次進入或重新整理後，以目前位置為中心適當放大地圖。</span></li>
    </ul>
    <p className="location-consent__privacy">位置只在這個頁面使用，不會儲存到工作區，也不會隨地址搜尋送出。你之後可隨時在「設定」關閉。地圖供應商仍會按地圖範圍接收圖磚要求。</p>
    <p className="location-consent__note">按下「開啟定位」後，瀏覽器會再詢問位置權限。</p>
    <div className="location-consent__actions">
      <button type="button" className="is-secondary" onClick={location.decline}>暫不開啟</button>
      <button type="button" className="is-primary" onClick={location.enable}>開啟定位</button>
    </div>
  </dialog>;
}
