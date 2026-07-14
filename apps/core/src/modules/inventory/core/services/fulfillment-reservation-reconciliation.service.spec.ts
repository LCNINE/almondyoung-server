import {
  FulfillmentReservationReconciliationService,
  ZombieReservationReport,
} from './fulfillment-reservation-reconciliation.service';

function makeReport(over: Partial<ZombieReservationReport>): ZombieReservationReport {
  return { checkedAt: new Date(), totalZombieReservations: 0, totalZombieFos: 0, rows: [], ...over };
}

describe('FulfillmentReservationReconciliationService', () => {
  function build() {
    // db.run(fn) 은 fn(fakeTrx) 을 그대로 실행 (tx 인자 무시)
    const dbService = { run: jest.fn((fn: (trx: unknown) => unknown) => fn({})) } as never;
    const releaseLeftoverReservations = jest.fn().mockResolvedValue(1);
    const reservationLifecycle = { releaseLeftoverReservations } as never;
    const setZombieReservations = jest.fn();
    const incZombieReservationsHealed = jest.fn();
    const metrics = { setZombieReservations, incZombieReservationsHealed } as never;
    const svc = new FulfillmentReservationReconciliationService(dbService, reservationLifecycle, metrics);
    return { svc, releaseLeftoverReservations, setZombieReservations, incZombieReservationsHealed };
  }

  it('reconcileAndHeal 은 FO 단위로 그룹하여 FO 마다 한 번 heal 하고 카운트를 합산한다', async () => {
    const { svc, releaseLeftoverReservations } = build();
    jest.spyOn(svc, 'detectZombieReservations').mockResolvedValue(
      makeReport({
        totalZombieReservations: 3,
        totalZombieFos: 2,
        rows: [
          { reservationId: 'r1', foId: 'fo-A', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 2 },
          { reservationId: 'r2', foId: 'fo-A', foStatus: 'shipped', skuId: 's2', warehouseId: 'w1', quantity: 1 },
          { reservationId: 'r3', foId: 'fo-B', foStatus: 'canceled', skuId: 's1', warehouseId: 'w1', quantity: 4 },
        ],
      }),
    );
    releaseLeftoverReservations.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    const result = await svc.reconcileAndHeal();

    expect(releaseLeftoverReservations).toHaveBeenCalledTimes(2); // fo-A, fo-B — 한 번씩
    expect(releaseLeftoverReservations).toHaveBeenCalledWith('fo-A', 'reconcile: terminal FO leftover', {});
    expect(result.healedFos).toBe(2);
    expect(result.healedReservations).toBe(3);
  });

  it('한 FO heal 이 실패해도 나머지 FO 는 계속 처리한다', async () => {
    const { svc, releaseLeftoverReservations } = build();
    jest.spyOn(svc, 'detectZombieReservations').mockResolvedValue(
      makeReport({
        totalZombieReservations: 2,
        totalZombieFos: 2,
        rows: [
          { reservationId: 'r1', foId: 'fo-A', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 1 },
          { reservationId: 'r2', foId: 'fo-B', foStatus: 'shipped', skuId: 's1', warehouseId: 'w1', quantity: 1 },
        ],
      }),
    );
    releaseLeftoverReservations.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);

    const result = await svc.reconcileAndHeal();

    expect(releaseLeftoverReservations).toHaveBeenCalledTimes(2);
    expect(result.healedFos).toBe(1);
    expect(result.healedReservations).toBe(1);
  });

  it('scheduledReconcile 은 탐지 수를 게이지에 set, heal 수를 counter 에 inc 한다', async () => {
    const { svc, setZombieReservations, incZombieReservationsHealed } = build();
    jest.spyOn(svc, 'reconcileAndHeal').mockResolvedValue({
      checkedAt: new Date(),
      healedFos: 1,
      healedReservations: 3,
      report: makeReport({ totalZombieReservations: 3, totalZombieFos: 1 }),
    });
    await svc.scheduledReconcile();
    expect(setZombieReservations).toHaveBeenCalledWith(3);
    expect(incZombieReservationsHealed).toHaveBeenCalledWith(3);
  });

  it('scheduledReconcile 은 예외를 크론 밖으로 전파하지 않는다', async () => {
    const { svc, setZombieReservations } = build();
    jest.spyOn(svc, 'reconcileAndHeal').mockRejectedValue(new Error('boom'));
    await expect(svc.scheduledReconcile()).resolves.toBeUndefined();
    expect(setZombieReservations).not.toHaveBeenCalled();
  });
});
