import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ConsolidationService } from '../services/consolidation.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { WaybillManager } from './waybill.manager';
import { WaybillService } from './waybill.service';
import type { WaybillRow } from './waybill.types';

const at = new Date('2026-11-12T00:00:00Z');
const voided: WaybillRow = {
  id: 'wb-1',
  shipmentId: 'source-1',
  source: 'manual',
  carrier: 'HANJIN',
  status: 'voided',
  trackingNo: '1234567890',
  custOrdNo: null,
  manifestVersion: 1,
  recipientHash: 'hash',
  labelData: null,
  lastError: null,
  attempts: 0,
  transientAttempts: 0,
  nextAttemptAt: null,
  issuedAt: at,
  voidedAt: at,
  createdAt: at,
  updatedAt: at,
};

describe('WaybillService void 후 보류 작업 재개', () => {
  let module: TestingModule;
  let service: WaybillService;
  const manager = { void: jest.fn(), voidForRecall: jest.fn(), findWithdrawalVoid: jest.fn() };
  const consolidation = {
    findPendingOperationIdForSource: jest.fn(),
    tryResumePending: jest.fn(),
  };
  const planning = {
    findPendingCancellationOperationId: jest.fn(),
    tryResumePendingCancellation: jest.fn(),
  };
  let warn: jest.SpyInstance;

  const runVoid = (tx?: DbTx) => service.void('wb-1', { reason: '합포장' }, 'key', { id: 'actor', roles: [] }, tx);

  beforeEach(async () => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    manager.void.mockResolvedValue(voided);
    manager.voidForRecall.mockResolvedValue(voided);
    consolidation.findPendingOperationIdForSource.mockResolvedValue('merge-1');
    planning.findPendingCancellationOperationId.mockResolvedValue('cancel-1');
    consolidation.tryResumePending.mockResolvedValue('completed');
    planning.tryResumePendingCancellation.mockResolvedValue('completed');

    module = await Test.createTestingModule({
      providers: [
        WaybillService,
        { provide: WaybillManager, useValue: manager },
        { provide: ConsolidationService, useValue: consolidation },
        { provide: ShipmentPlanningService, useValue: planning },
      ],
    }).compile();
    service = module.get(WaybillService);
  });

  afterEach(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  it('취소 커밋이 끝난 뒤 원본의 합포장과 취소를 외부 tx 없이 재개한다', async () => {
    let commit!: (row: WaybillRow) => void;
    manager.void.mockReturnValue(new Promise<WaybillRow>((resolve) => (commit = resolve)));

    const result = runVoid();

    expect(consolidation.findPendingOperationIdForSource).not.toHaveBeenCalled();
    expect(planning.findPendingCancellationOperationId).not.toHaveBeenCalled();

    commit(voided);

    await expect(result).resolves.toMatchObject({ status: 'voided', voidedAt: at.toISOString() });
    expect(consolidation.findPendingOperationIdForSource).toHaveBeenCalledWith('source-1');
    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
    expect(planning.findPendingCancellationOperationId).toHaveBeenCalledWith('source-1');
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
  });

  it('보류 작업이 없으면 재개하지 않는다', async () => {
    consolidation.findPendingOperationIdForSource.mockResolvedValue(null);
    planning.findPendingCancellationOperationId.mockResolvedValue(null);

    await expect(runVoid()).resolves.toMatchObject({ status: 'voided' });

    expect(consolidation.tryResumePending).not.toHaveBeenCalled();
    expect(planning.tryResumePendingCancellation).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'already_completed'])('재개 결과가 %s여도 취소는 성공한다', async (outcome) => {
    consolidation.tryResumePending.mockResolvedValue(outcome);
    planning.tryResumePendingCancellation.mockResolvedValue(outcome);

    await expect(runVoid()).resolves.toMatchObject({ status: 'voided' });

    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['finder', 'resume'])('합포장 %s 오류는 기록하고 취소 재개도 시도한다', async (stage) => {
    const error = new Error('merge failed');
    const method = stage === 'finder' ? consolidation.findPendingOperationIdForSource : consolidation.tryResumePending;
    method.mockRejectedValue(error);

    await expect(runVoid()).resolves.toMatchObject({ status: 'voided' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('source-1'), error);
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
  });

  it.each(['finder', 'resume'])('취소 %s 오류가 송장 취소 성공을 바꾸지 않는다', async (stage) => {
    const error = new Error('cancel failed');
    const method =
      stage === 'finder' ? planning.findPendingCancellationOperationId : planning.tryResumePendingCancellation;
    method.mockRejectedValue(error);

    await expect(runVoid()).resolves.toMatchObject({ status: 'voided' });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('source-1'), error);
  });

  it('정비 게이트가 재개를 거절해도 송장 취소는 성공한다', async () => {
    const gate = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'maintenance' }));
    consolidation.tryResumePending.mockImplementation(() =>
      gate.assertV2MutationAllowed('shipment.consolidate.resume'),
    );
    planning.tryResumePendingCancellation.mockImplementation(() =>
      gate.assertV2MutationAllowed('shipment.cancel_outstanding.resume'),
    );

    await expect(runVoid()).resolves.toMatchObject({ status: 'voided' });

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('취소 자체가 실패하면 재개하지 않고 오류를 전달한다', async () => {
    manager.void.mockRejectedValue(new Error('void failed'));

    await expect(runVoid()).rejects.toThrow('void failed');

    expect(consolidation.findPendingOperationIdForSource).not.toHaveBeenCalled();
    expect(planning.findPendingCancellationOperationId).not.toHaveBeenCalled();
  });

  it('외부 tx가 있으면 아직 커밋 전이므로 재개하지 않는다', async () => {
    const tx = {} as DbTx;

    await expect(runVoid(tx)).resolves.toMatchObject({ status: 'voided' });

    expect(manager.void).toHaveBeenCalledWith('wb-1', { reason: '합포장' }, 'key', { id: 'actor', roles: [] }, tx);
    expect(consolidation.findPendingOperationIdForSource).not.toHaveBeenCalled();
    expect(planning.findPendingCancellationOperationId).not.toHaveBeenCalled();
  });

  it('철회된 상자의 예약 송장을 무효화하고 합포장과 취소를 재개한다', async () => {
    manager.findWithdrawalVoid.mockResolvedValue({ id: 'wb-1', actorId: 'admin' });

    await service.voidAfterWithdrawal('work-1');

    expect(manager.void).toHaveBeenCalledWith(
      'wb-1',
      { reason: 'withdrawn:excluded' },
      'withdrawal-void:work-1:wb-1',
      { id: 'admin', roles: [] },
      undefined,
    );
    expect(consolidation.tryResumePending).toHaveBeenCalledWith('merge-1');
    expect(planning.tryResumePendingCancellation).toHaveBeenCalledWith('cancel-1');
  });

  it('예약 송장이 없으면 무효화하지 않는다', async () => {
    manager.findWithdrawalVoid.mockResolvedValue(undefined);

    await service.voidAfterWithdrawal('work-1');

    expect(manager.void).not.toHaveBeenCalled();
  });

  it.each(['find', 'void'])('자동 무효화 %s 실패는 경고만 남기고 기존 재개 흐름에 맡긴다', async (stage) => {
    const error = new Error('void unavailable');
    manager.findWithdrawalVoid.mockResolvedValue({ id: 'wb-1', actorId: 'admin' });
    (stage === 'find' ? manager.findWithdrawalVoid : manager.void).mockRejectedValue(error);

    await expect(service.voidAfterWithdrawal('work-1')).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('work-1'), error);
    expect(consolidation.tryResumePending).not.toHaveBeenCalled();
  });

  it('회수용 송장 취소는 회수 흐름에 맡긴다', async () => {
    await service.voidForRecall('source-1', { reason: '회수' }, 'key', { id: 'actor', roles: [] });

    expect(consolidation.findPendingOperationIdForSource).not.toHaveBeenCalled();
    expect(planning.findPendingCancellationOperationId).not.toHaveBeenCalled();
  });
});
