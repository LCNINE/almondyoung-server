import { Test } from '@nestjs/testing';
import { ReservationsService } from './reservations.service';
import { DbService } from '@app/db';
import { AvailabilityService } from './availability.service';
import { BadRequestException } from '@nestjs/common';
import { MetricsService } from '../../../shared/services/metrics.service';

describe('ReservationsService (drop-ship)', () => {
  it('reserve should reject when fulfillmentMode is drop_ship', async () => {
    const trx = {
      query: {
        fulfillmentOrderLines: { findFirst: jest.fn().mockResolvedValue({ id: 'fol1', fulfillmentOrderId: 'fo1', skuId: 'sku1', reservedQty: 0 }) },
        fulfillmentOrders: { findFirst: jest.fn().mockResolvedValue({ id: 'fo1', salesOrderId: 'so1', warehouseId: 'wh1' }) },
        salesOrderLines: { findMany: jest.fn().mockResolvedValue([{ id: 'sol1', salesOrderId: 'so1', variantId: 'v1' }]) },
        stockReservations: { findFirst: jest.fn() },
      },
      update: jest.fn(),
      insert: jest.fn(),
    } as any;

    const db = {
      transaction: (fn: any) => fn(trx),
      query: {
        salesVariantPolicies: { findFirst: jest.fn().mockResolvedValue({ variantId: 'v1', fulfillmentMode: 'drop_ship' }) },
      },
    } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReservationsService,
        { provide: DbService, useValue: { db } },
        { provide: AvailabilityService, useValue: { getAvailableQuantity: jest.fn().mockResolvedValue(999) } },
        { provide: MetricsService, useValue: {
          startStockReservationTimer: jest.fn().mockReturnValue(jest.fn()),
          incrementStockReservationCounter: jest.fn(),
          incrementOptimisticLockRetries: jest.fn()
        } },
      ],
    }).compile();

    const service = moduleRef.get(ReservationsService);
    await expect(service.reserve({ fulfillmentOrderLineId: 'fol1', quantity: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });
});


