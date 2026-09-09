import { Logger } from '@nestjs/common';
import { CronRunClaimer } from './cron-run.claimer';
import { CronOnceRunner } from './cron-once.runner';

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
    await new CronOnceRunner(claimer).wrap(META, body, NOW)();
    expect(claim).toHaveBeenCalledWith('probe', PERIOD);
    expect(body).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith('probe', PERIOD, 'ok');
  });

  it('선점 못 하면 본문을 돌리지 않고 debug 로그만 남긴다', async () => {
    const { claimer, finish } = makeClaimer(false);
    const body = jest.fn(() => Promise.resolve(undefined));
    await new CronOnceRunner(claimer).wrap(META, body, NOW)();
    expect(body).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
  });

  it('본문이 throw 하면 error 로 마감하고 error 로그를 남기되 reject 하지 않는다', async () => {
    const { claimer, finish } = makeClaimer(true);
    const body = jest.fn(() => {
      throw new Error('boom');
    });
    await expect(new CronOnceRunner(claimer).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(finish).toHaveBeenCalledWith('probe', PERIOD, 'error');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('선점 쿼리가 실패하면 건너뛰고 error 로그 (fail closed) — 원인이 메시지에 남는다', async () => {
    const { claimer } = makeClaimer(new Error('db down'));
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(body).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
    // nestjs-pino 를 거치면 두 번째 인자(error 객체)가 사라지므로 원인은 메시지 문자열 안에 있어야 한다.
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('timeZone 이 있으면 주기 키에 반영한다', async () => {
    const { claimer, claim } = makeClaimer(true);
    const seoul = { expression: '0 4 * * *', name: 'nightly', timeZone: 'Asia/Seoul' };
    await new CronOnceRunner(claimer).wrap(
      seoul,
      () => Promise.resolve(undefined),
      () => new Date('2026-09-10T19:00:00.200Z'),
    )();
    expect(claim).toHaveBeenCalledWith('nightly', new Date('2026-09-10T19:00:00.000Z'));
  });

  it('finish 가 실패하면 error 로그를 남기되 reject 하지 않는다 — 원인이 메시지에 남는다', async () => {
    const { claimer } = makeClaimer(true, new Error('finish down'));
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer).wrap(META, body, NOW)()).resolves.toBeUndefined();
    expect(body).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('probe'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('finish down'));
  });

  it('잘못된 크론식은 콜백을 reject 시키지 않는다 — 원인이 메시지에 남는다', async () => {
    const { claimer, claim } = makeClaimer(true);
    const broken = { expression: 'not a cron', name: 'broken' };
    const body = jest.fn(() => Promise.resolve(undefined));
    await expect(new CronOnceRunner(claimer).wrap(broken, body, NOW)()).resolves.toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('broken'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid characters'));
  });
});
