import { DbService } from '@app/db';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { OutboundPreparationManager } from './outbound-preparation.manager';

jest.mock('../services/consolidation-shipment-reads', () => ({ loadShipmentLines: jest.fn() }));

describe('OutboundPreparationManager.planMany', () => {
  const actor = { id: 'u1', roles: ['warehouse'] };
  const plan = jest.fn();
  const limit = jest.fn();
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const db = { select: jest.fn(() => ({ from })) };
  let manager: OutboundPreparationManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    plan.mockReset().mockResolvedValue({});
    limit.mockReset().mockResolvedValue([{ status: 'draft', manifestVersion: 3, reservationVersion: 7 }]);
    setProfiles(['p1']);

    const module = await Test.createTestingModule({
      providers: [
        OutboundPreparationManager,
        { provide: DbService, useValue: { db } },
        { provide: ShipmentPlanningService, useValue: { plan } },
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
});
