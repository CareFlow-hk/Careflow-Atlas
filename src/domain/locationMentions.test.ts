import { describe, expect, it } from 'vitest';
import { mentionedPlace, mentionedPlaces } from './locationMentions';

const BUILDINGS = [
  { id: 'bldg-yu-an', name: '裕安樓' },
  { id: 'bldg-yu-an-2', name: '裕安樓二期' },
  { id: 'bldg-wing-hong', name: '永康大廈' },
];

describe('reading a place out of what the person typed', () => {
  it('takes the building and the one floor/unit the note names', () => {
    expect(mentionedPlace(BUILDINGS, '在裕安樓5樓B室增加以下記錄')).toEqual({
      building: { id: 'bldg-yu-an', name: '裕安樓' },
      place: { floorLabel: '5樓', unitLabel: 'B室' },
    });
  });

  it('reads the paper spellings, with or without spaces', () => {
    expect(mentionedPlaces('裕安樓 5/F B 室')).toEqual([{ floorLabel: '5樓', unitLabel: 'B室' }]);
    expect(mentionedPlaces('裕安樓 5 樓 B1 室')).toEqual([{ floorLabel: '5樓', unitLabel: 'B1室' }]);
  });

  it('reads a spoken floor number, because the person still wrote it', () => {
    expect(mentionedPlaces('裕安樓五樓B室')).toEqual([{ floorLabel: '5樓', unitLabel: 'B室' }]);
    expect(mentionedPlaces('裕安樓十五樓A室')).toEqual([{ floorLabel: '15樓', unitLabel: 'A室' }]);
    expect(mentionedPlaces('裕安樓二十樓C室')).toEqual([{ floorLabel: '20樓', unitLabel: 'C室' }]);
  });

  it('does not take a date for a place', () => {
    expect(mentionedPlaces('裕安樓 2026/10/05 到訪')).toEqual([]);
    expect(mentionedPlaces('裕安樓 10月5日到訪')).toEqual([]);
  });

  it('needs both a floor and a unit', () => {
    expect(mentionedPlaces('裕安樓5樓')).toEqual([]);
    expect(mentionedPlaces('裕安樓B室')).toEqual([]);
  });

  it('takes the longer building name when one sits inside another', () => {
    expect(mentionedPlace(BUILDINGS, '在裕安樓二期5樓B室').building?.id).toBe('bldg-yu-an-2');
  });

  it('names a building without inventing a place', () => {
    expect(mentionedPlace(BUILDINGS, '在裕安樓增加以下記錄')).toEqual({ building: { id: 'bldg-yu-an', name: '裕安樓' } });
  });

  it('does not pick a place when the note names more than one', () => {
    const found = mentionedPlace(BUILDINGS, '裕安樓5樓A室及6樓B室都要記錄');
    expect(found.place).toBeUndefined();
    expect(found.ambiguousPlaces).toEqual(['5樓 A室', '6樓 B室']);
  });

  it('does not attach a place to a building the note never names', () => {
    expect(mentionedPlace(BUILDINGS, '5樓 B室')).toEqual({});
  });

  it('does not pick a building when the note names two', () => {
    expect(mentionedPlace(BUILDINGS, '裕安樓同永康大廈5樓B室')).toEqual({});
  });
});
