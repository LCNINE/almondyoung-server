import { RevenueReportRepository } from './revenue-report.repository';
import { RevenueReportManager } from './revenue-report.manager';
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
    select: () => ({ from: () => ({ where: async () => [before] }) }),
    insert: (table: unknown) =>
      table === externalRevenueHistory ? { values: audit } : table === externalRevenueMonthly ? { values } : undefined,
  };
  const transaction = jest.fn(async (fn) => fn(tx));
  const service = new RevenueReportManager(new RevenueReportRepository({ run: transaction } as never));
  await service.import([row], 'operator');
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(tx.execute).toHaveBeenCalledTimes(3);
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      before: [before],
      recordedBy: 'operator',
      after: [expect.objectContaining({ amount: 100, originalStatus: 'pending' })],
    }),
  );
  expect(upsert).toHaveBeenCalledTimes(1);
});

const base = { channel: 'naver', account: '테스트', month: '2026-01', basis: 'paid', amount: 100, source: '검토자료' };
function fixture(existing: unknown[], replay?: unknown) {
  const where = jest.fn();
  if (replay !== undefined) where.mockResolvedValueOnce(replay);
  where.mockResolvedValue(existing);
  const insert = jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate: jest.fn() }) });
  const tx = { execute: jest.fn(), select: () => ({ from: () => ({ where }) }), insert };
  const manager = new RevenueReportManager(
    new RevenueReportRepository({ run: async (fn: (tx: unknown) => unknown) => fn(tx) } as never),
  );
  return { manager, insert };
}

it('미리보기 이후 변경된 자료와 뒤늦게 생긴 신규 키를 덮어쓰지 않는다', async () => {
  const existing = { ...base, updatedAt: new Date('2026-01-02T00:00:00Z') };
  const { manager, insert } = fixture([existing]);
  await expect(
    manager.import([{ ...base, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }], 'operator'),
  ).rejects.toThrow('다른 사용자');
  await expect(manager.import([{ ...base, expectedUpdatedAt: null }], 'operator')).rejects.toThrow('다른 사용자');
  expect(insert).not.toHaveBeenCalled();
});

it('성공한 동일 요청의 재시도는 이력과 금액을 다시 쓰지 않는다', async () => {
  const { manager, insert } = fixture([], [{ same: true, recordedBy: 'operator' }]);
  await expect(manager.import([base], 'operator', 'batch')).resolves.toEqual({ imported: 1, replayed: true });
  expect(insert).not.toHaveBeenCalled();
});

it('같은 요청 ID로 다른 내용이나 반영자가 재사용하는 것을 막는다', async () => {
  for (const previous of [
    { same: false, recordedBy: 'operator' },
    { same: true, recordedBy: 'other' },
  ]) {
    const { manager, insert } = fixture([], [previous]);
    await expect(manager.import([base], 'operator', 'batch')).rejects.toThrow('내용이 달라');
    expect(insert).not.toHaveBeenCalled();
  }
});

it('금액을 수정하면서 예전 확인 근거를 그대로 재사용하지 못한다', async () => {
  const { manager, insert } = fixture([{ ...base, amount: 90, reviewNote: '기존 근거' }]);
  await expect(
    manager.import([{ ...base, originalStatus: 'confirmed', reviewNote: '기존 근거' }], 'operator'),
  ).rejects.toThrow('새 확인 근거');
  expect(insert).not.toHaveBeenCalled();
});
