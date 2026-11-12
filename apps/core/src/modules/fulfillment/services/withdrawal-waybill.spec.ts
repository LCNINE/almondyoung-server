import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@app/db';
import { PermissionCheckpoints } from '@app/authorization';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillService } from '../waybill/waybill.service';
import { BoxAllocationManager } from './box-allocation.manager';
import { BoxReturnService } from './box-return.service';
import { BoxWithdrawalService } from './box-withdrawal.service';
import { ConsolidationService } from './consolidation.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ReturnBinService } from './return-bin.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import type { DbTx } from '../../inventory/schema/inventory.schema';

const actor = { id: 'admin', roles: [] };
const excluded = { operationId: 'exclude-1', workItem: { id: 'work-1', status: 'excluded', waitingOperationId: null } };
const removed = {
  shipmentId: 'shipment-1',
  workItemId: 'work-1',
  exited: true,
  exitTo: 'draft',
  waitingOperationId: null,
};

describe('철회 명령의 송장 무효화', () => {
  let module: TestingModule;
  let batches: OutboundBatchOrchestrator;
  let returns: BoxReturnService;
  const commands = { execute: jest.fn() };
  const manager = { findWithdrawalVoid: jest.fn(), void: jest.fn() };
  const consolidation = { findPendingOperationIdForSource: jest.fn(), tryResumePending: jest.fn() };
  const planning = { findPendingCancellationOperationId: jest.fn(), tryResumePendingCancellation: jest.fn() };

  const exclude = (voidWaybill = true, tx?: DbTx) =>
    batches.excludeShipment('batch-1', 'shipment-1', { reason: '합포장', voidWaybill }, 'exclude-key', actor, tx);
  const remove = () => returns.removeToReturnBin('shipment-1', { barcode: 'sku-1', quantity: 1 }, actor, 'remove-key');

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    manager.findWithdrawalVoid.mockResolvedValue({ id: 'waybill-1', actorId: actor.id });
    manager.void.mockResolvedValue({ id: 'waybill-1', shipmentId: 'shipment-1', status: 'voided' });
    consolidation.findPendingOperationIdForSource.mockResolvedValue('merge-1');
    planning.findPendingCancellationOperationId.mockResolvedValue('cancel-1');

    module = await Test.createTestingModule({
      providers: [
        OutboundBatchOrchestrator,
        BoxReturnService,
        WaybillService,
        { provide: FulfillmentCommandService, useValue: commands },
        { provide: WaybillManager, useValue: manager },
        { provide: ConsolidationService, useValue: consolidation },
        { provide: ShipmentPlanningService, useValue: planning },
        { provide: FulfillmentWorkflowGate, useValue: { assertV2MutationAllowed: jest.fn() } },
        ...[
          DbService,
          FulfillmentInvariantService,
          AuditService,
          BoxAllocationManager,
          BoxWithdrawalService,
          PermissionCheckpoints,
          ReturnBinService,
          BarcodeService,
        ].map((provide) => ({ provide, useValue: {} })),
        { provide: 'outer-tx', useValue: {} },
      ],
    }).compile();
    batches = module.get(OutboundBatchOrchestrator);
    returns = module.get(BoxReturnService);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  it('빈 상자는 제외 커밋 뒤 같은 요청에서 바로 송장을 무효화하고 재개한다', async () => {
    let commit!: (response: typeof excluded) => void;
    commands.execute.mockReturnValue(
      new Promise<typeof excluded>((resolve) => {
        commit = resolve;
      }),
    );

    const result = exclude();

    expect(manager.void).not.toHaveBeenCalled();
    commit(excluded);

    await expect(result).resolves.toEqual(excluded);
    expect(manager.findWithdrawalVoid).toHaveBeenCalledWith('work-1');
    expect(manager.void).toHaveBeenCalledTimes(1);
    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
  });

  it('상품이 남은 상자는 마지막 반납 커밋 뒤에만 무효화하고 재개한다', async () => {
    commands.execute.mockResolvedValueOnce({ ...excluded, workItem: { ...excluded.workItem, status: 'withdrawing' } });

    await exclude();
    expect(manager.void).not.toHaveBeenCalled();

    commands.execute.mockResolvedValueOnce({ ...removed, exited: false });
    await remove();
    expect(manager.void).not.toHaveBeenCalled();

    let commit!: (response: typeof removed) => void;
    commands.execute.mockReturnValueOnce(
      new Promise<typeof removed>((resolve) => {
        commit = resolve;
      }),
    );
    const result = remove();

    expect(manager.void).not.toHaveBeenCalled();
    commit(removed);

    await expect(result).resolves.toEqual(removed);
    expect(manager.void).toHaveBeenCalledTimes(1);
    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
  });

  it.each(['exclude', 'remove'])('%s 후 무효화 실패가 철회 완료를 실패시키지 않는다', async (command) => {
    manager.void.mockRejectedValue(new Error('void failed'));
    const resume = jest.spyOn(batches, 'resumeWaitingOperation').mockResolvedValue(undefined);
    commands.execute.mockResolvedValue(
      command === 'exclude'
        ? { ...excluded, workItem: { ...excluded.workItem, waitingOperationId: 'cancel-1' } }
        : { ...removed, waitingOperationId: 'cancel-1' },
    );

    await expect(command === 'exclude' ? exclude() : remove()).resolves.toBeDefined();

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('work-1'), expect.any(Error));
    expect(resume).toHaveBeenCalledWith('cancel-1', 'shipment-1', undefined);
  });

  it('체크하지 않으면 제외 시 무효화하지 않고 멱등 요청에서도 true와 구별한다', async () => {
    commands.execute.mockResolvedValue(excluded);

    await exclude(false);

    expect(manager.void).not.toHaveBeenCalled();
    expect(commands.execute.mock.calls[0][0].canonicalRequest).not.toHaveProperty('voidWaybill');

    await exclude();

    expect(commands.execute.mock.calls[1][0].canonicalRequest).toHaveProperty('voidWaybill', true);
  });

  it('외부 트랜잭션에서는 커밋 전 무효화와 재개를 실행하지 않는다', async () => {
    commands.execute.mockResolvedValue(excluded);

    await exclude(true, module.get<DbTx>('outer-tx'));

    expect(manager.findWithdrawalVoid).not.toHaveBeenCalled();
    expect(manager.void).not.toHaveBeenCalled();
    expect(consolidation.tryResumePending).not.toHaveBeenCalled();
  });

  it('카트 반납으로 빠진 상자도 무효화와 재개를 수행한다', async () => {
    await returns.resumeAfterDraftExit([removed]);

    expect(manager.findWithdrawalVoid).toHaveBeenCalledWith('work-1');
    expect(manager.void).toHaveBeenCalledTimes(1);
    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
  });
});
