import { computeChanges, detectConflicts, applyDecisions } from './bulk-session.diff';

describe('computeChanges', () => {
  it('값이 달라진 필드만 담는다', () => {
    expect(computeChanges({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual({ b: '3' });
  });

  it('값이 있었는데 빈칸이면 명시적 비움으로 담는다', () => {
    expect(computeChanges({ a: 'ACME' }, { a: '' })).toEqual({ a: '' });
  });

  it('원래도 빈칸이었으면 변경이 아니다', () => {
    expect(computeChanges({ a: '' }, { a: '' })).toEqual({});
  });

  it('업로드에 없는 키(열 삭제)는 아예 보지 않는다', () => {
    expect(computeChanges({ a: 'ACME', b: 'x' }, { a: 'ACME' })).toEqual({});
  });

  it('base 에 없던 키(신규 행 필드)는 값이 있으면 변경이다', () => {
    expect(computeChanges({}, { a: '1', b: '' })).toEqual({ a: '1' });
  });
});

describe('detectConflicts', () => {
  it('내가 A 를, 남이 B 를 바꿨으면 충돌이 아니다', () => {
    const base = { A: '1', B: '1' };
    const mine = { A: '2', B: '1' };
    const current = { A: '1', B: '9' };
    expect(detectConflicts(base, mine, current)).toEqual({});
  });

  it('내가 A 를, 남도 A 를 바꿨으면 충돌이다', () => {
    const conflicts = detectConflicts({ A: '1' }, { A: '2' }, { A: '3' });
    expect(conflicts).toEqual({ A: { base: '1', mine: '2', current: '3' } });
  });

  it('둘이 같은 값으로 바꿨으면 충돌이 아니다', () => {
    expect(detectConflicts({ A: '1' }, { A: '2' }, { A: '2' })).toEqual({});
  });

  it('내가 안 바꿨으면 남이 바꿨어도 충돌이 아니다 (포크가 남의 값을 이미 들고 있다)', () => {
    expect(detectConflicts({ A: '1' }, { A: '1' }, { A: '9' })).toEqual({});
  });

  it('업로드에 없는 키는 충돌 판정 대상이 아니다', () => {
    expect(detectConflicts({ A: '1' }, {}, { A: '9' })).toEqual({});
  });
});

describe('applyDecisions', () => {
  it('skip 인 필드는 적용분에서 빠진다', () => {
    expect(applyDecisions({ A: '2', B: '3' }, { A: 'skip' })).toEqual({ B: '3' });
  });

  it('결정이 없는 필드는 그대로 적용된다 (충돌이 아니었던 필드)', () => {
    expect(applyDecisions({ A: '2' }, {})).toEqual({ A: '2' });
  });
});
