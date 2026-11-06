import { DbService } from '@app/db';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { OutboundPreparationManager } from './outbound-preparation.manager';

jest.mock('../services/consolidation-shipment-reads', () => ({ loadShipmentLines: jest.fn() }));

describe('OutboundPreparationManager', () => {
  const actor = { id: 'u1', roles: ['warehouse'] };
  const plan = jest.fn();
  const addShipment = jest.fn();
  const splitUnreserved = jest.fn();
  const limit = jest.fn();
  const groupBy = jest.fn();
  const where = jest.fn((_condition: SQL) => ({ limit, groupBy }));
  const leftJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ where, leftJoin }));
  const db = { select: jest.fn(() => ({ from })) };
  let manager: OutboundPreparationManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    plan.mockReset().mockResolvedValue({});
    addShipment.mockReset().mockResolvedValue({});
    splitUnreserved.mockReset().mockResolvedValue({});
    limit.mockReset().mockResolvedValue([{ status: 'draft', manifestVersion: 3, reservationVersion: 7 }]);
    groupBy.mockReset().mockResolvedValue([{ qty: 3, confirmedQty: 1 }]);
    setProfiles(['p1']);

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationManager,
        { provide: DbService, useValue: { db } },
        { provide: ShipmentPlanningService, useValue: { plan, splitUnreserved } },
        { provide: OutboundBatchOrchestrator, useValue: { addShipment } },
      ],
    }).compile();

    manager = module.get(OutboundPreparationManager);
  });

  function setProfiles(profiles: (string | null)[]) {
    jest.mocked(loadShipmentLines).mockResolvedValue(
      profiles.map((skuProfileId) => ({
        shipmentId: 's1',
        qty: 1,
        salesOrderId: null,
        fulfillmentMode: 'in_house',
        skuStockType: 'stocked',
        skuProfileId,
        skuName: '상품',
        customerId: null,
        customerName: null,
        customerPhone: null,
        displayOrderNo: null,
        channelOrderId: null,
        salesChannel: null,
        salesOrderCreatedAt: null,
      })),
    );
  }

  it('counts planned shipments as succeeded without planning or reading SKU profiles', async () => {
    limit.mockResolvedValue([{ status: 'planned', manifestVersion: 3, reservationVersion: 7 }]);

    await expect(manager.planMany(['s1'], 'k', actor)).resolves.toEqual({ succeeded: ['s1'], failed: [] });
    expect(plan).not.toHaveBeenCalled();
    expect(loadShipmentLines).not.toHaveBeenCalled();
  });

  it('passes the current versions, resolved profile, per-shipment key and actor to plan', async () => {
    await expect(manager.planMany(['s1'], 'k', actor)).resolves.toEqual({ succeeded: ['s1'], failed: [] });

    expect(loadShipmentLines).toHaveBeenCalledWith(db, ['s1']);
    expect(plan).toHaveBeenCalledWith(
      's1',
      { shippingProfileId: 'p1', expectedManifestVersion: 3, expectedReservationVersion: 7 },
      'k:s1',
      actor,
    );
  });

  it.each<{ profiles: (string | null)[] }>([{ profiles: ['p1', 'p2'] }, { profiles: ['p1', null] }, { profiles: [] }])(
    'rejects incompatible or missing profiles: $profiles',
    async ({ profiles }) => {
      setProfiles(profiles);

      await expect(manager.planMany(['s1'], 'k', actor)).resolves.toEqual({
        succeeded: [],
        failed: [
          {
            shipmentId: 's1',
            code: 'SHIPMENT_PROFILE_INCOMPATIBLE',
            message: '배송 프로필을 정할 수 없어요',
            transient: false,
          },
        ],
      });
      expect(plan).not.toHaveBeenCalled();
    },
  );

  it('continues planning after one shipment fails', async () => {
    plan.mockRejectedValueOnce(new ConflictException({ code: 'SHIPMENT_NOT_FULLY_RESERVED' }));

    await expect(manager.planMany(['s1', 's2'], 'k', actor)).resolves.toEqual({
      succeeded: ['s2'],
      failed: [
        { shipmentId: 's1', code: 'SHIPMENT_NOT_FULLY_RESERVED', message: '재고 예약이 모자라요', transient: false },
      ],
    });
    expect(plan.mock.calls.map((call) => call[2])).toEqual(['k:s1', 'k:s2']);
  });

  it('reports a missing shipment without trying to plan it', async () => {
    limit.mockResolvedValue([]);

    await expect(manager.planMany(['s1'], 'k', actor)).resolves.toEqual({
      succeeded: [],
      failed: [{ shipmentId: 's1', code: 'UNKNOWN', message: '처리하지 못했어요', transient: false }],
    });
    expect(plan).not.toHaveBeenCalled();
  });

  it('counts existing batch membership as succeeded and adds the next shipment with its own key', async () => {
    limit.mockResolvedValueOnce([{ id: 'wi1' }]).mockResolvedValueOnce([]);

    await expect(manager.addManyToBatch('b1', ['s1', 's2'], 'k', actor)).resolves.toEqual({
      succeeded: ['s1', 's2'],
      failed: [],
    });
    expect(addShipment).toHaveBeenCalledTimes(1);
    expect(addShipment).toHaveBeenCalledWith('b1', 's2', 'k:s2', actor);
    expect(from).toHaveBeenCalledWith(wmsTables.outboundBatchWorkItems);

    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);

    expect(query.sql).toMatch(/"batch_id" = \$1.* and .*"shipment_id" = \$2.* and .*"status" in/);
    expect(query.params).toEqual(['b1', 's1', 'queued', 'picking', 'ready_to_pack', 'packing', 'short_pick_recovery']);
  });

  it('reports other-batch conflicts as permanent and continues adding the next shipment', async () => {
    limit.mockResolvedValue([]);
    addShipment.mockRejectedValueOnce(new ConflictException({ code: 'SHIPMENT_ACTIVE_WORK_ITEM' }));

    await expect(manager.addManyToBatch('b1', ['s1', 's2'], 'k', actor)).resolves.toEqual({
      succeeded: ['s2'],
      failed: [
        {
          shipmentId: 's1',
          code: 'SHIPMENT_ACTIVE_WORK_ITEM',
          message: '이미 다른 배치에 들어 있어요',
          transient: false,
        },
      ],
    });
    expect(addShipment).toHaveBeenNthCalledWith(2, 'b1', 's2', 'k:s2', actor);
  });

  it.each([
    {
      lines: [
        { qty: 2, confirmedQty: 2 },
        { qty: 3, confirmedQty: 3 },
      ],
    },
    { lines: [] },
  ])('counts shipments with no unreserved quantity as succeeded without splitting: $lines', async ({ lines }) => {
    groupBy.mockResolvedValue(lines);

    await expect(manager.splitManyUnreserved(['s1'], 'k', actor)).resolves.toEqual({
      succeeded: ['s1'],
      failed: [],
    });
    expect(splitUnreserved).not.toHaveBeenCalled();
  });

  it('succeeds on a same-key retry after splitting removes the unreserved quantity', async () => {
    limit.mockResolvedValueOnce([{ manifestVersion: 3 }]).mockResolvedValueOnce([{ manifestVersion: 4 }]);
    groupBy.mockResolvedValueOnce([{ qty: 3, confirmedQty: 1 }]).mockResolvedValueOnce([{ qty: 1, confirmedQty: 1 }]);

    await expect(manager.splitManyUnreserved(['s1'], 'k', actor)).resolves.toEqual({ succeeded: ['s1'], failed: [] });
    await expect(manager.splitManyUnreserved(['s1'], 'k', actor)).resolves.toEqual({ succeeded: ['s1'], failed: [] });
    expect(splitUnreserved).toHaveBeenCalledTimes(1);
  });

  it('splits each shipment using its current manifest version, fixed reason, key and actor', async () => {
    limit.mockResolvedValueOnce([{ manifestVersion: 3 }]).mockResolvedValueOnce([{ manifestVersion: 8 }]);

    await expect(manager.splitManyUnreserved(['s1', 's2'], 'k', actor)).resolves.toEqual({
      succeeded: ['s1', 's2'],
      failed: [],
    });
    expect(splitUnreserved).toHaveBeenNthCalledWith(
      1,
      's1',
      { reason: '출고 준비: 있는 것만 먼저 보내기', expectedManifestVersion: 3 },
      'k:s1',
      actor,
    );
    expect(splitUnreserved).toHaveBeenNthCalledWith(
      2,
      's2',
      { reason: '출고 준비: 있는 것만 먼저 보내기', expectedManifestVersion: 8 },
      'k:s2',
      actor,
    );
  });

  it('continues splitting after a missing shipment and a transient failure', async () => {
    limit.mockResolvedValueOnce([]);
    splitUnreserved.mockRejectedValueOnce(new Error('connection reset'));

    await expect(manager.splitManyUnreserved(['s1', 's2', 's3'], 'k', actor)).resolves.toEqual({
      succeeded: ['s3'],
      failed: [
        { shipmentId: 's1', code: 'UNKNOWN', message: '처리하지 못했어요', transient: false },
        { shipmentId: 's2', code: 'UNKNOWN', message: '처리하지 못했어요', transient: true },
      ],
    });
    expect(splitUnreserved).toHaveBeenCalledTimes(2);
    expect(splitUnreserved).toHaveBeenNthCalledWith(
      2,
      's3',
      { reason: '출고 준비: 있는 것만 먼저 보내기', expectedManifestVersion: 3 },
      'k:s3',
      actor,
    );
  });
});
