import { NotFoundError } from '@app/shared';
import { ReservationReleaseService } from './reservation-release.service';

describe('ReservationReleaseService', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  const build = (rows: Array<{ id: string; shipmentLineId: string | null }>) => {
    const limit = jest.fn().mockResolvedValue(rows);
    const db = { db: { select: jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })) } };
    const shipmentReservations = { releaseReservation: jest.fn().mockResolvedValue(undefined) };
    const unifiedReservation = { releaseReservation: jest.fn().mockResolvedValue(undefined) };
    const service = new ReservationReleaseService(
      db as never,
      shipmentReservations as never,
      unifiedReservation as never,
    );
    return { service, shipmentReservations, unifiedReservation };
  };

  it('routes a shipment-line row to ShipmentReservationService with the given reason', async () => {
    const { service, shipmentReservations, unifiedReservation } = build([{ id, shipmentLineId: 'line-1' }]);
    await service.release(id, '  재고 이동 ');
    expect(shipmentReservations.releaseReservation).toHaveBeenCalledTimes(1);
    expect(shipmentReservations.releaseReservation).toHaveBeenCalledWith(id, '재고 이동');
    expect(unifiedReservation.releaseReservation).not.toHaveBeenCalled();
  });

  it('uses admin-release when reason is missing or blank', async () => {
    const { service, shipmentReservations } = build([{ id, shipmentLineId: 'line-1' }]);
    await service.release(id);
    await service.release(id, '   ');
    expect(shipmentReservations.releaseReservation).toHaveBeenNthCalledWith(1, id, 'admin-release');
    expect(shipmentReservations.releaseReservation).toHaveBeenNthCalledWith(2, id, 'admin-release');
  });

  it('routes a legacy row without shipment line to UnifiedReservationService', async () => {
    const { service, shipmentReservations, unifiedReservation } = build([{ id, shipmentLineId: null }]);
    await service.release(id, 'x');
    expect(unifiedReservation.releaseReservation).toHaveBeenCalledTimes(1);
    expect(unifiedReservation.releaseReservation).toHaveBeenCalledWith(id);
    expect(shipmentReservations.releaseReservation).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the reservation does not exist', async () => {
    const { service } = build([]);
    const err = await service.release(id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('예약을 찾을 수 없습니다');
  });
});
