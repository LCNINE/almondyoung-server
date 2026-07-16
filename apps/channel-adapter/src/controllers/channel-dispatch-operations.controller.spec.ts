import { UnauthorizedException } from '@nestjs/common';
import { ChannelDispatchOperationsController } from './channel-dispatch-operations.controller';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const SALES_ORDER_ID = '22222222-2222-4222-8222-222222222222';

function makeController(internalKey: string | undefined = 'internal-secret') {
  const worker = {
    getOperationObservability: jest.fn().mockResolvedValue([
      {
        dispatchAttemptId: ATTEMPT_ID,
        shipmentId: '33333333-3333-4333-8333-333333333333',
        salesOrderId: SALES_ORDER_ID,
        operation: 'dispatch',
        channel: 'naver',
        externalOrderId: '1000000001',
        status: 'recovery_required',
        attempts: 2,
        errorMessage: 'provider timeout',
        lastAttemptAt: new Date('2026-07-15T01:00:00.000Z'),
        updatedAt: new Date('2026-07-15T01:01:00.000Z'),
      },
    ]),
  };
  const config = { get: jest.fn().mockReturnValue(internalKey) };
  return {
    controller: new ChannelDispatchOperationsController(worker as never, config as never),
    worker,
  };
}

describe('ChannelDispatchOperationsController', () => {
  it('returns attempt/order-keyed operational state with the configured internal bearer key', async () => {
    const { controller, worker } = makeController();

    await expect(controller.inspect('Bearer internal-secret', ATTEMPT_ID, SALES_ORDER_ID)).resolves.toEqual({
      dispatchAttemptId: ATTEMPT_ID,
      salesOrderId: SALES_ORDER_ID,
      operations: [expect.objectContaining({ status: 'recovery_required', attempts: 2 })],
    });
    expect(worker.getOperationObservability).toHaveBeenCalledWith(ATTEMPT_ID, SALES_ORDER_ID);
  });

  it('rejects an invalid bearer key without querying operation state', async () => {
    const { controller, worker } = makeController();

    await expect(controller.inspect('Bearer wrong', ATTEMPT_ID, SALES_ORDER_ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(worker.getOperationObservability).not.toHaveBeenCalled();
  });

  it('fails closed when the internal key is not configured', async () => {
    const { controller, worker } = makeController(undefined);

    await expect(controller.inspect(undefined, ATTEMPT_ID, SALES_ORDER_ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(worker.getOperationObservability).not.toHaveBeenCalled();
  });
});
