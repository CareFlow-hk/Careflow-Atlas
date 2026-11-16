import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const source = files(fileURLToPath(new URL('.', import.meta.url)));
const circles = new Set(['.demo-badge>span', '.status-pill i', '.app-statusbar i', '.help-legend i', '.building-row__name i', '.cf-plate__state i', '.cf-room-list__pick i', '.cf-event__rail span', '.cf-state-mark i', '.cf-floor-state', '.cf-choice__dot', '.loading-orbit', '.building-map-marker.is-compact', '.building-map-marker span', '.legend-swatch', '.floor-map-label__breakdown b', '.photo-service i']);

describe('the shared radius and stripe rules', () => {
  it('defines the shared radius tokens in the theme', () => {
    const tokens: Record<string, string> = {};
    postcss.parse(readFileSync(new URL('theme-atlas.css', import.meta.url), 'utf8')).walkRules(':root', rule => { rule.walkDecls(/^--radius-/, declaration => { tokens[declaration.prop] = declaration.value; }); });
    expect(tokens).toEqual({ '--radius-sm': '4px', '--radius-md': '8px', '--radius-lg': '20px' });
  });
  for (const file of source.filter(file => file.endsWith('.css'))) it(file.split('/src/')[1], () => {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls(declaration => {
      if (/^border(?:-[a-z]+)*-radius$/.test(declaration.prop)) {
        expect(['0', 'var(--radius-sm)', 'var(--radius-md)', 'var(--radius-lg)', '50%'], `${file}: ${declaration.toString()}`).toContain(declaration.value);
        if (declaration.value === '50%') {
          const rule = declaration.parent;
          expect(rule?.type).toBe('rule');
          if (rule?.type === 'rule') for (const selector of rule.selectors) expect(circles.has(selector.replace(/^\.app-shell /, '').replace(/^\.map-scene /, '')), selector).toBe(true);
        }
      }
      if (/^border-left/.test(declaration.prop)) expect(['0', 'none']).toContain(declaration.value);
      if (declaration.prop === 'box-shadow') expect(declaration.value).not.toMatch(/inset\s+-?[1-9][\d.]*px\s+0(?:px)?\b/);
    });
  });
  it('keeps the phone map full-height with floating chrome and a three-stop card', () => {
    const declarations = (name: string) => {
      const result: Record<string, Record<string, string>> = {};
      postcss.parse(readFileSync(new URL(name, import.meta.url), 'utf8')).walkRules(rule => {
        for (const selector of rule.selectors) {
          result[selector] ??= {};
          rule.walkDecls(declaration => { result[selector][declaration.prop] = declaration.value; });
        }
      });
      return result;
    };
    const mobile = declarations('mobile.css');
    expect(mobile['.app-shell'].position).toBe('fixed');
    expect(mobile['.spatial-content'].position).toBe('absolute');
    expect(mobile['.map-topbar'].display).toBe('none');
    expect(mobile['.app-shell .map-scene .map-location'].top).toBe('calc(env(safe-area-inset-top, 0px) + 82px)');
    expect(mobile['.app-shell .map-scene .map-legend'].bottom).toBe('calc(env(safe-area-inset-bottom, 0px) + 116px)');
    expect(mobile['.app-shell .map-scene .map-legend'].left).toBe('12px');
    expect(mobile['.app-shell .map-scene .map-notice'].bottom).toBe('calc(env(safe-area-inset-bottom, 0px) + 158px)');
    expect(mobile['.app-shell .map-scene .fp-editor-dock'].bottom).toBe('calc(env(safe-area-inset-bottom, 0px) + 88px)');
    expect(mobile['.app-shell .map-scene .fp-editor-dock'].left).toBe('12px');
    expect(mobile['.app-shell .map-scene .fp-editor-dock'].right).toBe('12px');
    expect(mobile['.app-shell .map-scene:has(.fp-editor-dock) .map-toolstack .map-tools:not(.map-tools--shape)'].display).toBe('none');
    expect(mobile['.app-shell .map-scene .maplibregl-ctrl-bottom-left .maplibregl-ctrl']['margin-left']).toBe('12px');
    expect(mobile['.app-shell .map-scene:has(.maplibregl-compact-show) .maplibregl-ctrl-scale'].visibility).toBe('hidden');
    expect(mobile['.cf-mobile-sheet'].position).toBe('absolute');
    expect(mobile['.cf-mobile-sheet.is-collapsed'].height).toBe('64px');
    expect(mobile['.cf-mobile-sheet.is-expanded'].left).toBe('6px');
    const theme = declarations('theme-atlas.css');
    expect(theme['.app-shell .app-header'].position).toBe('absolute');
    expect(theme['.app-shell .app-header'].background).toBe('transparent');
    expect(theme['.app-shell .brand']['border-radius']).toBe('var(--radius-lg)');
    expect(theme['.app-shell .account-menu>summary']['border-radius']).toBe('var(--radius-lg)');
    expect(theme['.app-shell .account-menu__avatar']['border-radius']).toBe('var(--radius-lg)');
    expect(theme['.app-shell .account-menu__list'].right).toBe('0');
    expect(theme['.app-shell .account-menu__list > button']['min-height']).toBe('44px');
  });
  it('does not bypass the stylesheet using inline radii or left stripes', () => {
    for (const file of source.filter(file => file.endsWith('.tsx'))) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(?:borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|borderLeft(?:Color|Width|Style)?)\s*:/);
  });
});
