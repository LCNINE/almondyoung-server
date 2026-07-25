import { parsePackingUnit, serializePackingUnit } from './packing-unit';

describe('parsePackingUnit', () => {
  it('숫자 문자열을 number 로 준다', () => {
    expect(parsePackingUnit('20')).toBe(20);
    expect(parsePackingUnit(' 6 ')).toBe(6);
  });

  it('값이 없으면 null', () => {
    expect(parsePackingUnit(null)).toBeNull();
    expect(parsePackingUnit(undefined)).toBeNull();
    expect(parsePackingUnit('')).toBeNull();
    expect(parsePackingUnit('   ')).toBeNull();
  });

  // 컬럼이 varchar(64) 라 손으로 아무 문자열이나 들어갈 수 있다. 소비자가
  // NaN 을 만나지 않도록 경계에서 null 로 떨군다.
  it('숫자가 아니거나 1 미만이면 null', () => {
    expect(parsePackingUnit('BOX')).toBeNull();
    expect(parsePackingUnit('20개입')).toBeNull();
    expect(parsePackingUnit('1.5')).toBeNull();
    expect(parsePackingUnit('-3')).toBeNull();
    expect(parsePackingUnit('0')).toBeNull();
  });
});

describe('serializePackingUnit', () => {
  it('number 를 문자열로 준다', () => {
    expect(serializePackingUnit(20)).toBe('20');
  });

  it('값이 없으면 null', () => {
    expect(serializePackingUnit(null)).toBeNull();
    expect(serializePackingUnit(undefined)).toBeNull();
  });
});
