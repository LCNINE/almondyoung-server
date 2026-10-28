import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { OutboundRefillController } from './outbound-refill.controller';

describe('OutboundRefillController', () => {
  it('출고 조회 권한으로 보충 대기를 리더에 위임한다', async () => {
    const reader = { pending: jest.fn().mockResolvedValue([]) };
    const controller = new OutboundRefillController(reader as never);
    await expect(controller.pending('11111111-1111-4111-8111-111111111111')).resolves.toEqual([]);
    expect(reader.pending).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, OutboundRefillController.prototype.pending)).toEqual([
      'fulfillment.shipment.read',
    ]);
  });
});
