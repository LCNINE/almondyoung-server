import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AdminReturnExchangeController } from './admin-return-exchange.controller';

describe('AdminReturnExchangeController V2 eligibility contract', () => {
  it('uses admin eligibility reads without customer ownership impersonation', async () => {
    const service = {
      adminCreateReturnRequest: jest.fn().mockResolvedValue({ id: 'return-1' }),
      adminGetReturnEligibility: jest.fn().mockResolvedValue({ orderId: 'order-1', items: [] }),
      adminGetReturnEligibilityByChannelOrder: jest.fn().mockResolvedValue({ orderId: 'order-1', items: [] }),
    };
    const controller = new AdminReturnExchangeController(service as never, {} as never);

    await expect(controller.getReturnEligibility('order-1')).resolves.toEqual({ orderId: 'order-1', items: [] });
    await expect(controller.getReturnEligibilityByChannelOrder('channel-order-1')).resolves.toEqual({
      orderId: 'order-1',
      items: [],
    });
    expect(service.adminGetReturnEligibility).toHaveBeenCalledWith('order-1');
    expect(service.adminGetReturnEligibilityByChannelOrder).toHaveBeenCalledWith('channel-order-1');
  });

  it('creates an exact-attempt return as the authenticated admin', async () => {
    const dto = {
      reasonCode: 'other' as const,
      lines: [
        {
          salesOrderLineId: 'line-1',
          shipmentLineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          dispatchAttemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          quantity: 1,
        },
      ],
    };
    const service = {
      adminCreateReturnRequest: jest.fn().mockResolvedValue({ id: 'return-1' }),
    };
    const controller = new AdminReturnExchangeController(service as never, {} as never);

    await expect(controller.createReturnRequest('order-1', { userId: 'admin-1' }, dto)).resolves.toEqual({
      id: 'return-1',
    });
    expect(service.adminCreateReturnRequest).toHaveBeenCalledWith('order-1', 'admin-1', dto);
  });

  it.each(['createReturnRequest', 'getReturnEligibility', 'getReturnEligibilityByChannelOrder'] as const)(
    'requires warehouse operate scope for %s',
    (methodName) => {
      const method = Object.getOwnPropertyDescriptor(AdminReturnExchangeController.prototype, methodName)
        ?.value as object;
      expect(Reflect.getMetadata('required_scopes', method)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    },
  );
});
