import { DbService } from '@app/db';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  runOutboundPreparation,
  PreparationDeps,
  PreparationInput,
} from 'apps/admin-web/src/features/order/outbound-preparation/run-outbound-preparation';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { loadHanjinConfig } from '../waybill/carrier/hanjin/hanjin.config';
import { WaybillIssueMachine } from '../waybill/waybill-issue.machine';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillRepository } from '../waybill/waybill.repository';
import { WaybillService } from '../waybill/waybill.service';
import { HANJIN_CONFIG } from '../waybill/waybill.tokens';
import { WaybillRow } from '../waybill/waybill.types';
import { OutboundPreparationManager } from './outbound-preparation.manager';

const shipmentId = '00000000-0000-4000-8000-000000000001';
const actor = { id: 'operator', roles: [] };
const input: PreparationInput = {
  warehouseId: 'warehouse',
  shipmentIds: [shipmentId],
  pickingMethod: 'total_picking',
  now: new Date('2026-11-05T00:00:00Z'),
};

function waybill(status: WaybillRow['status']): WaybillRow {
  return {
    id: 'waybill',
    shipmentId,
    source: 'carrier',
    carrier: 'HANJIN',
    status,
    trackingNo: status === 'pending' ? null : '123456789',
    custOrdNo: null,
    manifestVersion: 3,
    recipientHash: 'hash',
    labelData: null,
    lastError: null,
    attempts: 0,
    transientAttempts: 0,
    nextAttemptAt: null,
    issuedAt: null,
    voidedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

describe('outbound preparation with WaybillManager', () => {
  let active: WaybillRow | null;
  let manager: OutboundPreparationManager;
  let waybillManager: WaybillManager;
  let deps: PreparationDeps;
  const addShipment = jest.fn();
  const insertPending = jest.fn();
  const drive = jest.fn();
  const sleep = jest.fn();
  const createBatch = jest.fn();

  beforeEach(async () => {
    active = null;
    let key = 0;
    const commands = new Map<string, { waybillId: string }>();
    const shipment = {
      id: shipmentId,
      status: 'planned',
      warehouseId: 'warehouse',
      manifestVersion: 3,
      recipientSnapshot: {
        recipientName: '테스트',
        phone: '01000000000',
        postalCode: '00000',
        roadAddress: '테스트 주소',
      },
    };
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === wmsTables.outboundBatchWorkItems ? [] : [shipment]),
            for: async () => [shipment],
          }),
        }),
      }),
    };

    addShipment.mockReset().mockResolvedValue({});
    sleep.mockReset().mockResolvedValue(undefined);
    createBatch.mockReset().mockResolvedValue({ id: 'batch' });
    insertPending.mockReset().mockImplementation(async () => {
      active = waybill('pending');

      return active;
    });
    drive.mockReset().mockImplementation(async () => {
      active = waybill('registered');

      return active;
    });

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationManager,
        WaybillManager,
        WaybillService,
        { provide: DbService, useValue: { db, run: (fn: (tx: typeof db) => unknown) => fn(db) } },
        { provide: ShipmentPlanningService, useValue: {} },
        { provide: OutboundBatchOrchestrator, useValue: { addShipment } },
        {
          provide: WaybillReader,
          useValue: {
            getActiveWaybill: async () => active,
            recipientHashOf: () => 'hash',
            loadIssueContext: async () => ({ ...shipment, shipmentId, lines: [], entrancePassword: null }),
          },
        },
        { provide: WaybillRepository, useValue: { insertPending, findById: async () => active } },
        { provide: WaybillIssueMachine, useValue: { drive } },
        { provide: CarrierGatewayRegistry, useValue: { get: () => ({ isConfigured: () => true }) } },
        { provide: HANJIN_CONFIG, useValue: loadHanjinConfig({}) },
        {
          provide: FulfillmentCommandService,
          useValue: {
            execute: async (
              request: { idempotencyKey: string },
              handler: (tx: typeof db) => Promise<{ response: { waybillId: string } }>,
            ) => {
              const previous = commands.get(request.idempotencyKey);

              if (previous) {
                return previous;
              }

              const { response } = await handler(db);
              commands.set(request.idempotencyKey, response);

              return response;
            },
          },
        },
      ],
    }).compile();

    manager = module.get(OutboundPreparationManager);
    waybillManager = module.get(WaybillManager);
    deps = {
      planMany: (ids, key) => manager.planMany(ids, key, actor),
      issueWaybills: (ids, key) => manager.issueWaybills(ids, key, actor),
      addManyToBatch: (batchId, ids, key) => manager.addManyToBatch(batchId, ids, key, actor),
      sleep,
      createBatch,
      newKey: () => `key-${++key}`,
      waybillKeys: new Map(),
    };
  });

  it('re-enters with a registered waybill and reaches the batch without issuing', async () => {
    active = waybill('registered');

    await expect(
      waybillManager.issueForShipment(
        shipmentId,
        { carrier: 'HANJIN', expectedManifestVersion: 3 },
        'old-api-new-key',
        actor,
      ),
    ).rejects.toThrow('WAYBILL_ACTIVE_EXISTS');

    expect(await runOutboundPreparation(deps, input, jest.fn())).toMatchObject({ joined: 1, failures: [] });
    expect(addShipment).toHaveBeenCalledWith('batch', shipmentId, expect.any(String), actor);
    expect(insertPending).not.toHaveBeenCalled();
    expect(drive).not.toHaveBeenCalled();
  });

  it('retries a failed join into the same batch without issuing again', async () => {
    addShipment.mockRejectedValueOnce(new ConflictException({ code: 'BATCH_BUSY' }));

    const first = await runOutboundPreparation(deps, input, jest.fn());
    const second = await runOutboundPreparation(
      deps,
      { ...input, existingBatchId: first.batchId ?? undefined },
      jest.fn(),
    );

    expect(first).toMatchObject({ batchId: 'batch', joined: 0, failures: [{ stage: 'join' }] });
    expect(second).toMatchObject({ batchId: 'batch', joined: 1, failures: [] });
    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(insertPending).toHaveBeenCalledTimes(1);
    expect(drive).toHaveBeenCalledTimes(1);
    expect(addShipment.mock.calls.map(([batchId]) => batchId)).toEqual(['batch', 'batch']);
  });

  it('replays allocated issuance with one command and sleeps twice before registration', async () => {
    drive
      .mockImplementationOnce(async () => {
        active = waybill('allocated');

        return active;
      })
      .mockImplementationOnce(async () => active);

    expect(await runOutboundPreparation(deps, input, jest.fn())).toMatchObject({
      waybilled: 1,
      joined: 1,
      failures: [],
    });
    expect(sleep.mock.calls).toEqual([[2000], [5000]]);
    expect(insertPending).toHaveBeenCalledTimes(1);
    expect(drive).toHaveBeenCalledTimes(3);
    expect(drive.mock.calls.map(([id]) => id)).toEqual(['waybill', 'waybill', 'waybill']);
  });

  it.each<WaybillRow['status']>(['pending', 'allocated'])('does not replace lost-key %s issuance', async (status) => {
    active = waybill(status);

    expect(await runOutboundPreparation(deps, input, jest.fn())).toMatchObject({
      waybilled: 0,
      joined: 0,
      failures: [{ shipmentId, stage: 'waybill', message: '진행 중인 송장 발급 결과를 확인해 주세요' }],
    });
    expect(sleep.mock.calls).toEqual([[2000], [5000], [10000]]);
    expect(insertPending).not.toHaveBeenCalled();
    expect(drive).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('resumes transient pending issuance through the existing manager path', async () => {
    active = { ...waybill('pending'), transientAttempts: 1 };

    expect(await runOutboundPreparation(deps, input, jest.fn())).toMatchObject({ joined: 1, failures: [] });
    expect(insertPending).not.toHaveBeenCalled();
    expect(drive).toHaveBeenCalledTimes(1);
  });
});
