import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { OutboundRefillController } from './outbound-refill.controller';

describe('OutboundRefillController', () => {
  it('창고 작업 스코프로 보충 대기를 리더에 위임한다', async () => {
    const reader = { pending: jest.fn().mockResolvedValue([]) };
    const controller = new OutboundRefillController(reader as never);
    await expect(controller.pending('11111111-1111-4111-8111-111111111111')).resolves.toEqual([]);
    expect(reader.pending).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, OutboundRefillController.prototype.pending)).toEqual([
      FULFILLMENT_SCOPE.WAREHOUSE_OPERATE,
    ]);
  });
});
