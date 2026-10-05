import { describe, expect, it } from 'vitest';
import { layoutSummary, parseLayoutSummary, isUndeclaredLayout, UNDECLARED_LAYOUT } from './layoutSummary';
import { workflowDemo } from './workflowDemo';

describe('樓層單位摘要 as a layout declaration', () => {
  it('reads one floor per line, lowest first, with stable ids', () => {
    const layout = parseLayoutSummary('bldg-new', '1 樓：1樓 A室、1樓 B室\n2 樓：2樓 A室, 2樓 B室，2樓 C室');
    if ('error' in layout) throw new Error(layout.error);
    expect(layout.floors.map(f => [f.id, f.level, f.label])).toEqual([['bldg-new-f1', 1, '1 樓'], ['bldg-new-f2', 2, '2 樓']]);
    expect(layout.units.map(u => [u.id, u.floorId, u.label])).toEqual([
      ['bldg-new-f1-u1', 'bldg-new-f1', '1樓 A室'], ['bldg-new-f1-u2', 'bldg-new-f1', '1樓 B室'],
      ['bldg-new-f2-u1', 'bldg-new-f2', '2樓 A室'], ['bldg-new-f2-u2', 'bldg-new-f2', '2樓 B室'], ['bldg-new-f2-u3', 'bldg-new-f2', '2樓 C室'],
    ]);
  });
  it('reads back exactly what the export writes', () => {
    const building = workflowDemo.buildings.find(b => b.layoutDeclared)!;
    const layout = parseLayoutSummary(building.id, layoutSummary(workflowDemo, building.id));
    if ('error' in layout) throw new Error(layout.error);
    expect(layout.floors.map(f => f.label)).toEqual(workflowDemo.floors.filter(f => f.buildingId === building.id).map(f => f.label));
    expect(layout.units.map(u => u.label)).toEqual(workflowDemo.units.filter(u => u.buildingId === building.id).map(u => u.label));
  });
  it('accepts floors without a number, basements and a floor with no units yet', () => {
    const layout = parseLayoutSummary('b', 'B1：地庫\n地下：舖位\n1/F：\n2/F：2/F A');
    if ('error' in layout) throw new Error(layout.error);
    expect(layout.floors).toHaveLength(4);
    expect(layout.units).toHaveLength(3);
  });
  it.each([
    ['1 樓 1樓 A室', '缺少冒號'],
    ['1 樓：A\n1 樓：B', '重複'],
    ['1 樓：A、A', '重複'],
    ['3 樓：A\n2 樓：A\n1 樓：A', '由最低一層開始'],
    ['：A', '未寫樓層名稱'],
  ])('rejects %j instead of guessing', (text, message) => {
    const layout = parseLayoutSummary('b', text);
    expect('error' in layout && layout.error).toContain(message);
  });
  it('treats blank and the export placeholder as no declaration', () => {
    expect(isUndeclaredLayout('')).toBe(true);
    expect(isUndeclaredLayout(` ${UNDECLARED_LAYOUT} `)).toBe(true);
    expect(isUndeclaredLayout('1 樓：A')).toBe(false);
  });
});
