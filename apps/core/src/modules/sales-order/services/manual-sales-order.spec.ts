import { BadRequestError, ConflictError, ServiceUnavailableError } from '@app/shared';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import type { PublisherFor } from '@app/events';
import type { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { SalesOrdersService } from './sales-orders.service';
import { MANUAL_ORDER_SALES_CHANNEL } from './manual-sales-order';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';

function manualDto(overrides: Partial<CreateSalesOrderDto> = {}): CreateSalesOrderDto {
  return {
    channelOrderId: 'SO-20260101-AB12CD',
    salesChannel: MANUAL_ORDER_SALES_CHANNEL,
    shippingAddress: {
      recipientName: '받는 분',
      phone: '010-0000-0000',
      postalCode: '00000',
      roadAddress: '도로명 1',
      detailAddress: '101호',
    },
    lines: [{ variantId: VARIANT_ID, quantity: 1, unitPrice: 1000, totalPrice: 1000 }],
    memo: '전화 접수',
    ...overrides,
  };
}

function makeService(existing: unknown = undefined) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const tx: any = {
    query: { salesOrders: { findFirst: jest.fn().mockResolvedValue(existing) } },
    insert: jest.fn((table: unknown) => ({
      values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        inserted.push({ table, values });
        const rows = Array.isArray(values) ? values : [{ id: ORDER_ID, ...values }];
        return { returning: jest.fn().mockResolvedValue(rows) };
      },
    })),
  };
  const db = { run: jest.fn((fn: (trx: any) => unknown, explicitTx?: any) => fn(explicitTx ?? tx)), db: tx };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const backlog = { enqueueForSalesOrder: jest.fn().mockResolvedValue({ id: 'backlog-1' }) };
  const service = new SalesOrdersService(
    db as any,
    outbox as unknown as PublisherFor<typeof FULFILLMENT_STREAM>,
    outbox as unknown as PublisherFor<typeof CORE_ORDER_STREAM>,
    {} as any,
    {} as any,
    backlog as any,
  );
  return { service, tx, backlog, inserted };
}

describe('SalesOrdersService.createManual', () => {
  it('saves the order with its memo and queues it for fulfillment in the same transaction', async () => {
    const { service, tx, backlog, inserted } = makeService();

    const order = await service.createManual(manualDto());

    const orderRow = inserted.find((row) => row.table === wmsTables.salesOrders)?.values as Record<string, unknown>;
    expect(orderRow).toMatchObject({
      channelOrderId: 'SO-20260101-AB12CD',
      salesChannel: MANUAL_ORDER_SALES_CHANNEL,
      memo: '전화 접수',
    });
    expect(backlog.enqueueForSalesOrder).toHaveBeenCalledWith(
      ORDER_ID,
      { eventOccurredAt: orderRow.orderDate, isNewSalesOrder: true },
      tx,
    );
    expect(order.id).toBe(ORDER_ID);
  });

  it('rejects an order number that is already saved without writing anything', async () => {
    const { service, backlog, inserted } = makeService({ id: 'existing-order' });

    await expect(service.createManual(manualDto())).rejects.toBeInstanceOf(ConflictError);
    expect(inserted).toHaveLength(0);
    expect(backlog.enqueueForSalesOrder).not.toHaveBeenCalled();
  });

  it('reports a concurrent save of the same order number as a conflict', async () => {
    const { service, tx } = makeService();
    const pgError = { code: '23505', constraint_name: 'sales_orders_sales_channel_channel_order_id_unique' };
    tx.insert.mockImplementationOnce(() => ({
      values: () => ({
        returning: jest.fn().mockRejectedValue(Object.assign(new Error('query failed'), { cause: pgError })),
      }),
    }));

    await expect(service.createManual(manualDto())).rejects.toBeInstanceOf(ConflictError);
  });

  it('does not turn other database errors into a conflict', async () => {
    const { service, tx } = makeService();
    tx.insert.mockImplementationOnce(() => ({
      values: () => ({ returning: jest.fn().mockRejectedValue(new Error('connection lost')) }),
    }));

    await expect(service.createManual(manualDto())).rejects.toThrow('connection lost');
  });

  it('does not keep the order when the fulfillment queue refuses it', async () => {
    const { service, backlog } = makeService();
    backlog.enqueueForSalesOrder.mockResolvedValueOnce(undefined);

    await expect(service.createManual(manualDto())).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it.each([[{ unitPrice: 1.5, totalPrice: 1.5 }], [{ quantity: 1.5 }], [{ totalPrice: 10.5 }]])(
    'rejects amounts or quantities that are not whole numbers: %o',
    async (patch) => {
      const { service, inserted } = makeService();
      const dto = manualDto();
      dto.lines = [{ ...dto.lines[0], ...patch }];

      await expect(service.createManual(dto)).rejects.toBeInstanceOf(BadRequestError);
      expect(inserted).toHaveLength(0);
    },
  );

  it.each(['medusa', 'naver', 'coupang'])('refuses to create a %s order from the admin entry', async (salesChannel) => {
    const { service, inserted } = makeService();

    await expect(service.createManual(manualDto({ salesChannel }))).rejects.toBeInstanceOf(BadRequestError);
    expect(inserted).toHaveLength(0);
  });
});
