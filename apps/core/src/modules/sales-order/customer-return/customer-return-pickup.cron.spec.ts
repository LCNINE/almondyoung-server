import { Logger } from '@nestjs/common';
import { CustomerReturnPickupCron } from './customer-return-pickup.cron';

describe('CustomerReturnPickupCron', () => {
  afterEach(() => jest.restoreAllMocks());

  it('지금 시각으로 dispatchDue 를 한 번 부른다', async () => {
    const manager = { dispatchDue: jest.fn().mockResolvedValue({ sent: 1, cancelled: 0 }) };
    const cron = new CustomerReturnPickupCron(manager as never);
    const before = Date.now();

    expect(await cron.runOnce()).toBe('ran');

    expect(manager.dispatchDue).toHaveBeenCalledTimes(1);
    const [now] = manager.dispatchDue.mock.calls[0] as [Date];
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release: () => void = () => undefined;
    const manager = {
      dispatchDue: jest.fn(
        () =>
          new Promise<{ sent: number; cancelled: number }>((resolve) => {
            release = () => resolve({ sent: 0, cancelled: 0 });
          }),
      ),
    };
    const cron = new CustomerReturnPickupCron(manager as never);
    const first = cron.runOnce();
    expect(await cron.runOnce()).toBe('skipped');
    release();
    expect(await first).toBe('ran');
    expect(manager.dispatchDue).toHaveBeenCalledTimes(1);
  });

  it('실패는 로그만 남기고 failed 를 낸다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const manager = { dispatchDue: jest.fn().mockRejectedValue(new Error('db down')) };
    const cron = new CustomerReturnPickupCron(manager as never);
    expect(await cron.runOnce()).toBe('failed');
    expect(await cron.runOnce()).toBe('failed'); // 플래그가 풀렸다
  });
});
