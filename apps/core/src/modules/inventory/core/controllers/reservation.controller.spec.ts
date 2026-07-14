import { ReservationController } from './reservation.controller';
import type { UnifiedReservationService } from '../../shared/services/unified-reservation.service';
import type { FulfillmentReservationReconciliationService } from '../services/fulfillment-reservation-reconciliation.service';

describe('ReservationController.reconcile', () => {
  it('reconcileAndHeal 을 호출하고 heal 카운트를 반환한다', async () => {
    const reconcileAndHeal = jest.fn().mockResolvedValue({
      checkedAt: new Date(),
      healedFos: 2,
      healedReservations: 5,
      report: { checkedAt: new Date(), totalZombieReservations: 5, totalZombieFos: 2, rows: [] },
    });
    const reconciliation = { reconcileAndHeal } as unknown as FulfillmentReservationReconciliationService;
    const controller = new ReservationController({} as unknown as UnifiedReservationService, reconciliation);

    const result = await controller.reconcileReservations();

    expect(reconcileAndHeal).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ healedFos: 2, healedReservations: 5 });
  });
});
