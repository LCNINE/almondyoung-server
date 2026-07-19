import { InvoiceOutcomeHandler } from './invoice-outcome.handler';

// 취소/만료된 계약의 in-flight 정산 성공(VoidInvoice 가 ATTEMPTING 을 못 막는 창)이
// 자격 연장/ACTIVE 발행으로 이어지지 않는지 못 박는다.

function makeHandler(opts: {
  contract: Record<string, unknown> | null;
  markerInserted?: boolean;
  entitlement?: Record<string, unknown> | null;
}) {
  const selectResults: unknown[][] = [];
  if (opts.contract !== undefined) selectResults.push(opts.contract ? [opts.contract] : []);

  const updates: Record<string, unknown>[] = [];
  const batchInserts: Record<string, unknown>[] = [];

  const tx = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => Promise.resolve(selectResults.shift() ?? [])),
    for: jest.fn().mockImplementation(() => Promise.resolve(opts.entitlement ? [opts.entitlement] : [])),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
      updates.push(v);
      return tx;
    }),
    insert: jest.fn().mockImplementation(() => ({
      values: (v: Record<string, unknown>) => {
        batchInserts.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(opts.markerInserted === false ? [] : [{ id: 'be-1' }]),
          }),
          returning: () => Promise.resolve([{ id: 'batch-1' }]),
          then: (resolve: (v: unknown) => unknown) => resolve(undefined),
        };
      },
    })),
  };
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const publisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };
  const handler = new InvoiceOutcomeHandler({ db } as never, contractEventManager as never, publisher as never);
  return { handler, tx, updates, contractEventManager, publisher };
}

const activeContract = { userId: 'u1', status: 'ACTIVE', autoRenewal: true, billingPath: 'INVOICE' };
const entitlement = {
  id: 'e1',
  userId: 'u1',
  tierId: 't1',
  startsAt: '2026-07-08',
  endsAt: '2026-07-08',
  pausedAt: null,
};

describe('InvoiceOutcomeHandler.handlePaid', () => {
  it('활성 계약 — 자격 보장연장 + nextBillingDate 전진 + ACTIVE 발행', async () => {
    const { handler, updates, publisher } = makeHandler({ contract: activeContract, entitlement });

    await handler.handlePaid('c1', 'inv-1', '2026-08-07', 9900, 'intent-1');

    const contractUpdate = updates.find((u) => 'nextBillingDate' in u);
    expect(contractUpdate?.nextBillingDate).toBe('2026-08-07');
    expect(contractUpdate?.lastPaymentIntentId).toBe('intent-1');
    expect(publisher.publishStatusChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
  });

  it('취소된 계약 — 기록만 남기고 자격 연장/계약 갱신/ACTIVE 발행 없음', async () => {
    const { handler, updates, contractEventManager, publisher } = makeHandler({
      contract: { ...activeContract, status: 'CANCELLED' },
      entitlement,
    });

    await handler.handlePaid('c1', 'inv-1', '2026-08-07', 9900, 'intent-1');

    expect(updates).toHaveLength(0);
    expect(contractEventManager.addEvent).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      'BILLING_SUCCESS_AFTER_TERMINATION',
      expect.objectContaining({ invoiceId: 'inv-1' }),
      'SYSTEM',
      'u1',
    );
    expect(publisher.publishStatusChanged).not.toHaveBeenCalled();
  });

  it('정기해지 예약(autoRenewal=false) 계약 — 자격은 연장하되 nextBillingDate 는 되살리지 않음', async () => {
    const { handler, updates, publisher } = makeHandler({
      contract: { ...activeContract, autoRenewal: false },
      entitlement,
    });

    await handler.handlePaid('c1', 'inv-1', '2026-08-07', 9900, 'intent-1');

    const contractUpdate = updates.find((u) => 'isPastDue' in u);
    expect(contractUpdate).toBeDefined();
    expect(contractUpdate && 'nextBillingDate' in contractUpdate).toBe(false);
    expect(publisher.publishStatusChanged).toHaveBeenCalled();
  });

  it('CHARGE 경로 계약에 온 invoice.paid 는 무시', async () => {
    const { handler, updates, publisher } = makeHandler({
      contract: { ...activeContract, billingPath: 'CHARGE' },
      entitlement,
    });

    await handler.handlePaid('c1', 'inv-1', '2026-08-07', 9900, 'intent-1');

    expect(updates).toHaveLength(0);
    expect(publisher.publishStatusChanged).not.toHaveBeenCalled();
  });

  it('멱등 마커 충돌(재전달) — no-op', async () => {
    const { handler, updates, publisher } = makeHandler({
      contract: activeContract,
      entitlement,
      markerInserted: false,
    });

    await handler.handlePaid('c1', 'inv-1', '2026-08-07', 9900, 'intent-1');

    expect(updates).toHaveLength(0);
    expect(publisher.publishStatusChanged).not.toHaveBeenCalled();
  });
});
