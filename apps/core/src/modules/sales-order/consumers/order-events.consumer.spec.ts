import { OrderEventsConsumer } from './order-events.consumer';
import type { SalesOrdersService } from '../services/sales-orders.service';
import type { LibraryService } from '../../library/services/library.service';
import type { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import type {
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderModifiedPayload,
  OrderRefundCreatedPayload,
} from '@packages/event-contracts';
import type { MessageEnvelope } from '@packages/event-contracts/types';

/**
 * ADR-0010 wiring 검증.
 *
 * 이번 fix 의 원인은 service 결함이 아니라 publisher↔consumer event-type 미스매칭이었다 —
 * `LibraryService.grantOwnershipsForOrder` 단위 테스트로는 같은 종류 (wiring drift) 의 재발을
 * 잡을 수 없으므로 consumer 단에서 grant 호출 여부 / 호출 인자 / tx 전파를 직접 검증한다.
 */
describe('OrderEventsConsumer', () => {
  type Mocks = {
    salesOrders: jest.Mocked<
      Pick<SalesOrdersService, 'findByChannelOrderId' | 'createFromEvent' | 'getOne' | 'cancel' | 'updateFromEvent'>
    >;
    library: jest.Mocked<Pick<LibraryService, 'grantOwnershipsForOrder' | 'revokeOwnershipsForOrder'>>;
    backlog: jest.Mocked<
      Pick<FulfillmentOrderCreationBacklogService, 'enqueueForSalesOrder' | 'closeOpenForSalesOrder'>
    >;
    txInserts: Array<{ table: unknown; values: unknown }>;
    // Rows returned by the businessLinks idempotency guard's `select(...)` lookup. Empty by
    // default (no existing link); push a row to simulate a refund link already recorded.
    businessLinkRows: any[];
    fakeTx: any;
    dbService: any;
  };

  function makeMocks(): Mocks {
    const txInserts: Array<{ table: unknown; values: unknown }> = [];
    const businessLinkRows: any[] = [];
    const fakeTx: any = {
      query: {
        orderEvents: {
          findFirst: jest.fn().mockResolvedValue(undefined),
        },
      },
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(businessLinkRows),
          }),
        }),
      }),
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
        getOne: jest.fn(),
        cancel: jest.fn(),
        updateFromEvent: jest.fn(),
      } as any,
      library: {
        grantOwnershipsForOrder: jest.fn().mockResolvedValue(0),
        revokeOwnershipsForOrder: jest.fn().mockResolvedValue(0),
      } as any,
      backlog: {
        enqueueForSalesOrder: jest.fn().mockResolvedValue({ id: 'backlog-1' }),
        closeOpenForSalesOrder: jest.fn().mockResolvedValue(0),
      } as any,
      txInserts,
      businessLinkRows,
      fakeTx,
      dbService,
    };
  }

  function makeConsumer(mocks: Mocks): OrderEventsConsumer {
    return new OrderEventsConsumer(
      mocks.salesOrders as any,
      mocks.library as any,
      mocks.backlog as any,
      mocks.dbService as any,
    );
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
    expect(mocks.backlog.enqueueForSalesOrder).toHaveBeenCalledWith('so-new-1', mocks.fakeTx);
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
    expect(mocks.backlog.enqueueForSalesOrder).not.toHaveBeenCalled();
    expect(mocks.library.grantOwnershipsForOrder).not.toHaveBeenCalled();
  });

  it('existing SO + status=confirmed → createFromEvent skip, grant 는 시도 (자가치유)', async () => {
    const mocks = makeMocks();
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-existing-1' } as any);

    const consumer = makeConsumer(mocks);
    await consumer.handleOrderCreated(makePayload(), envelope);

    expect(mocks.salesOrders.createFromEvent).not.toHaveBeenCalled();
    expect(mocks.txInserts).toHaveLength(0); // orderEvents insert 안 함
    expect(mocks.backlog.enqueueForSalesOrder).toHaveBeenCalledWith('so-existing-1', mocks.fakeTx);
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
    expect(mocks.backlog.enqueueForSalesOrder).not.toHaveBeenCalled();
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

  it('OrderCancelled 재전송도 OrderCancellation lifecycle 경로로 위임한다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-cancelled-1',
      reason: 'CUSTOMER_REQUEST',
      cancelledBy: 'customer',
      cancelledAt: new Date().toISOString(),
      refundRequired: false,
    } as OrderCancelledPayload;
    const cancelledEnvelope = {
      messageId: 'cancel-msg-1',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderCancelledPayload>;
    mocks.salesOrders.getOne.mockResolvedValue({ id: payload.orderId, status: 'cancelled' } as any);

    await consumer.handleOrderCancelled(payload, cancelledEnvelope);

    expect(mocks.salesOrders.cancel).toHaveBeenCalledWith(
      payload.orderId,
      expect.objectContaining({
        reasonCode: 'CUSTOMER_REQUEST',
        cancelledBy: 'customer',
        occurredAt: payload.cancelledAt,
        metadata: expect.objectContaining({
          refundRequired: false,
          stockRestorationResults: [],
          sourceEventId: 'cancel-msg-1',
        }),
      }),
      mocks.fakeTx,
    );
    expect(mocks.backlog.closeOpenForSalesOrder).not.toHaveBeenCalled();
    expect(mocks.library.revokeOwnershipsForOrder).not.toHaveBeenCalled();
  });

  it('OrderCancelled 대상 SalesOrder 가 없으면 lifecycle 신호를 재시도 가능하게 실패시킨다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-missing-1',
      reason: 'ADMIN_CANCEL',
      cancelledBy: 'medusa',
      cancelledAt: new Date().toISOString(),
      refundRequired: false,
    } as OrderCancelledPayload;
    const cancelledEnvelope = {
      messageId: 'cancel-msg-missing-1',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderCancelledPayload>;
    mocks.salesOrders.getOne.mockResolvedValue(undefined as any);

    await expect(consumer.handleOrderCancelled(payload, cancelledEnvelope)).rejects.toThrow(
      'Sales order so-missing-1 not found for OrderCancelled',
    );

    expect(mocks.salesOrders.cancel).not.toHaveBeenCalled();
    expect(mocks.txInserts).toHaveLength(0);
  });

  it('OrderModified 는 수락된 판매주문 계약 데이터를 업데이트하지 않고 처리 이력만 남긴다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-accepted-1',
      changes: {
        totalAmount: 12000,
        shippingAddress: {
          recipientName: 'R',
          phone: '',
          postalCode: '',
          roadAddress: 'Changed',
          detailAddress: '',
        },
        items: [
          {
            orderItemId: 'line-1',
            skuId: 'variant-1',
            masterId: 'master-1',
            versionId: 'version-1',
            variantId: 'variant-1',
            productName: 'Changed Product',
            channelProductId: 'variant-1',
            quantity: 2,
            unitPrice: 6000,
            totalPrice: 12000,
          },
        ],
      },
      modifiedBy: 'ADMIN',
      modifiedAt: new Date().toISOString(),
      reason: 'post-acceptance change',
    } as OrderModifiedPayload;
    const modifiedEnvelope = {
      messageId: 'modified-msg-1',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderModifiedPayload>;
    mocks.salesOrders.getOne.mockResolvedValue({ id: payload.orderId, status: 'pending' } as any);

    await consumer.handleOrderModified(payload, modifiedEnvelope);

    expect(mocks.salesOrders.updateFromEvent).not.toHaveBeenCalled();
    expect(mocks.txInserts).toHaveLength(1);
    expect(mocks.txInserts[0].values).toMatchObject({
      eventId: 'modified-msg-1',
      orderId: payload.orderId,
      eventType: 'ORDER_MODIFIED',
    });
  });

  it('OrderRefundCreated 는 판매주문 timeline 에 wallet_refund 업무 연결을 남긴다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-refunded-1',
      refundId: 'ref_1',
      paymentId: 'pay_1',
      amount: 12000,
      currency: 'KRW',
      reason: 'MEDUSA_REFUND',
      note: 'refund collected from Medusa',
      createdBy: 'medusa',
      createdAt: '2026-05-26T01:18:00.000Z',
    } as OrderRefundCreatedPayload;
    const refundEnvelope = {
      messageId: 'refund-msg-1',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderRefundCreatedPayload>;
    mocks.salesOrders.getOne.mockResolvedValue({ id: payload.orderId, status: 'pending' } as any);

    await consumer.handleOrderRefundCreated(payload, refundEnvelope);

    expect(mocks.txInserts).toHaveLength(2);
    expect(mocks.txInserts[0].values).toMatchObject({
      eventId: 'refund-msg-1',
      orderId: payload.orderId,
      eventType: 'ORDER_REFUND_CREATED',
    });
    expect(mocks.txInserts[1].values).toMatchObject({
      sourceType: 'sales_order',
      sourceId: payload.orderId,
      targetType: 'wallet_refund',
      targetExternalRef: 'medusa:refund:ref_1',
      relationName: 'order_lifecycle_refund_collected',
      metadata: expect.objectContaining({
        paymentId: 'pay_1',
        amount: 12000,
        currency: 'KRW',
        refundStatus: 'collected',
        sourceEventId: 'refund-msg-1',
      }),
    });
  });

  it('OrderRefundCreated 가 새 messageId 로 재전달돼도 동일 refundId timeline 링크를 중복 생성하지 않는다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-refunded-1',
      refundId: 'ref_1',
      paymentId: 'pay_1',
      amount: 12000,
      currency: 'KRW',
      reason: 'MEDUSA_REFUND',
      createdBy: 'medusa',
      createdAt: '2026-05-26T01:18:00.000Z',
    } as OrderRefundCreatedPayload;
    // 같은 refund 가 새 messageId 로 다시 발행됨 (outbox 가 Kafka 발행 후 inbox published 마킹 전에 크래시 → 재발행)
    const refundEnvelope = {
      messageId: 'refund-msg-REDELIVERED',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderRefundCreatedPayload>;
    mocks.salesOrders.getOne.mockResolvedValue({ id: payload.orderId, status: 'pending' } as any);
    // 동일 (sourceId, relationName, targetExternalRef) 링크가 이전 전달에서 이미 기록돼 있음
    mocks.businessLinkRows.push({ id: 'existing-link-1' });

    await consumer.handleOrderRefundCreated(payload, refundEnvelope);

    // messageId 가 새 것이라 orderEvents 처리 이력은 남지만, 안정 키 가드가 business_links 중복 insert 를 막는다.
    expect(
      mocks.txInserts.some((insert) => (insert.values as any).relationName === 'order_lifecycle_refund_collected'),
    ).toBe(false);
  });

  it('OrderRefundCreated 대상 SalesOrder 가 없으면 lifecycle 신호를 재시도 가능하게 실패시킨다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload = {
      orderId: 'so-missing-refund-1',
      refundId: 'ref_1',
      paymentId: 'pay_1',
      amount: 12000,
      currency: 'KRW',
      reason: 'MEDUSA_REFUND',
      createdBy: 'medusa',
      createdAt: '2026-05-26T01:18:00.000Z',
    } as OrderRefundCreatedPayload;
    const refundEnvelope = {
      messageId: 'refund-msg-missing-1',
      correlationId: 'corr-1',
    } as MessageEnvelope<OrderRefundCreatedPayload>;
    mocks.salesOrders.getOne.mockResolvedValue(undefined as any);

    await expect(consumer.handleOrderRefundCreated(payload, refundEnvelope)).rejects.toThrow(
      'Sales order so-missing-refund-1 not found for OrderRefundCreated',
    );

    expect(mocks.txInserts).toHaveLength(0);
  });
});
