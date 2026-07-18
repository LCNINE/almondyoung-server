import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RecallShipmentDispatchDto } from '../dto/shipment-recall.dto';
import { ShipmentRecallService } from './shipment-recall.service';

function makeService(scopes: Set<string> = new Set([FULFILLMENT_SCOPE.DISPATCH_RECALL])) {
  const commands = { execute: jest.fn() };
  const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(scopes) };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const reservations = { lockShipmentGraphForDispatch: jest.fn() };
  const service = new ShipmentRecallService(
    {} as never,
    commands as never,
    authorization as never,
    {} as never,
    {} as never,
    reservations as never,
    {} as never,
    {} as never,
    workflowGate as never,
  );
  return { service, commands, authorization, reservations, workflowGate };
}

describe('ShipmentRecallService command validation', () => {
  const dto: RecallShipmentDispatchDto = {
    dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
    expectedManifestVersion: 2,
    physicalRecoveryConfirmed: true,
    reason: 'dispatch_mistake',
  };
  const actor = { id: '33333333-3333-4333-8333-333333333333', roles: ['logistics_worker'] };

  it('requires the dispatch recall scope before claiming a command', async () => {
    const { service, commands } = makeService(new Set());
    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        dto,
        'recall-key',
        actor,
      ),
    ).rejects.toThrow(FULFILLMENT_SCOPE.DISPATCH_RECALL);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('fails closed unless physical recovery is exact true and reason is approved', async () => {
    const { service, commands } = makeService();
    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        { ...dto, physicalRecoveryConfirmed: false as never },
        'recall-key',
        actor,
      ),
    ).rejects.toThrow('physicalRecoveryConfirmed');
    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        { ...dto, reason: 'free text' as never },
        'recall-key-2',
        actor,
      ),
    ).rejects.toThrow('Unsupported recall reason');
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('owns the canonical shipment graph before inserting the member whose shipment FK takes KEY SHARE', async () => {
    const { service, commands, reservations } = makeService();
    const order: string[] = [];
    const stopAfterMemberInsert = new Error('stop after lock-order proof');
    reservations.lockShipmentGraphForDispatch.mockImplementation(() => {
      order.push('canonical-graph');
      return Promise.resolve();
    });
    const tx = {
      insert: jest.fn((table: unknown) => {
        if (table === wmsTables.shipmentOperationMembers) {
          order.push('member-insert');
          throw stopAfterMemberInsert;
        }
        return { values: () => Promise.resolve() };
      }),
    };
    commands.execute.mockImplementation(
      (_input: unknown, execute: (tx: unknown, commandRequestId: string, requestHash: string) => Promise<unknown>) =>
        execute(tx, 'command-id', 'a'.repeat(64)),
    );

    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        dto,
        'recall-lock-order',
        actor,
      ),
    ).rejects.toBe(stopAfterMemberInsert);
    expect(order).toEqual(['canonical-graph', 'member-insert']);
  });
});
