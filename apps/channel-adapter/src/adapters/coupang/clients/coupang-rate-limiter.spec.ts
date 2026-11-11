import { CoupangRateLimiter } from './coupang-rate-limiter';

function make() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const limiter = new CoupangRateLimiter({
    perSecond: 2,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  return { limiter, sleeps, advance: (ms: number) => (t += ms) };
}

describe('CoupangRateLimiter', () => {
  it('초당 2회를 넘는 세 번째 acquire 는 1초 창이 지날 때까지 기다린다', async () => {
    const { limiter, sleeps } = make();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
    await limiter.acquire();
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(900);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
  });

  it('recordRateLimited 뒤 60초 동안 acquire 가 기다린다', async () => {
    const { limiter, sleeps } = make();
    limiter.recordRateLimited();
    await limiter.acquire();
    expect(sleeps[0]).toBeGreaterThan(59_000);
    expect(sleeps[0]).toBeLessThanOrEqual(60_000);
  });

  it('5초 안에 recordError 8번이면 10분 멈춘다', async () => {
    const { limiter, sleeps } = make();
    for (let i = 0; i < 8; i++) limiter.recordError();
    await limiter.acquire();
    expect(sleeps[0]).toBeGreaterThan(599_000);
    expect(sleeps[0]).toBeLessThanOrEqual(600_000);
  });

  it('recordError 7번 뒤 recordSuccess 는 멈추지 않는다', async () => {
    const { limiter, sleeps } = make();
    for (let i = 0; i < 7; i++) limiter.recordError();
    limiter.recordSuccess();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
  });

  it('5초가 지난 에러는 세지 않는다', async () => {
    const { limiter, sleeps, advance } = make();
    for (let i = 0; i < 7; i++) limiter.recordError();
    advance(6000);
    limiter.recordError();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
  });

  it('429 도 에러 폭주에 센다 — 7번의 에러와 429 한 번이면 10분 멈춘다', async () => {
    const { limiter, sleeps } = make();
    for (let i = 0; i < 7; i++) limiter.recordError();
    limiter.recordRateLimited();
    await limiter.acquire();
    expect(sleeps[0]).toBeGreaterThan(599_000);
    expect(sleeps[0]).toBeLessThanOrEqual(600_000);
  });
});
