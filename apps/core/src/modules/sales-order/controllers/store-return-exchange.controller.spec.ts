import { StoreSalesOrderReturnExchangeController } from './store-return-exchange.controller';

describe('StoreSalesOrderReturnExchangeController return eligibility', () => {
  it('routes Core and channel-order reads with authenticated customer ownership', async () => {
    const service = {
      getReturnEligibility: jest.fn().mockResolvedValue({ orderId: 'order-1', items: [] }),
      getReturnEligibilityByChannelOrder: jest.fn().mockResolvedValue({ orderId: 'order-1', items: [] }),
    };
    const controller = new StoreSalesOrderReturnExchangeController(service as never);
    const customer = { userId: 'customer-1' };

    await controller.getReturnEligibility('order-1', customer);
    await controller.getReturnEligibilityByChannelOrder('channel-order-1', customer);

    expect(service.getReturnEligibility).toHaveBeenCalledWith('order-1', 'customer-1');
    expect(service.getReturnEligibilityByChannelOrder).toHaveBeenCalledWith('channel-order-1', 'customer-1');
  });
});
