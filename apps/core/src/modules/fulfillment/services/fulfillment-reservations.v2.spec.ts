import { FulfillmentReservationsFacade } from './fulfillment-reservations.facade';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandResult } from './fulfillment-command.service';

describe('FulfillmentReservationsFacade V2 transfer command', () => {
  it('wraps the existing atomic transfer in the durable command envelope', async () => {
    const workflowGate = { assertV2MutationAllowed: jest.fn() };
    const tx = { id: 'tx' } as unknown as DbTx;
    const execute = jest.fn(
      async <T>(
        _input: unknown,
        handler: (tx: DbTx, commandRequestId: string) => Promise<FulfillmentCommandResult<T>>,
      ): Promise<T> => (await handler(tx, 'command-1')).response,
    );
    const commands = { execute };
    const facade = new FulfillmentReservationsFacade(
      {} as never,
      {} as never,
      workflowGate as never,
      commands as never,
    );
    const transferReservation = jest.spyOn(facade, 'transferReservation').mockResolvedValue(undefined);
    const dto = {
      fromFulfillmentOrderItemId: 'from-foi',
      toFulfillmentOrderItemId: 'to-foi',
      quantity: 2,
      performedBy: 'operator-1',
      reason: 'rebalance',
    };

    await expect(facade.transferReservationCommand('fo-1', dto, 'transfer-key')).resolves.toEqual({
      operationId: 'command-1',
      fulfillmentOrderId: 'fo-1',
      fromFulfillmentOrderItemId: 'from-foi',
      toFulfillmentOrderItemId: 'to-foi',
      quantity: 2,
    });
    expect(workflowGate.assertV2MutationAllowed).toHaveBeenCalledWith('reservation.transfer');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'reservation.transfer', idempotencyKey: 'transfer-key' }),
      expect.any(Function),
    );
    expect(transferReservation).toHaveBeenCalledWith('fo-1', dto, tx);
  });
});
