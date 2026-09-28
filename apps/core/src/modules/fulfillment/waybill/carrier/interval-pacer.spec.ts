import { IntervalPacer } from './interval-pacer';

describe('IntervalPacer', () => {
  const fakeClock = () => {
    let now = 1_000;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: (ms: number) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
      advance: (ms: number) => (now += ms),
      sleeps,
    };
  };

  it('첫 호출은 기다리지 않는다', async () => {
    const clock = fakeClock();
    await new IntervalPacer(200, clock.now, clock.sleep).acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it('연달아 부르면 간격만큼 벌려 준다', async () => {
    const clock = fakeClock();
    const pacer = new IntervalPacer(200, clock.now, clock.sleep);
    await pacer.acquire();
    await pacer.acquire();
    await pacer.acquire();
    expect(clock.sleeps).toEqual([200, 200]);
  });

  it('간격이 이미 지났으면 기다리지 않는다', async () => {
    const clock = fakeClock();
    const pacer = new IntervalPacer(200, clock.now, clock.sleep);
    await pacer.acquire();
    clock.advance(500);
    await pacer.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  // 동시 호출자가 같은 슬롯을 받으면 순간 TPS 가 호출자 수만큼 뛴다 — 슬롯 예약은 await 전에 끝나야 한다.
  it('동시에 부른 호출자들은 서로 다른 슬롯을 받는다', async () => {
    const clock = fakeClock();
    const waits: number[] = [];
    const pacer = new IntervalPacer(200, clock.now, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire()]);
    expect(waits).toEqual([200, 400]);
  });
});
