import { RevenueReportService } from './revenue-report.service';
import { externalRevenueHistory, externalRevenueMonthly } from '../../../schema';

it('이전 값과 교체 값을 같은 트랜잭션에서 보존하며 옛 양식의 확인 상태를 초기화한다', async () => {
  const row = {
    channel: 'cafe24',
    account: '테스트몰',
    month: '2026-01',
    basis: 'operational_net',
    amount: 100,
    source: '검토자료',
  };
  const before = { ...row, amount: 90, originalStatus: 'confirmed' };
  const audit = jest.fn().mockResolvedValue(undefined);
  const upsert = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate: upsert });
  const tx = {
    execute: jest.fn().mockResolvedValue(undefined),
    select: () => ({ from: async () => [before, { ...before, month: '2026-02' }] }),
    insert: (table: unknown) =>
      table === externalRevenueHistory ? { values: audit } : table === externalRevenueMonthly ? { values } : undefined,
  };
  const transaction = jest.fn(async (fn) => fn(tx));
  const service = new RevenueReportService({ db: { transaction } } as never);
  await service.import([row], 'operator');
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(tx.execute).toHaveBeenCalledTimes(1);
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      before: [before],
      recordedBy: 'operator',
      after: [expect.objectContaining({ amount: 100, originalStatus: 'pending' })],
    }),
  );
  expect(upsert).toHaveBeenCalledTimes(1);
});
