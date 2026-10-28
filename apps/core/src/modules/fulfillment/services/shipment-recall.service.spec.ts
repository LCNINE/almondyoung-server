import { checkpointEvaluations, createCheckpointsForTesting, PermissionCheckpoints } from '@app/authorization';
import { register } from 'prom-client';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { RecallShipmentDispatchDto } from '../dto/shipment-recall.dto';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ShipmentRecallService } from './shipment-recall.service';

function makeService(checkpoints: PermissionCheckpoints = createCheckpointsForTesting()) {
  const commands = { execute: jest.fn() };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const reservations = { lockShipmentGraphForDispatch: jest.fn() };
  const service = new ShipmentRecallService(
    {} as never,
    commands as never,
    {} as never,
    {} as never,
    reservations as never,
    {} as never,
    {} as never,
    {} as never,
    workflowGate as never,
    checkpoints,
    new FulfillmentInvariantService(),
  );
  return { service, commands, reservations, workflowGate };
}

describe('ShipmentRecallService command validation', () => {
  const dto: RecallShipmentDispatchDto = {
    dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
    expectedManifestVersion: 2,
    physicalRecoveryConfirmed: true,
    reason: 'dispatch_mistake',
  };
  const actor = { id: '33333333-3333-4333-8333-333333333333', roles: ['logistics_worker'] };

  it('requires the dispatch recall permission before claiming a command', async () => {
    register.resetMetrics();
    const { service, commands } = makeService(createCheckpointsForTesting({ logistics_worker: [] }));
    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        dto,
        'recall-key',
        actor,
      ),
    ).rejects.toThrow('Missing required permission: fulfillment.dispatch.recall');
    expect(commands.execute).not.toHaveBeenCalled();
    expect(await checkpointEvaluations('fulfillment.dispatch_recall', 'match')).toBe(1);
    expect(await checkpointEvaluations('fulfillment.dispatch_recall', 'would_deny')).toBe(0);
  });

  it('denies the worker of the first-grant table, who does not hold the recall permission', async () => {
    const { service, commands } = makeService();
    await expect(
      service.report(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        dto,
        'recall-key',
        actor,
      ),
    ).rejects.toThrow('Missing required permission: fulfillment.dispatch.recall');
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
    const manager = { ...actor, roles: ['logistics_manager'] };
    const { service, commands, reservations } = makeService();
    const order: string[] = [];
    const stopAfterMemberInsert = new Error('stop after lock-order proof');
    reservations.lockShipmentGraphForDispatch.mockImplementation(() => {
      order.push('canonical-graph');
      return Promise.resolve();
    });
    const tx = {
      // 상자 주인 조회(입점사 갈래 판정) — 창고 상자(행 없음 → 창고 갈래)로 답한다
      select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
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
        manager,
      ),
    ).rejects.toBe(stopAfterMemberInsert);
    expect(order).toEqual(['canonical-graph', 'member-insert']);
  });
});
