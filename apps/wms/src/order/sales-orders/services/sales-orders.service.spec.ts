import { Test } from '@nestjs/testing';
import { SalesOrdersService } from './sales-orders.service';
import { DbService } from '@app/db';
import { ORDER_EVENTS } from '../../shared/events';
import { PoliciesService } from '../../shared/services/policies.service';
import { EventPublisherService } from '@app/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { FulfillmentsService } from '../../fulfillments/services/fulfillments.service';
import { ReservationsService } from '../../shared/services/reservations.service';
import { AuditService } from '../../../shared/services/audit.service';
import { MetricsService } from '../../../shared/services/metrics.service';

describe('SalesOrdersService events', () => {
  it('publishes ORDER_CONFIRMED and ORDER_CANCELLED', async () => {
    const trx = {
      update: jest.fn().mockReturnValue({ set: jest.fn().mockReturnThis(), where: jest.fn() }),
      query: {
        salesOrders: {
          findFirst: jest.fn().mockResolvedValue({ id: 'so1', status: 'confirmed' }),
        },
        fulfillmentOrders: {
          findMany: jest.fn().mockResolvedValue([{ id: 'fo1', salesOrderId: 'so1' }])
        },
        fulfillmentOrderLines: {
          findMany: jest.fn().mockResolvedValue([{ id: 'fol1', reservedQty: 5 }])
        }
      },
      insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnThis(), returning: jest.fn().mockResolvedValue([{ id: 'so1' }]) }),
    } as any;

    const events = { publishEvent: jest.fn() } as any;

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: DbService, useValue: { db: { transaction: (fn: any) => fn(trx), query: trx.query, update: trx.update, insert: trx.insert } } },
        { provide: PoliciesService, useValue: { getVariantPolicy: jest.fn() } },
        { provide: EventPublisherService, useValue: events },
        { provide: OutboxService, useValue: { enqueue: jest.fn() } },
        { provide: FulfillmentsService, useValue: { createFulfillment: jest.fn() } },
        { provide: ReservationsService, useValue: { unreserve: jest.fn() } },
        { provide: AuditService, useValue: { logResourceChange: jest.fn() } },
        { provide: MetricsService, useValue: { incrementOrderCounter: jest.fn() } },
      ],
    }).compile();

    const service = moduleRef.get(SalesOrdersService);
    await service.confirm('so1');
    await service.cancel('so1');

    expect(events.publishEvent).toHaveBeenCalledWith(ORDER_EVENTS.CONFIRMED as any, expect.any(Object));
    expect(events.publishEvent).toHaveBeenCalledWith(ORDER_EVENTS.CANCELLED as any, expect.any(Object));
  });
});


