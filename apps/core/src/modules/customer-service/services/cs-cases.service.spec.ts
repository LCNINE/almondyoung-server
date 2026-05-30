import { wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../../sales-order/services/sales-orders.service';
import { csCases } from '../schema/customer-service.schema';
import { CsCasesService } from './cs-cases.service';

describe('CsCasesService', () => {
  const csCaseId = '11111111-1111-4111-8111-111111111111';
  const salesOrderId = '22222222-2222-4222-8222-222222222222';
  const amendmentId = '33333333-3333-4333-8333-333333333333';

  function rows<T>(value: T[]): T[] & { limit: (count: number) => Promise<T[]> } {
    const result = [...value] as T[] & { limit: (count: number) => Promise<T[]> };
    result.limit = (count: number) => Promise.resolve(result.slice(0, count));
    return result;
  }

  function makeServices() {
    const state = {
      csCases: [] as Array<Record<string, any>>,
      salesOrders: [
        {
          id: salesOrderId,
          status: 'confirmed',
          salesChannel: 'medusa',
          channelOrderId: 'medusa_order_cs_case',
          shippingAddress: {},
          orderDate: new Date('2026-05-30T00:00:00.000Z'),
        },
      ] as Array<Record<string, any>>,
      salesOrderLines: [] as Array<Record<string, any>>,
      businessLinks: [] as Array<Record<string, any>>,
    };

    const selectRowsFor = (table: unknown) => {
      if (table === csCases) return state.csCases;
      if (table === wmsTables.salesOrders) return state.salesOrders;
      if (table === wmsTables.salesOrderLines) return state.salesOrderLines;
      if (table === wmsTables.businessLinks) return state.businessLinks;
      return [];
    };

    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => rows(selectRowsFor(table)),
          orderBy: () => ({
            limit: (limit: number) => Promise.resolve(selectRowsFor(table).slice(0, limit)),
          }),
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: () => {
            if (table === csCases) {
              const inserted = {
                id: csCaseId,
                status: 'open',
                priority: 'normal',
                reasonCode: null,
                description: null,
                customerId: null,
                customerName: null,
                customerEmail: null,
                customerPhone: null,
                assignedTo: null,
                metadata: {},
                createdBy: null,
                resolvedAt: null,
                closedAt: null,
                createdAt: new Date('2026-05-30T00:00:00.000Z'),
                updatedAt: new Date('2026-05-30T00:00:00.000Z'),
                ...values,
              };
              state.csCases.push(inserted);
              return [inserted];
            }
            if (table === wmsTables.businessLinks) {
              const inserted = {
                id: `business-link-${state.businessLinks.length + 1}`,
                ...values,
                createdAt: new Date(`2026-05-30T00:0${state.businessLinks.length}:00.000Z`),
                updatedAt: new Date(`2026-05-30T00:0${state.businessLinks.length}:00.000Z`),
              };
              state.businessLinks.push(inserted);
              return [inserted];
            }
            return [];
          },
        }),
      })),
    };

    const db = { db: { ...tx, transaction: jest.fn((fn) => fn(tx)) } };
    const csService = new CsCasesService(db as any);
    const salesOrderService = new SalesOrdersService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { csService, salesOrderService, state };
  }

  it('creates a standalone CS Case without requiring an order target', async () => {
    const { csService, state } = makeServices();

    const created = await csService.create({
      subject: 'Customer requested cancellation review',
      reasonCode: 'customer_request',
      description: 'Customer asked whether the order can be amended.',
      metadata: { channel: 'kakao' },
    });

    expect(state.csCases).toHaveLength(1);
    expect(created).toMatchObject({
      id: csCaseId,
      status: 'open',
      subject: 'Customer requested cancellation review',
      reasonCode: 'customer_request',
      businessTimeline: [],
    });

    const viewed = await csService.getOne(csCaseId);
    expect(viewed).toMatchObject({
      id: csCaseId,
      subject: 'Customer requested cancellation review',
      businessTimeline: [],
    });
  });

  it('links a CS Case to a SalesOrder and exposes it in the SalesOrder timeline', async () => {
    const { csService, salesOrderService, state } = makeServices();
    await csService.create({ subject: 'Customer requested fulfillment adjustment' });

    const link = await csService.createBusinessLink(csCaseId, {
      relationName: 'opened_for_sales_order',
      target: { type: 'sales_order', id: salesOrderId },
      occurredAt: '2026-05-30T01:00:00.000Z',
      metadata: { reason: 'address_change' },
    });

    expect(state.businessLinks).toHaveLength(1);
    expect(state.businessLinks[0]).toMatchObject({
      sourceType: 'cs_case',
      sourceId: csCaseId,
      targetType: 'sales_order',
      targetId: salesOrderId,
    });
    expect(link).toMatchObject({
      relationName: 'opened_for_sales_order',
      direction: 'outbound',
      linkedEntity: { type: 'sales_order', id: salesOrderId, externalRef: null },
    });

    const order = await salesOrderService.getOne(salesOrderId);
    expect(order?.businessTimeline).toEqual([
      expect.objectContaining({
        relationName: 'opened_for_sales_order',
        direction: 'inbound',
        linkedEntity: { type: 'cs_case', id: csCaseId, externalRef: null },
      }),
    ]);
  });

  it('links a CS Case to a later amendment without taking ownership of the amendment', async () => {
    const { csService, state } = makeServices();
    await csService.create({ subject: 'Customer asked for line replacement' });

    await csService.createBusinessLink(csCaseId, {
      relationName: 'opened_amendment',
      target: { type: 'sales_order_amendment', id: amendmentId },
      occurredAt: '2026-05-30T02:00:00.000Z',
    });

    expect(state.businessLinks).toHaveLength(1);
    expect(state.businessLinks[0]).toMatchObject({
      sourceType: 'cs_case',
      sourceId: csCaseId,
      targetType: 'sales_order_amendment',
      targetId: amendmentId,
    });
  });
});
