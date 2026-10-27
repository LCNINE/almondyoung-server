import { CustomerReturnSettlementRetryCron } from './customer-return-settlement-retry.cron';

describe('CustomerReturnSettlementRetryCron', () => {
  it('지금 시각으로 재발행을 부른다', async () => {
    const service = { reissueStalled: jest.fn().mockResolvedValue(2) };
    const cron = new CustomerReturnSettlementRetryCron(service as never);
    const before = Date.now();

    expect(await cron.runOnce()).toBe('ran');

    expect(service.reissueStalled).toHaveBeenCalledTimes(1);
    const [now] = service.reissueStalled.mock.calls[0] as [Date];
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release: () => void = () => undefined;
    const service = {
      reissueStalled: jest.fn(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(0);
          }),
      ),
    };
    const cron = new CustomerReturnSettlementRetryCron(service as never);
    const first = cron.runOnce();
    expect(await cron.runOnce()).toBe('skipped');
    release();
    expect(await first).toBe('ran');
  });

  it('실패는 로그만 남기고 failed 를 낸다', async () => {
    const service = { reissueStalled: jest.fn().mockRejectedValue(new Error('db down')) };
    const cron = new CustomerReturnSettlementRetryCron(service as never);
    expect(await cron.runOnce()).toBe('failed');
    expect(await cron.runOnce()).toBe('failed'); // 플래그가 풀렸다
  });
});
