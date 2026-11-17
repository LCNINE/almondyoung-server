import { autoBinIdentifier, isNumericBin, planRackBinSync, rackBinLocationCode } from './location-code';

describe('rackBinLocationCode', () => {
  it('열-랙(두 자리)-칸 꼴로 만든다', () => {
    expect(rackBinLocationCode('A', 1, '01')).toBe('A-01-01');
    expect(rackBinLocationCode('AA', 12, '09')).toBe('AA-12-09');
  });

  it('100 이상 칸은 세 자리 그대로다 (자석 꼴 Z-01-105)', () => {
    expect(rackBinLocationCode('Z', 1, autoBinIdentifier(105))).toBe('Z-01-105');
  });

  it('커스텀 칸 이름을 그대로 붙인다', () => {
    expect(rackBinLocationCode('M', 7, '꼭대기')).toBe('M-07-꼭대기');
  });
});

describe('autoBinIdentifier / isNumericBin', () => {
  it('최소 두 자리로 채운다', () => {
    expect(autoBinIdentifier(5)).toBe('05');
    expect(autoBinIdentifier(99)).toBe('99');
    expect(autoBinIdentifier(100)).toBe('100');
  });

  it('숫자뿐인 칸만 숫자 칸이다', () => {
    expect(isNumericBin('05')).toBe(true);
    expect(isNumericBin('105')).toBe(true);
    expect(isNumericBin('꼭대기')).toBe(false);
    expect(isNumericBin('1F')).toBe(false);
  });
});

describe('planRackBinSync', () => {
  it('가운데 빠진 칸과 늘어난 칸을 만든다', () => {
    expect(
      planRackBinSync({
        start: 1,
        end: 4,
        existing: [
          { id: 'a', binIdentifier: '01' },
          { id: 'c', binIdentifier: '03' },
        ],
      }),
    ).toEqual({ createBinIdentifiers: ['02', '04'], deleteCandidateIds: [] });
  });

  it('범위 밖 숫자 칸만 지울 후보이고 커스텀 칸은 무시한다', () => {
    expect(
      planRackBinSync({
        start: 1,
        end: 1,
        existing: [
          { id: 'a', binIdentifier: '01' },
          { id: 'b', binIdentifier: '02' },
          { id: 'x', binIdentifier: '꼭대기' },
        ],
      }),
    ).toEqual({ createBinIdentifiers: [], deleteCandidateIds: ['b'] });
  });

  it('같은 번호를 다른 자릿수로 쓴 칸이 있으면 새로 만들지 않는다', () => {
    expect(planRackBinSync({ start: 5, end: 5, existing: [{ id: 'k', binIdentifier: '5' }] })).toEqual({
      createBinIdentifiers: [],
      deleteCandidateIds: [],
    });
  });

  it('시작 번호를 올리면 그 아래 숫자 칸이 후보가 된다', () => {
    expect(
      planRackBinSync({
        start: 2,
        end: 2,
        existing: [
          { id: 'a', binIdentifier: '01' },
          { id: 'b', binIdentifier: '02' },
        ],
      }),
    ).toEqual({ createBinIdentifiers: [], deleteCandidateIds: ['a'] });
  });
});
