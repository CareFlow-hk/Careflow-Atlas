import { describe, expect, it } from 'vitest';
import { parseLocationText } from './locationText';
describe('deterministic floor and room notation', () => {
  it.each(['3F', '3/F', '3樓', '三樓'])('reads floor %s', text => {
    expect(parseLocationText(text)).toMatchObject({ ok: true, floor: '3樓', scope: 'FLOOR' });
  });
  it.each(['G/F', '地下'])('reads ground floor %s', text => expect(parseLocationText(text)).toMatchObject({ ok: true, floor: '地下' }));
  it('separates multi-unit scope from optional structure', () => {
    expect(parseLocationText('3F ABC')).toMatchObject({ ok: true, floor: '3樓', scope: 'FLOOR', structures: [{ unit: 'A' }, { unit: 'B' }, { unit: 'C' }] });
    expect(parseLocationText('2F A4')).toMatchObject({ ok: true, scope: 'FLOOR', structures: [{ unit: 'A', rooms: 4 }] });
    expect(parseLocationText('4F A3 B C')).toMatchObject({ ok: true, scope: 'FLOOR', structures: [{ unit: 'A', rooms: 3 }, { unit: 'B' }, { unit: 'C' }] });
    expect(parseLocationText('4F AB2')).toMatchObject({ ok: true, structures: [{ unit: 'A' }, { unit: 'B', rooms: 2 }] });
  });
  it.each(['A1', 'A-1', '2-A-1', '2A1', 'A室1號房', 'A(1)'])('reads room %s in a unit/address cell', text => {
    expect(parseLocationText(text, 'address', '2樓')).toMatchObject({ ok: true, floor: '2樓', unit: 'A1室', scope: 'UNIT' });
  });
  it('does not confuse a floor-cell count with an address room', () => {
    expect(parseLocationText('2F A4', 'address')).toMatchObject({ ok: true, unit: 'A4室', scope: 'UNIT' });
    expect(parseLocationText('2F A4')).toMatchObject({ ok: true, scope: 'FLOOR', structures: [{ unit: 'A', rooms: 4 }] });
  });
  it.each(['3FH', '後座', '6F–8F', '12-13F', '8F 2A1', 'A4', '3F A(1)(2)(3)'])('explains ambiguity in %s', text => {
    expect(parseLocationText(text)).toMatchObject({ ok: false, reason: expect.any(String) });
  });
  it('recognizes whole-building scope', () => expect(parseLocationText('全幢')).toEqual({ ok: true, scope: 'BUILDING', structures: [] }));
});
