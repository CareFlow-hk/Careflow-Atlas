import { usableDeviceFix } from '../domain/deviceLocation';
import type { DeviceLocationSnapshot } from './locationMonitor';

const time = (timestamp: number) => new Intl.DateTimeFormat('zh-HK', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(timestamp);

/** Only an attempted opt-in belongs on the map; an unsupported, never-enabled browser stays silent. */
export function deviceLocationFailed(location: Pick<DeviceLocationSnapshot, 'enabled' | 'status'>): boolean {
  return location.status === 'denied' || location.status === 'timeout' || location.status === 'unavailable'
    || (location.status === 'unsupported' && location.enabled);
}

/** The status is deliberately separate from the settings switch's 開啟／關閉 label. */
export function deviceLocationStatusText(location: Pick<DeviceLocationSnapshot, 'enabled' | 'status' | 'fix'>, now = Date.now()): string {
  if (location.status === 'unsupported') return '此瀏覽器或目前連線不支援定位。請使用 HTTPS 或本機 localhost，並使用支援定位的瀏覽器。';
  if (location.status === 'denied') return '瀏覽器已拒絕定位。請在瀏覽器的網站設定允許「位置」，再重新整理；系統不會重複彈出要求。';
  if (location.status === 'requesting') return '正在要求瀏覽器提供目前位置…';
  if (location.status === 'timeout') return '定位逾時。這次未能取得位置；請檢查網絡及定位服務，重新整理會自動再試。';
  if (location.status === 'unavailable') return '暫時未能定位。請到較開揚的位置並檢查裝置定位服務，重新整理會自動再試。';
  if (location.status === 'ready' && location.fix) {
    const accuracy = `誤差約 ${Math.round(location.fix.accuracy)} 米`;
    const detail = usableDeviceFix(location.fix, now)
      ? '可用於附近大廈排序及初始地圖。'
      : '位置已過期或誤差超過 500 米，不會用於大廈排序或自動放大。';
    return `上次定位 ${time(location.fix.observedAt)}，${accuracy}。${detail}`;
  }
  return location.enabled ? '已開啟，等待頁面取得位置；每次重新整理都會自動定位。' : '已關閉，不會要求裝置位置。';
}
