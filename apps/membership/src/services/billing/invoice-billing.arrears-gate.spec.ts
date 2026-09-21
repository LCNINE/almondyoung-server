import { InvoiceBillingManager } from './invoice-billing.manager';

/**
 * 미수가 남은 계정에는 자격을 «먼저» 주지 않는다. 청구는 그대로 나간다 —
 * 발행을 막으면 갚을 기회까지 사라져서 빚이 영영 회수되지 않는다.
 */
function makeManager(outstanding: number) {
  const entitlementRow = {
    id: 'e1',
    userId: 'u1',
    tierId: 't1',
    startsAt: '2026-07-07',
    endsAt: '2026-07-07',
    pausedAt: null,
  };
  const inserted: Record<string, unknown>[] = [];

  const tx = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    for: jest.fn().mockResolvedValue([entitlementRow]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return {
          returning: () => Promise.resolve([{ id: 'batch-1' }]),
          then: (resolve: (x: unknown) => unknown) => resolve(undefined),
        };
      },
    })),
  };
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const walletCommandPublisher = { publishCreateInvoice: jest.fn().mockResolvedValue(undefined) };
  const planService = {
    getPlanDetails: jest.fn().mockResolvedValue({
      plan: { id: 'p1', price: 4990, durationDays: 30, currency: 'KRW', isActive: true },
    }),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const arrearsManager = { outstandingTotal: jest.fn().mockResolvedValue(outstanding) };

  const manager = new InvoiceBillingManager(
    { db } as never,
    walletCommandPublisher as never,
    planService as never,
    contractEventManager as never,
    arrearsManager as never,
  );
  return { manager, walletCommandPublisher, contractEventManager, inserted, tx };
}

const contract = { id: 'c1', userId: 'u1', planId: 'p1', nextBillingDate: '2026-07-07' };

describe('선적용 미수 게이트', () => {
  it('미수가 없으면 종전대로 자격을 선연장한다', async () => {
    const { manager, contractEventManager, inserted } = makeManager(0);
    const result = await manager.issueInvoiceForContract(contract);

    expect(result.success).toBe(true);
    const types = contractEventManager.addEvent.mock.calls.map((c) => c[2]);
    expect(types).toContain('INVOICE_ADVANCE_GRANT');
    // 새 자격 행이 생겨야 한다(periodEnd 까지 연장)
    expect(inserted.some((v) => v.endsAt === '2026-08-06')).toBe(true);
  });

  it('미수가 있으면 선연장하지 않고 보류를 기록한다', async () => {
    const { manager, contractEventManager, inserted, tx } = makeManager(4990);
    await manager.issueInvoiceForContract(contract);

    const types = contractEventManager.addEvent.mock.calls.map((c) => c[2]);
    expect(types).toContain('INVOICE_ADVANCE_GRANT_WITHHELD');
    expect(types).not.toContain('INVOICE_ADVANCE_GRANT');
    // 자격 행을 새로 만들지도, 기존 자격을 닫지도 않는다
    expect(inserted.some((v) => 'endsAt' in v)).toBe(false);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('미수가 있어도 청구는 그대로 발행한다 — 갚을 길을 막지 않는다', async () => {
    const { manager, walletCommandPublisher } = makeManager(4990);
    const result = await manager.issueInvoiceForContract(contract);

    expect(result.success).toBe(true);
    expect(walletCommandPublisher.publishCreateInvoice).toHaveBeenCalledTimes(1);
  });
});
