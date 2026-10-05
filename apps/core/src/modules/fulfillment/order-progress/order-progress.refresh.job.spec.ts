import { OrderProgressRefreshJob } from './order-progress.refresh.job';
import { OrderProgressManager } from './order-progress.manager';

describe('OrderProgressRefreshJob', () => {
  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const manager = { refresh: jest.fn(async () => { await gate; return { upserted: 1 }; }) };
    const job = new OrderProgressRefreshJob(manager as unknown as OrderProgressManager);

    const first = job.runOnce();
    await expect(job.runOnce()).resolves.toBe('skipped');
    release();
    await expect(first).resolves.toBe('ran');
    expect(manager.refresh).toHaveBeenCalledTimes(1);
  });

  it('실패해도 던지지 않고 다음 틱이 다시 돈다', async () => {
    const manager = { refresh: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ upserted: 0 }) };
    const job = new OrderProgressRefreshJob(manager as unknown as OrderProgressManager);
    await expect(job.runOnce()).resolves.toBe('failed');
    await expect(job.runOnce()).resolves.toBe('ran');
  });
});
