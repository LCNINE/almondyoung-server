import { LedgerReconciliationService, LedgerReconciliationReport } from './ledger-reconciliation.service';

function makeReport(over: Partial<LedgerReconciliationReport>): LedgerReconciliationReport {
  return { checkedAt: new Date(), totalDriftGrains: 0, criticalCount: 0, drifts: [], ...over };
}

describe('LedgerReconciliationService.scheduledReconcile', () => {
  function build() {
    const setLedgerDrift = jest.fn();
    const metrics = { setLedgerDrift } as never;
    const svc = new LedgerReconciliationService({} as never, metrics);
    return { svc, setLedgerDrift };
  }

  it('drift 발견 시 severity 별 카운트를 메트릭에 기록한다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(
      makeReport({
        totalDriftGrains: 3,
        criticalCount: 1,
        drifts: [
          {
            skuId: 's',
            warehouseId: 'w',
            locationId: 'l',
            stockState: 'ON_HAND',
            derivedQty: -1,
            ledgerQty: 0,
            delta: 1,
            severity: 'CRITICAL',
          },
          {
            skuId: 's',
            warehouseId: 'w',
            locationId: 'l',
            stockState: 'ON_HAND',
            derivedQty: 5,
            ledgerQty: 7,
            delta: 2,
            severity: 'MISMATCH',
          },
          {
            skuId: 's',
            warehouseId: 'w',
            locationId: 'l',
            stockState: 'ON_HAND',
            derivedQty: 5,
            ledgerQty: 8,
            delta: 3,
            severity: 'MISMATCH',
          },
        ],
      }),
    );
    await svc.scheduledReconcile();
    expect(setLedgerDrift).toHaveBeenCalledWith({ mismatch: 2, critical: 1 });
  });

  it('drift 0 이면 0 을 기록한다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(makeReport({}));
    await svc.scheduledReconcile();
    expect(setLedgerDrift).toHaveBeenCalledWith({ mismatch: 0, critical: 0 });
  });

  it('reconcile 예외가 크론 밖으로 전파되지 않는다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockRejectedValue(new Error('boom'));
    await expect(svc.scheduledReconcile()).resolves.toBeUndefined();
    expect(setLedgerDrift).not.toHaveBeenCalled();
  });
});
