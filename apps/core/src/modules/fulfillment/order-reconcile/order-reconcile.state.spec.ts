import {
  EffectivePrior,
  ReconcilePrior,
  chooseStep,
  effectivePrior,
  errorStep,
  nextRecord,
} from './order-reconcile.state';

const NOW = new Date('2026-10-08T00:00:00.000Z');
const plusMin = (m: number) => new Date(NOW.getTime() + m * 60_000);
const fresh: EffectivePrior = { attempts: 0, gaveUpAt: null, lastResult: null, lastError: null };
const prior = (over: Partial<ReconcilePrior> = {}): ReconcilePrior => ({
  fingerprint: 'fp',
  mode: 'act',
  attempts: 0,
  lastResult: 'acted',
  lastError: null,
  gaveUpAt: null,
  updatedAt: new Date('2026-10-08T00:00:00.000Z'),
  ...over,
});

describe('effectivePrior', () => {
  it('처음 보는 주문은 0 에서 시작한다', () => {
    expect(effectivePrior(null, 'fp', 'act')).toEqual(fresh);
  });

  it('지문이 바뀌면 횟수와 포기를 지운다 — 사람이 원인을 손봤다', () => {
    const eff = effectivePrior(prior({ fingerprint: 'old', attempts: 5, gaveUpAt: NOW }), 'new', 'act');
    expect(eff).toEqual(fresh);
  });

  it('모드가 바뀌면 횟수와 포기를 지운다 — 관찰 기간의 행이 곧장 포기로 가지 않게', () => {
    const eff = effectivePrior(prior({ mode: 'observe', attempts: 3 }), 'fp', 'act');
    expect(eff).toEqual(fresh);
  });

  it('같은 지문·모드면 이어간다', () => {
    const eff = effectivePrior(prior({ attempts: 2, lastResult: 'error', lastError: 'boom' }), 'fp', 'act');
    expect(eff).toEqual({ attempts: 2, gaveUpAt: null, lastResult: 'error', lastError: 'boom' });
  });
});

describe('chooseStep', () => {
  it('check 가 false 면 무엇이든 not_needed', () => {
    expect(chooseStep({ ...fresh, attempts: 5 }, 'act', false)).toBe('not_needed');
    expect(chooseStep(fresh, 'observe', false)).toBe('not_needed');
  });

  it('관찰 모드는 would_act 만 한다(포기 없음)', () => {
    expect(chooseStep({ ...fresh, attempts: 9 }, 'observe', true)).toBe('would_act');
  });

  it('다섯 번 시도 전에는 act', () => {
    for (const attempts of [0, 1, 2, 3, 4]) expect(chooseStep({ ...fresh, attempts }, 'act', true)).toBe('act');
  });

  it('다섯 번 시도 뒤 아직 할 일이 있으면 give_up', () => {
    expect(chooseStep({ ...fresh, attempts: 5 }, 'act', true)).toBe('give_up');
  });

  it('이미 포기한 주문은 1024분마다 다시 act 한다', () => {
    expect(chooseStep({ ...fresh, attempts: 5, gaveUpAt: NOW }, 'act', true)).toBe('act');
  });
});

describe('errorStep', () => {
  it('다섯 번 전의 예외는 act 로 센다', () => {
    for (const attempts of [0, 1, 2, 3, 4]) expect(errorStep({ ...fresh, attempts }, 'act')).toBe('act');
  });

  it('다섯 번 뒤의 예외는 give_up — fingerprint·check 가 늘 던져도 멈춘다', () => {
    expect(errorStep({ ...fresh, attempts: 5 }, 'act')).toBe('give_up');
  });

  it('이미 포기했으면 act(1024분마다 재시도의 실패)', () => {
    expect(errorStep({ ...fresh, attempts: 5, gaveUpAt: NOW }, 'act')).toBe('act');
  });

  it('관찰 모드는 포기하지 않는다', () => {
    expect(errorStep({ ...fresh, attempts: 9 }, 'observe')).toBe('act');
  });
});

