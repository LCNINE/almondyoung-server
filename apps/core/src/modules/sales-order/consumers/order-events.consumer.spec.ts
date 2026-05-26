import { OrderEventsConsumer } from './order-events.consumer';
import type { SalesOrdersService } from '../services/sales-orders.service';
import type { LibraryService } from '../../library/services/library.service';
import type { OrderCreatedPayload } from '@packages/event-contracts';
import type { MessageEnvelope } from '@packages/event-contracts/types';

/**
 * ADR-0010 wiring 검증.
 *
 * 이번 fix 의 원인은 service 결함이 아니라 publisher↔consumer event-type 미스매칭이었다 —
 * `LibraryService.grantOwnershipsForOrder` 단위 테스트로는 같은 종류 (wiring drift) 의 재발을
 * 잡을 수 없으므로 consumer 단에서 grant 호출 여부 / 호출 인자 / tx 전파를 직접 검증한다.
 */
describe('OrderEventsConsumer.handleOrderCreated', () => {
  type Mocks = {
    salesOrders: jest.Mocked<Pick<SalesOrdersService, 'findByChannelOrderId' | 'createFromEvent'>>;
    library: jest.Mocked<Pick<LibraryService, 'grantOwnershipsForOrder'>>;
    txInserts: Array<{ table: unknown; values: unknown }>;
    fakeTx: any;
    dbService: any;
  };

  function makeMocks(): Mocks {
    const txInserts: Array<{ table: unknown; values: unknown }> = [];
    const fakeTx: any = {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          txInserts.push({ table, values });
          return Promise.resolve();
        },
      }),
    };
    const dbService = {
      db: {
        transaction: (fn: (tx: any) => Promise<unknown>) => fn(fakeTx),
      },
    };
    return {
      salesOrders: {
        findByChannelOrderId: jest.fn(),
        createFromEvent: jest.fn(),
      } as any,
      library: {
        grantOwnershipsForOrder: jest.fn().mockResolvedValue(0),
      } as any,
      txInserts,
      fakeTx,
      dbService,
    };
  }

  function makeConsumer(mocks: Mocks): OrderEventsConsumer {
    return new OrderEventsConsumer(mocks.salesOrders as any, mocks.library as any, mocks.dbService as any);
  }

  function makePayload(overrides: Partial<OrderCreatedPayload> = {}): OrderCreatedPayload {
    return {
      orderId: 'order-internal-1',
      externalOrderId: 'ext-1',
      salesChannel: 'medusa',
      customerId: 'cust-1',
      items: [],
      totalAmount: 1000,
      subtotalAmount: 1000,
      shippingAmount: 0,
      discountAmount: 0,
      currency: 'KRW',
      shippingAddress: {
        recipientName: 'R',
        phone: '',
        postalCode: '',
        roadAddress: '',
        detailAddress: '',
      },
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  const envelope = { messageId: 'msg-1', correlationId: 'corr-1' } as MessageEnvelope<OrderCreatedPayload>;

  it('새 SO + status=confirmed → createFromEvent 호출, grant 호출, orderEvents insert', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue(undefined as any);
    mocks.salesOrders.createFromEvent.mockResolvedValue({ id: 'so-new-1' } as any);

    const consumer = makeConsumer(mocks);
    await consumer.handleOrderCreated(makePayload(), envelope);

    expect(mocks.salesOrders.createFromEvent).toHaveBeenCalledTimes(1);
    expect(mocks.library.grantOwnershipsForOrder).toHaveBeenCalledTimes(1);
    expect(mocks.library.grantOwnershipsForOrder).toHaveBeenCalledWith('so-new-1', mocks.fakeTx);
    expect(mocks.txInserts).toHaveLength(1); // orderEvents 로그
  });

  it('새 SO + status=pending → grant 호출 안 함 (fail-closed 가드)', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue(undefined as any);
    mocks.salesOrders.createFromEvent.mockResolvedValue({ id: 'so-new-2' } as any);

    const consumer = makeConsumer(mocks);
    await consumer.handleOrderCreated(makePayload({ status: 'pending' }), envelope);

    expect(mocks.salesOrders.createFromEvent).toHaveBeenCalledTimes(1);
    expect(mocks.library.grantOwnershipsForOrder).not.toHaveBeenCalled();
  });

  it('existing SO + status=confirmed → createFromEvent skip, grant 는 시도 (자가치유)', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-existing-1' } as any);

    const consumer = makeConsumer(mocks);
    await consumer.handleOrderCreated(makePayload(), envelope);

    expect(mocks.salesOrders.createFromEvent).not.toHaveBeenCalled();
    expect(mocks.txInserts).toHaveLength(0); // orderEvents insert 안 함
    expect(mocks.library.grantOwnershipsForOrder).toHaveBeenCalledTimes(1);
    expect(mocks.library.grantOwnershipsForOrder).toHaveBeenCalledWith('so-existing-1', mocks.fakeTx);
  });

  it('existing SO + status=pending → 아무 액션도 없음', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-existing-2' } as any);

    const consumer = makeConsumer(mocks);
    await consumer.handleOrderCreated(makePayload({ status: 'pending' }), envelope);

    expect(mocks.salesOrders.createFromEvent).not.toHaveBeenCalled();
    expect(mocks.txInserts).toHaveLength(0);
    expect(mocks.library.grantOwnershipsForOrder).not.toHaveBeenCalled();
  });

  it('grant 가 throw 하면 핸들러도 throw — tx rollback 보장 (같은 tx invariant)', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue(undefined as any);
    mocks.salesOrders.createFromEvent.mockResolvedValue({ id: 'so-new-3' } as any);
    mocks.library.grantOwnershipsForOrder.mockRejectedValue(new Error('grant boom'));

    const consumer = makeConsumer(mocks);
    await expect(consumer.handleOrderCreated(makePayload(), envelope)).rejects.toThrow('grant boom');
  });
});
