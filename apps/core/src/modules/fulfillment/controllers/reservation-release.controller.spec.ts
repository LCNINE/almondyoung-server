import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { ReservationReleaseController } from './reservation-release.controller';

describe('ReservationReleaseController', () => {
  it('requires inventory.stock.adjust and forwards id and reason', async () => {
    const service = { release: jest.fn().mockResolvedValue(undefined) };
    const controller = new ReservationReleaseController(service as never);
    const id = '11111111-1111-4111-8111-111111111111';

    await controller.release(id, { reason: 'r' });

    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ReservationReleaseController.prototype.release)).toEqual([
      'inventory.stock.adjust',
    ]);
    expect(service.release).toHaveBeenCalledWith(id, 'r');
  });
});
