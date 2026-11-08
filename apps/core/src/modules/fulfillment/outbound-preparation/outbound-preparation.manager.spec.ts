import { ConflictError } from '@app/shared';
import { WaybillService } from '../waybill/waybill.service';
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
import { OutboundPreparationReader } from './outbound-preparation.reader';

jest.mock('../services/consolidation-shipment-reads', () => ({ loadShipmentLines: jest.fn() }));

describe('OutboundPreparationManager', () => {
  const actor = { id: 'u1', roles: ['warehouse'] };
  const plan = jest.fn();
  const getActiveWaybill = jest.fn();
  const assertDispatchable = jest.fn();
  const issueForShipment = jest.fn();
  const resumeActive = jest.fn();
  const addShipment = jest.fn();
  const splitUnreserved = jest.fn();
  const limit = jest.fn();
  // 상자 하나의 라인 수량·예약 합 — Reader.lineQuantities 가 돌려주는 값.
  const splitLines = jest.fn();
  const where = jest.fn((_condition: SQL) => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const db = { select: jest.fn(() => ({ from })) };
  let manager: OutboundPreparationManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    getActiveWaybill.mockReset().mockResolvedValue(null);
    assertDispatchable.mockReset().mockResolvedValue({ status: 'registered', trackingNo: '123' });
    issueForShipment
      .mockReset()
      .mockResolvedValue({ status: 'registered', trackingNo: '123', lastError: null, nextAttemptAt: null });
    resumeActive.mockReset().mockResolvedValue(null);
    plan.mockReset().mockResolvedValue({});
    addShipment.mockReset().mockResolvedValue({});
    splitUnreserved.mockReset().mockResolvedValue({});
    limit.mockReset().mockResolvedValue([{ status: 'draft', manifestVersion: 3, reservationVersion: 7 }]);
    splitLines.mockReset().mockResolvedValue([{ qty: 3, confirmedQty: 1 }]);
    setProfiles(['p1']);

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationManager,
        { provide: WaybillService, useValue: { getActiveWaybill, assertDispatchable, issueForShipment, resumeActive } },
        { provide: DbService, useValue: { db } },
        { provide: ShipmentPlanningService, useValue: { plan, splitUnreserved } },
        { provide: OutboundBatchOrchestrator, useValue: { addShipment } },
        {
          provide: OutboundPreparationReader,
          useValue: { lineQuantities: async ([id]: string[]) => new Map([[id, await splitLines()]]) },
        },
      ],
    }).compile();

    manager = module.get(OutboundPreparationManager);
  });

  it.each(['registered', 'used'])('reuses a dispatchable %s waybill without issuing again', async (status) => {
    getActiveWaybill.mockResolvedValue({ status });
    assertDispatchable.mockResolvedValue({ status, trackingNo: '123', lastError: null, nextAttemptAt: null });

    const result = await manager.issueWaybills(['s1'], 'new-key', actor);

    expect(result).toEqual([expect.objectContaining({ shipmentId: 's1', status, trackingNo: '123' })]);
    expect(assertDispatchable).toHaveBeenCalledWith('s1');
    expect(issueForShipment).not.toHaveBeenCalled();
  });

  it('rejects a stale registered waybill without issuing another', async () => {
    getActiveWaybill.mockResolvedValue({ status: 'registered' });
    assertDispatchable.mockRejectedValue(new ConflictError('WAYBILL_STALE: private details'));

    expect(await manager.issueWaybills(['s1'], 'k', actor)).toEqual([
      expect.objectContaining({ status: 'failed', transient: false }),
    ]);
    expect(issueForShipment).not.toHaveBeenCalled();
  });

  it.each(['pending', 'allocated'])(
    'resumes a stuck %s waybill instead of issuing with the new key',
    async (status) => {
      getActiveWaybill.mockResolvedValue({ status });
      resumeActive.mockResolvedValue({ status: 'registered', trackingNo: '123', lastError: null, nextAttemptAt: null });

      expect(await manager.issueWaybills(['s1'], 'new-key', actor)).toEqual([
        expect.objectContaining({ shipmentId: 's1', status: 'registered', trackingNo: '123' }),
      ]);
      expect(resumeActive).toHaveBeenCalledWith('s1', { carrier: 'HANJIN', expectedManifestVersion: 3 });
      expect(issueForShipment).not.toHaveBeenCalled();
    },
  );

  it('hands a stuck waybill with stale contents to the operator without retrying', async () => {
    getActiveWaybill.mockResolvedValue({ status: 'allocated' });
    resumeActive.mockRejectedValue(new ConflictError('WAYBILL_NEEDS_REVIEW: w1'));

    expect(await manager.issueWaybills(['s1'], 'k', actor)).toEqual([
      expect.objectContaining({
        status: 'failed',
        transient: false,
        code: 'WAYBILL_NEEDS_REVIEW',
        reason: '송장 발급 결과를 확인해야 해요',
      }),
    ]);
    expect(issueForShipment).not.toHaveBeenCalled();
  });

  it('resumes the row another call created between the read and the issue', async () => {
    issueForShipment.mockRejectedValue(new ConflictError('WAYBILL_ACTIVE_EXISTS: s1'));
    resumeActive.mockResolvedValue({ status: 'allocated', trackingNo: '123', lastError: null, nextAttemptAt: null });

    expect(await manager.issueWaybills(['s1'], 'k', actor)).toEqual([
      expect.objectContaining({ status: 'allocated', trackingNo: '123' }),
    ]);
  });

  it('retries later when the raced row ended before it could be resumed', async () => {
    issueForShipment.mockRejectedValue(new ConflictError('WAYBILL_ACTIVE_EXISTS: s1'));

    expect(await manager.issueWaybills(['s1'], 'k', actor)).toEqual([
      expect.objectContaining({ status: 'failed', transient: true, code: 'WAYBILL_ISSUE_RACED' }),
    ]);
  });

  it('carries the error code of a rejected single command', async () => {
    issueForShipment.mockRejectedValue(new ConflictException({ code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' }));

    expect(await manager.issueWaybills(['s1'], 'old-key', actor)).toEqual([
      expect.objectContaining({ status: 'failed', transient: false, code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH' }),
    ]);
  });

  it('preserves item-level transient errors and continues other shipments', async () => {
    issueForShipment.mockRejectedValueOnce(new Error('private database details'));

    const result = await manager.issueWaybills(['s1', 's2'], 'k', actor);

    expect(result).toEqual([
      expect.objectContaining({ shipmentId: 's1', status: 'failed', transient: true, reason: '처리하지 못했어요' }),
      expect.objectContaining({ shipmentId: 's2', status: 'registered' }),
    ]);
    expect(issueForShipment).toHaveBeenCalledWith(
      's2',
      { carrier: 'HANJIN', expectedManifestVersion: 3 },
      'k:s2',
      actor,
    );
  });

  it('bounds waybill concurrency and preserves input order', async () => {
    let running = 0;
    let maximum = 0;
    getActiveWaybill.mockImplementation(async () => {
      running++;
      maximum = Math.max(maximum, running);
      await Promise.resolve();
      running--;

      return null;
    });
    const ids = Array.from({ length: 17 }, (_, index) => `s${index}`);

    const result = await manager.issueWaybills(ids, 'k', actor);

    expect(maximum).toBe(8);
    expect(result.map((item) => item.shipmentId)).toEqual(ids);
    expect(result.every((item) => item.status === 'registered')).toBe(true);
  });

  it('returns unstarted shipments when the waybill time budget expires', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    getActiveWaybill.mockImplementation(async () => {
      clock.mockReturnValue(45000);

      return null;
    });

    try {
      const result = await manager.issueWaybills(['s1', 's2'], 'k', actor);

      expect(result).toEqual([
        expect.objectContaining({ shipmentId: 's1', status: 'registered' }),
        expect.objectContaining({ shipmentId: 's2', status: 'pending', reason: 'time-budget-exceeded' }),
      ]);
      expect(issueForShipment).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
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
      failed: [{ shipmentId: 's1', code: 'SHIPMENT_NOT_FOUND', message: '상자를 찾을 수 없어요', transient: false }],
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
    splitLines.mockResolvedValue(lines);

    await expect(manager.splitManyUnreserved(['s1'], 'k', actor)).resolves.toEqual({
      succeeded: ['s1'],
      failed: [],
    });
    expect(splitUnreserved).not.toHaveBeenCalled();
  });

  it('succeeds on a same-key retry after splitting removes the unreserved quantity', async () => {
    limit.mockResolvedValueOnce([{ manifestVersion: 3 }]).mockResolvedValueOnce([{ manifestVersion: 4 }]);
    splitLines
      .mockResolvedValueOnce([{ qty: 3, confirmedQty: 1 }])
      .mockResolvedValueOnce([{ qty: 1, confirmedQty: 1 }]);

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
        { shipmentId: 's1', code: 'SHIPMENT_NOT_FOUND', message: '상자를 찾을 수 없어요', transient: false },
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
