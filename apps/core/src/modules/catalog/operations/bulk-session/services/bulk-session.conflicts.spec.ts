import { countUndecided, hasUndecided, isConflictFilter } from './bulk-session.conflicts';

const conflict = {
  name: { base: 'A', mine: 'B', current: 'C' },
  brand: { base: 'X', mine: 'Y', current: 'Z' },
};

describe('countUndecided', () => {
  it('결정이 없으면 충돌 필드 전부가 미결정이다', () => {
    expect(countUndecided(conflict, null)).toBe(2);
  });

  it('일부만 결정하면 나머지만 센다', () => {
    expect(countUndecided(conflict, { name: 'overwrite' })).toBe(1);
  });

  it('전부 결정하면 0 이다 — skip 도 결정이다', () => {
    expect(countUndecided(conflict, { name: 'overwrite', brand: 'skip' })).toBe(0);
  });

  it('충돌하지 않은 필드의 결정은 세지 않는다', () => {
    expect(countUndecided({ name: conflict.name }, { name: 'skip', ghost: 'overwrite' })).toBe(0);
  });

  it('충돌이 없으면 0 이다', () => {
    expect(countUndecided(null, null)).toBe(0);
    expect(countUndecided({}, null)).toBe(0);
  });

  it('형태가 깨진 jsonb 는 그 필드를 버린다', () => {
    expect(countUndecided({ name: 'not-an-object' }, null)).toBe(0);
  });

  it('overwrite/skip 이 아닌 결정 값은 결정으로 치지 않는다', () => {
    expect(countUndecided({ name: conflict.name }, { name: 'maybe' })).toBe(1);
  });
});

describe('hasUndecided', () => {
  it('하나라도 미결정이면 true', () => {
    expect(hasUndecided(conflict, { name: 'skip' })).toBe(true);
  });
  it('전부 결정이면 false', () => {
    expect(hasUndecided(conflict, { name: 'skip', brand: 'skip' })).toBe(false);
  });
});

describe('isConflictFilter', () => {
  it.each(['any', 'undecided'])('%s 를 받는다', (v) => {
    expect(isConflictFilter(v)).toBe(true);
  });
  it.each(['', 'ANY', 'decided', 'true'])('%s 는 거부한다', (v) => {
    expect(isConflictFilter(v)).toBe(false);
  });
});
