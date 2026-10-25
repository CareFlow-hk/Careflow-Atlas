import { describe, expect, it } from 'vitest';
import { buildingsNamedIn, namedBuilding } from './buildingMentions';

const BUILDINGS = [
  { id: 'bldg-yu-an', name: '裕安樓' },
  { id: 'bldg-wing-hong', name: '永康大廈' },
  { id: 'bldg-yu-an-2', name: '裕安樓二期' },
];

describe('a building named in what the person typed', () => {
  it('is found by its name, with or without the surrounding words', () => {
    expect(namedBuilding(BUILDINGS, '在裕安樓').building).toEqual({ id: 'bldg-yu-an', name: '裕安樓' });
    expect(namedBuilding(BUILDINGS, '呢份表全部係永康大廈嘅').building?.id).toBe('bldg-wing-hong');
  });

  it('is not a different building because someone typed a space', () => {
    expect(namedBuilding(BUILDINGS, '裕 安 樓').building?.id).toBe('bldg-yu-an');
  });

  it('takes the longer name when one name sits inside another', () => {
    expect(namedBuilding(BUILDINGS, '裕安樓二期').building?.id).toBe('bldg-yu-an-2');
  });

  it('says nothing when the text names two buildings', () => {
    const found = namedBuilding(BUILDINGS, '裕安樓同永康大廈都要探');
    expect(found.building).toBeUndefined();
    expect(found.names).toEqual(['裕安樓', '永康大廈']);
  });

  it('says nothing when no building is named, including when the text is empty', () => {
    expect(buildingsNamedIn(BUILDINGS, '呢份表係上個月嘅')).toEqual([]);
    expect(buildingsNamedIn(BUILDINGS, '   ')).toEqual([]);
  });

  it('never invents one: a name the workspace does not have is not a match', () => {
    expect(buildingsNamedIn([{ id: 'bldg-yu-an', name: '裕安樓' }], '在福星大廈')).toEqual([]);
  });
});
