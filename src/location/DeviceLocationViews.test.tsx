import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DeviceLocationConsent } from './DeviceLocationConsent';
import { DeviceLocationSettings } from './DeviceLocationSettings';
import { DeviceLocationContextProvider, type DeviceLocationContextValue } from './deviceLocationContext';

const value = (over: Partial<DeviceLocationContextValue> = {}): DeviceLocationContextValue => ({
  supported: true, prompted: false, enabled: false, status: 'idle', preferencePersistent: true, consentOpen: false,
  enable: vi.fn(), disable: vi.fn(), decline: vi.fn(), ...over,
});

describe('device location consent and personal settings', () => {
  it('explains the browser prompt and offers a real way to decline', () => {
    const html = renderToStaticMarkup(<DeviceLocationContextProvider value={value({ consentOpen: true })}><DeviceLocationConsent /></DeviceLocationContextProvider>);
    expect(html).toContain('要開啟裝置定位嗎？');
    expect(html).toContain('開啟定位');
    expect(html).toContain('暫不開啟');
    expect(html).toContain('不會隨地址搜尋送出');
    expect(html).toContain('瀏覽器會再詢問位置權限');
  });

  it('keeps the only switch label separate from the current status', () => {
    const off = renderToStaticMarkup(<DeviceLocationContextProvider value={value()}><DeviceLocationSettings /></DeviceLocationContextProvider>);
    expect(off).toContain('role="switch"');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('>開啟</button>');
    expect(off).toContain('目前狀態');
    expect(off).not.toContain('重新定位');

    const on = renderToStaticMarkup(<DeviceLocationContextProvider value={value({ enabled: true, prompted: true, status: 'ready', fix: { lat: 22.2865, lng: 114.14175, accuracy: 25.4, observedAt: Date.now() } })}><DeviceLocationSettings /></DeviceLocationContextProvider>);
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain('>關閉</button>');
    expect(on).toContain('誤差約 25 米');
  });

  it('shows an actionable denial without presenting a denied switch as enabled', () => {
    const html = renderToStaticMarkup(<DeviceLocationContextProvider value={value({ prompted: true, status: 'denied' })}><DeviceLocationSettings /></DeviceLocationContextProvider>);
    expect(html).toContain('>開啟</button>');
    expect(html).toContain('瀏覽器已拒絕定位');
    expect(html).toContain('網站設定');
  });
});
