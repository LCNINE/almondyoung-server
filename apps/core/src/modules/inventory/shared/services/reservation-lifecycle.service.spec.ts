import { ReservationLifecycleService } from './reservation-lifecycle.service';
import type { UnifiedReservationService } from './unified-reservation.service';
import type { DbTx } from '../../schema/inventory.schema';

// tx.update(...).set(...).where(...) 체인을 흡수하는 최소 fake trx
const fakeTrx = {
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as DbTx;

describe('ReservationLifecycleService.releaseLeftoverReservations', () => {
  function build(confirmedRows: { id: string; skuId: string }[]) {
    const getReservationsByTarget = jest.fn().mockResolvedValue(confirmedRows);
    const releaseReservation = jest.fn().mockResolvedValue(undefined);
    const unified = { getReservationsByTarget, releaseReservation } as unknown as UnifiedReservationService;
    const svc = new ReservationLifecycleService({} as never, unified);
    return { svc, getReservationsByTarget, releaseReservation };
  }

  it('terminal FO 의 confirmed 예약을 전량 해제하고 해제 건수를 반환한다', async () => {
    const { svc, getReservationsByTarget, releaseReservation } = build([
      { id: 'r1', skuId: 's1' },
      { id: 'r2', skuId: 's1' },
    ]);

    const released = await svc.releaseLeftoverReservations('fo-1', 'reconcile: test', fakeTrx);

    expect(getReservationsByTarget).toHaveBeenCalledWith('FULFILLMENT_ORDER', 'fo-1', fakeTrx);
    expect(releaseReservation).toHaveBeenCalledTimes(2);
    expect(releaseReservation).toHaveBeenCalledWith('r1', fakeTrx);
    expect(released).toBe(2);
  });

  it('잔존 예약이 없으면 0 을 반환하고 releaseReservation 을 호출하지 않는다', async () => {
    const { svc, releaseReservation } = build([]);
    const released = await svc.releaseLeftoverReservations('fo-2', 'reconcile: test', fakeTrx);
    expect(released).toBe(0);
    expect(releaseReservation).not.toHaveBeenCalled();
  });
});