describe('nextRecord', () => {
  const base = { fingerprint: 'fp', mode: 'act' as const };

  it.each([
    [0, 1],
    [1, 4],
    [2, 16],
    [3, 64],
    [4, 256],
  ])('시도 %i 회 뒤 acted → 간격 %i분, 횟수 +1', (attempts, delay) => {
    const rec = nextRecord({ ...fresh, attempts }, { ...base, step: 'act', outcome: 'acted' }, NOW);
    expect(rec).toEqual({
      ...base,
      attempts: attempts + 1,
      lastResult: 'acted',
      lastError: null,
      gaveUpAt: null,
      nextCheckAt: plusMin(delay),
    });
  });

  it('error 도 시도로 세고 오류를 1000자로 자른다', () => {
    const rec = nextRecord(fresh, { ...base, step: 'act', outcome: 'error', error: 'x'.repeat(1500) }, NOW);
    expect(rec.attempts).toBe(1);
    expect(rec.lastResult).toBe('error');
    expect(rec.lastError).toHaveLength(1000);
    expect(rec.nextCheckAt).toEqual(plusMin(1));
  });

  it('give_up 은 act 하지 않고 포기 시각을 찍고, 마지막 결과·오류는 그대로 둔다', () => {
    const eff = { attempts: 5, gaveUpAt: null, lastResult: 'error' as const, lastError: 'boom' };
    expect(nextRecord(eff, { ...base, step: 'give_up' }, NOW)).toEqual({
      ...base,
      attempts: 5,
      lastResult: 'error',
      lastError: 'boom',
      gaveUpAt: NOW,
      nextCheckAt: plusMin(1024),
    });
  });

  it('오류로 포기하면 마지막 결과·오류를 이번 오류로 남긴다(1000자)', () => {
    const eff = { attempts: 5, gaveUpAt: null, lastResult: 'error' as const, lastError: 'old' };
    expect(nextRecord(eff, { ...base, step: 'give_up', error: 'y'.repeat(1500) }, NOW)).toEqual({
      ...base,
      attempts: 5,
      lastResult: 'error',
      lastError: 'y'.repeat(1000),
      gaveUpAt: NOW,
      nextCheckAt: plusMin(1024),
    });
  });

  it('포기 뒤 act 는 횟수를 늘리지 않고 포기를 유지한 채 1024분 뒤', () => {
    const gaveUpAt = new Date('2026-10-01T00:00:00.000Z');
    const rec = nextRecord({ ...fresh, attempts: 5, gaveUpAt }, { ...base, step: 'act', outcome: 'acted' }, NOW);
    expect(rec).toMatchObject({ attempts: 5, gaveUpAt, lastResult: 'acted', nextCheckAt: plusMin(1024) });
  });

  it('not_needed·would_act 는 10분 뒤, 횟수·포기 유지', () => {
    const gaveUpAt = new Date('2026-10-01T00:00:00.000Z');
    const eff = { ...fresh, attempts: 5, gaveUpAt };
    expect(nextRecord(eff, { ...base, step: 'not_needed' }, NOW)).toMatchObject({
      attempts: 5,
      gaveUpAt,
      lastResult: 'not_needed',
      lastError: null,
      nextCheckAt: plusMin(10),
    });
    expect(nextRecord(fresh, { fingerprint: 'fp', mode: 'observe', step: 'would_act' }, NOW)).toMatchObject({
      attempts: 0,
      lastResult: 'would_act',
      nextCheckAt: plusMin(10),
    });
  });

  it('첫 시도부터 포기까지 341분(5시간 41분)', () => {
    let eff: EffectivePrior = fresh;
    let at = NOW;
    for (let i = 0; i < 5; i++) {
      const rec = nextRecord(eff, { ...base, step: 'act', outcome: 'acted' }, at);
      eff = { attempts: rec.attempts, gaveUpAt: rec.gaveUpAt, lastResult: rec.lastResult, lastError: rec.lastError };
      at = rec.nextCheckAt;
    }
    expect(chooseStep(eff, 'act', true)).toBe('give_up');
    expect((at.getTime() - NOW.getTime()) / 60_000).toBe(341);
  });
});
