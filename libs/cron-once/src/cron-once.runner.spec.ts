import { Logger } from '@nestjs/common';
import type { DatabaseRun, DbService } from '@app/db';
import { CronRunClaimer } from './cron-run.claimer';
import { CronOnceRunner } from './cron-once.runner';

/** `DbService.forEachDatabase` 만 흉내 낸다. `keys` 마다 `current` 를 그 키로 두고 돈다 — 라우터가 없는 앱은 `[undefined]`. */
const fanOut = (keys: (string | undefined)[] = [undefined]) => {
  const state = { current: undefined as string | undefined };
  const db = {
    forEachDatabase: async <T>(fn: (key: string | undefined) => Promise<T>): Promise<DatabaseRun<T>[]> => {
      const runs: DatabaseRun<T>[] = [];
      for (const key of keys) {
        state.current = key;
        try {
          runs.push({ key, ok: true, value: await fn(key) });
        } catch (error) {
          runs.push({ key, ok: false, error });
        }
      }
      return runs;
    },
  } as unknown as DbService;
  return { db, state };
};
const single = () => fanOut().db;

const makeClaimer = (claimResult: boolean | Error, finishResult?: void | Error) => {
  const claim = jest.fn(() => {
    if (claimResult instanceof Error) throw claimResult;
    return Promise.resolve(claimResult);
  });
  const finish = jest.fn(() => {
    if (finishResult instanceof Error) throw finishResult;
    return Promise.resolve(undefined);
  });
  return { claimer: { claim, finish, instanceId: 'task-a' } as unknown as CronRunClaimer, claim, finish };
};

const META = { expression: '*/10 * * * * *', name: 'probe' };
const NOW = () => new Date('2026-09-10T00:00:00.300Z');
const PERIOD = new Date('2026-09-10T00:00:00.000Z');

describe('CronOnceRunner.wrap', () => {
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('선점하면 본문을 돌리고 ok 로 마감한다', async () => {
    const { claimer, claim, finish } = makeClaimer(true);
    const body = jest.fn(() => Promise.resolve(undefined));
    await new CronOnceRunner(claimer, single()).wrap(META, body, NOW)();
    expect(claim).toHaveBeenCalledWith('probe', PERIOD);
    expect(body).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('probe', PERIOD, 'ok');
  });

  it('선점 못 하면 본문을 돌리지 않고 debug 로그만 남긴다', async () => {
    const { claimer, finish } = makeClaimer(false);
    const body = jest.fn(() => Promise.resolve(undefined));
    await new CronOnceRunner(claimer, single()).wrap(META, body, NOW)();
    expect(body).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
  });

  it('본문이 throw 하면 error 로 마감하고 error 로그를 남기되 reject 하지 않는다', async () => {
    const { claimer, finish } = makeClaimer(true);
    const body = jest.fn(() => {
      throw new Error('boom');
    });
    await expect(new CronOnceRunner(claimer, single()).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(finish).toHaveBeenCalledWith('probe', PERIOD, 'error');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('선점 쿼리가 실패하면 건너뛰고 error 로그 (fail closed) — 원인이 메시지에 남는다', async () => {
    const { claimer } = makeClaimer(new Error('db down'));
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer, single()).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(body).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
    // nestjs-pino 를 거치면 두 번째 인자(error 객체)가 사라지므로 원인은 메시지 문자열 안에 있어야 한다.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('timeZone 이 있으면 주기 키에 반영한다', async () => {
    const { claimer, claim } = makeClaimer(true);
    const seoul = { expression: '0 4 * * *', name: 'nightly', timeZone: 'Asia/Seoul' };
    await new CronOnceRunner(claimer, single()).wrap(
      seoul,
      () => Promise.resolve(undefined),
      () => new Date('2026-09-10T19:00:00.200Z'),
    )();
    expect(claim).toHaveBeenCalledWith('nightly', new Date('2026-09-10T19:00:00.000Z'));
  });

  it('finish 가 실패하면 error 로그를 남기되 reject 하지 않는다 — 원인이 메시지에 남는다', async () => {
    const { claimer } = makeClaimer(true, new Error('finish down'));
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer, single()).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(body).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('finish down'));
  });

  it('잘못된 크론식은 콜백을 reject 시키지 않는다 — 원인이 메시지에 남는다', async () => {
    const { claimer, claim } = makeClaimer(true);
    const broken = { expression: 'not a cron', name: 'broken' };
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer, single()).wrap(broken, body, NOW)()).resolves.toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('broken'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid characters'));
  });

  it('DB(테넌트)마다 선점·본문·마감을 따로 한다 — 한 DB 의 선점 실패가 다른 DB 의 본문을 막지 않는다', async () => {
    const { db, state } = fanOut(['1', '2']);
    const claimed: string[] = [];
    const ran: string[] = [];
    const finished: string[] = [];
    const claimer = {
      claim: jest.fn(() => {
        if (state.current === '1') throw new Error('tenant 1 DB 깨짐');
        claimed.push(String(state.current));
        return Promise.resolve(true);
      }),
      finish: jest.fn((_n: string, _p: Date, outcome: string) => {
        finished.push(`${state.current}:${outcome}`);
        return Promise.resolve(undefined);
      }),
      instanceId: 'task-a',
    } as unknown as CronRunClaimer;

    await expect(
      new CronOnceRunner(claimer, db).wrap(
        META,
        () => {
          ran.push(String(state.current));
          return Promise.resolve();
        },
        NOW,
      )(),
    ).resolves.toBeUndefined();

    expect(claimed).toEqual(['2']);
    expect(ran).toEqual(['2']);
    expect(finished).toEqual(['2:ok']);
    // 어느 테넌트의 실패인지 로그가 말한다
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[db=1]'));
  });
});

