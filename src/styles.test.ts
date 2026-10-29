import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const source = files(new URL('.', import.meta.url).pathname);
const circles = new Set(['.demo-badge>span', '.status-pill i', '.app-statusbar i', '.help-legend i', '.building-row__name i', '.cf-plate__state i', '.cf-room-list__pick i', '.cf-event__rail span', '.cf-state-mark i', '.cf-floor-state', '.cf-choice__dot', '.loading-orbit', '.building-map-marker.is-compact', '.building-map-marker span', '.legend-swatch', '.floor-map-label__breakdown b', '.photo-service i']);

describe('the shared radius and stripe rules', () => {
  it('defines the two tokens in the theme', () => {
    const tokens: Record<string, string> = {};
    postcss.parse(readFileSync(new URL('theme-atlas.css', import.meta.url), 'utf8')).walkRules(':root', rule => { rule.walkDecls(/^--radius-/, declaration => { tokens[declaration.prop] = declaration.value; }); });
    expect(tokens).toEqual({ '--radius-sm': '4px', '--radius-md': '8px' });
  });
  for (const file of source.filter(file => file.endsWith('.css'))) it(file.split('/src/')[1], () => {
    postcss.parse(readFileSync(file, 'utf8')).walkDecls(declaration => {
      if (/^border(?:-[a-z]+)*-radius$/.test(declaration.prop)) {
        expect(['0', 'var(--radius-sm)', 'var(--radius-md)', '50%'], `${file}: ${declaration.toString()}`).toContain(declaration.value);
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
  it('does not bypass the stylesheet using inline radii or left stripes', () => {
    for (const file of source.filter(file => file.endsWith('.tsx'))) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\b(?:borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|borderLeft(?:Color|Width|Style)?)\s*:/);
  });
});
