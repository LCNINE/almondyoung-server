// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.job.spec.ts
import { OrderReconcileJob } from './order-reconcile.job';

describe('OrderReconcileJob', () => {
  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release: () => void = () => undefined;
    const runner = {
      runAll: jest.fn(
        () =>
          new Promise<never[]>((resolve) => {
            release = () => resolve([]);
          }),
      ),
    };
    const job = new OrderReconcileJob(runner as never);
    const first = job.runOnce();
    expect(await job.runOnce()).toBe('skipped');
    release();
    expect(await first).toBe('ran');
  });

  it('실패는 로그만 남기고 failed 를 낸다', async () => {
    const runner = { runAll: jest.fn().mockRejectedValue(new Error('db down')) };
    const job = new OrderReconcileJob(runner as never);
    expect(await job.runOnce()).toBe('failed');
    expect(await job.runOnce()).toBe('failed'); // 플래그가 풀렸다
  });
});
