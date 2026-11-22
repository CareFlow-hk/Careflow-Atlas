import { useDeviceLocation } from './deviceLocationContext';
import { deviceLocationStatusText } from './deviceLocationStatus';

export function DeviceLocationSettings() {
  const location = useDeviceLocation();
  return <section className="account-location" aria-labelledby="account-location-title">
    <div className="account-location__heading">
      <div><h2 id="account-location-title">裝置定位</h2><p>只影響這個帳號在這部瀏覽器上的定位功能。</p></div>
      <button type="button" role="switch" aria-checked={location.enabled} aria-label="裝置定位" className={`account-location__switch ${location.enabled ? 'is-on' : ''}`}
        disabled={!location.supported && !location.enabled} onClick={location.enabled ? location.disable : location.enable}>{location.enabled ? '關閉' : '開啟'}</button>
    </div>
    <p className="account-location__status" role="status"><strong>目前狀態</strong><span>{deviceLocationStatusText(location)}</span></p>
    {!location.preferencePersistent && <p className="account-location__warning" role="alert">瀏覽器未能儲存這個選擇；本次仍可使用，重新整理後可能不會記住。</p>}
    <p className="account-location__privacy">位置只在這個頁面使用，不會寫入工作區或隨地址搜尋送出。地圖供應商仍會按地圖範圍接收圖磚要求。</p>
  </section>;
}
