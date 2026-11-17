import { readShelfCode } from './shelf-code-reading';

describe('readShelfCode', () => {
  it.each([
    ['A-01-01', { kind: 'exact', code: 'A-01-01', column: 'A', rackNumber: 1, bin: '01' }],
    ['Z-01-105', { kind: 'exact', code: 'Z-01-105', column: 'Z', rackNumber: 1, bin: '105' }],
    ['AA-12-09', { kind: 'exact', code: 'AA-12-09', column: 'AA', rackNumber: 12, bin: '09' }],
  ])('바른 꼴 %s 는 그대로다', (raw, expected) => {
    expect(readShelfCode(raw)).toEqual(expected);
  });

  it.each([
    ['CC-4-1', 'CC-04-01', 'CC', 4, '01'],
    ['DD-10-1', 'DD-10-01', 'DD', 10, '01'],
  ])('0 빠진 %s 는 %s 로 고쳐 읽는다', (raw, code, column, rackNumber, bin) => {
    expect(readShelfCode(raw)).toEqual({ kind: 'fixed', code, column, rackNumber, bin, rule: 'zero-pad' });
  });

  it('대시 자리가 밀린 O21-30- 은 O-21-30 으로 고쳐 읽는다', () => {
    expect(readShelfCode('O21-30-')).toEqual({
      kind: 'fixed',
      code: 'O-21-30',
      column: 'O',
      rackNumber: 21,
      bin: '30',
      rule: 'dash-position',
    });
  });

  it('랙 뒤 한글 이름은 커스텀 칸이다', () => {
    expect(readShelfCode('M-07-꼭대기')).toEqual({
      kind: 'custom-bin',
      code: 'M-07-꼭대기',
      column: 'M',
      rackNumber: 7,
      bin: '꼭대기',
    });
  });

  it.each(['N-맨뒤', 'P-02--35', 'C-1F-F28', 'D-1006', 'P-1-39 뒤', '외부창고', 'A064GQ$'])(
    '어디에도 안 맞는 %s 는 예외다',
    (raw) => {
      expect(readShelfCode(raw)).toEqual({ kind: 'exception', raw });
    },
  );

  it('바른 결과를 다시 읽어도 같다 (멱등)', () => {
    expect(readShelfCode('Z-01-105')).toEqual(readShelfCode('Z-01-105'));
    expect(readShelfCode('M-07-꼭대기').kind).toBe('custom-bin');
  });

  it('고친 코드를 다시 읽으면 바른 꼴이다', () => {
    for (const raw of ['CC-4-1', 'O21-30-']) {
      const fixed = readShelfCode(raw);
      if (fixed.kind !== 'fixed') throw new Error(`fixed 여야 한다: ${raw}`);
      expect(readShelfCode(fixed.code)).toMatchObject({ kind: 'exact', code: fixed.code });
    }
  });
});
