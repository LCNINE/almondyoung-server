import {
  LedgerReconciliationService,
  LedgerReconciliationReport,
  ReservationDriftReport,
} from './ledger-reconciliation.service';

function makeReport(over: Partial<LedgerReconciliationReport>): LedgerReconciliationReport {
  return { checkedAt: new Date(), totalDriftGrains: 0, criticalCount: 0, drifts: [], ...over };
}

function makeReservationReport(over: Partial<ReservationDriftReport>): ReservationDriftReport {
  return { checkedAt: new Date(), totalDriftGrains: 0, drifts: [], ...over };
}

describe('LedgerReconciliationService.scheduledReconcile', () => {
  function build() {
    const setLedgerDrift = jest.fn();
    const setReservedOverOnHand = jest.fn();
    const metrics = { setLedgerDrift, setReservedOverOnHand } as never;
    const svc = new LedgerReconciliationService({} as never, metrics);
    jest.spyOn(svc, 'reconcileReservations').mockResolvedValue(makeReservationReport({}));
    return { svc, setLedgerDrift, setReservedOverOnHand };
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
    const { svc, setLedgerDrift, setReservedOverOnHand } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(makeReport({}));
    await svc.scheduledReconcile();
    expect(setLedgerDrift).toHaveBeenCalledWith({ mismatch: 0, critical: 0 });
    expect(setReservedOverOnHand).toHaveBeenCalledWith(0);
  });

  it('reconcile 예외가 크론 밖으로 전파되지 않는다', async () => {
    const { svc, setLedgerDrift } = build();
    jest.spyOn(svc, 'reconcile').mockRejectedValue(new Error('boom'));
    await expect(svc.scheduledReconcile()).resolves.toBeUndefined();
    expect(setLedgerDrift).not.toHaveBeenCalled();
  });

  it('예약 초과 grain 이 있으면 게이지에 기록한다 (ledger drift 유무 무관)', async () => {
    const { svc, setReservedOverOnHand } = build();
    jest.spyOn(svc, 'reconcile').mockResolvedValue(makeReport({}));
    jest.spyOn(svc, 'reconcileReservations').mockResolvedValue(
      makeReservationReport({
        totalDriftGrains: 1,
        drifts: [{ skuId: 's', warehouseId: 'w', onHandQty: 4, reservedQty: 10, shortfall: 6 }],
      }),
    );
    await svc.scheduledReconcile();
    expect(setReservedOverOnHand).toHaveBeenCalledWith(1);
  });
});
