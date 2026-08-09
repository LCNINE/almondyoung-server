/**
 * Order Event Publisher (공용 아웃박스, ADR-0029 §5-1 Task 6-C-3)
 *
 * Channel Adapter에서 발생하는 주문 이벤트를 아웃박스를 통해 Kafka로 발행합니다.
 * WMS OrderEventsConsumer가 이 이벤트를 구독하여 Sales Order를 생성합니다.
 *
 * 적재 대상은 `event.outbox_events`(공용)다. 옛 경로는 `inbox_events` 에 `aggregate_type =
 * 'ChannelAdapter'` 행을 쓰고 앱 자체 아웃박스 디스패처가 그것을 발행했는데(6-C-4 에서 삭제), 그
 * 경로에는 **적재 시점 검증이 없었다** — 계약 위반 payload 가 poison row 로 남아 재시도를
 * 소진했다. `enqueue` 는 zod 를 먼저 태우므로 위반이 호출자의 도메인 트랜잭션에서 드러난다.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ORDER_STREAM,
  OrderCreatedPayload,
  OrderCancelledPayload,
  OrderModifiedPayload,
  SalesChannel,
  OrderItem,
  ShippingAddress,
} from '@packages/event-contracts/streams';
import { InjectPublisher, PublisherFor } from '@app/events';
import { InternalOrderEvent, UnmappedItem } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { ChannelListingClient, LookupVariantResult } from './clients/channel-listing.client';
import { DbService } from '@app/db';
import { channelAdapterSchema } from '../types';

// DbTx 타입 정의
type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

export interface PublishResult {
  published: boolean;
  pendingReason?: string;
  unmappedItems?: UnmappedItem[];
}

type ExternalLineIdentity = {
  orderItemId?: string;
  channelProductId?: string;
  lookupId?: string;
};

function nonEmptyExternalId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getExternalLineIdentity(orderEvent: InternalOrderEvent): ExternalLineIdentity {
  const orderItemId = nonEmptyExternalId(orderEvent.externalProductOrderId);
  const channelProductId = nonEmptyExternalId(orderEvent.productId);
  return {
    orderItemId,
    channelProductId,
    // Lookup compatibility is not persisted as provider identity. Older events
    // may only carry their order-line ID, so it can still locate a mapping while
    // channelProductId remains absent and V2 planning stays blocked.
    lookupId: channelProductId ?? orderItemId,
  };
}

@Injectable()
export class OrderEventPublisher {
  private readonly logger = new Logger(OrderEventPublisher.name);

  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    private readonly channelListingClient: ChannelListingClient,
    @InjectPublisher(ORDER_STREAM)
    private readonly ordersPublisher: PublisherFor<typeof ORDER_STREAM>,
  ) {
    this.logger.log('📤 OrderEventPublisher 초기화 완료 (공용 아웃박스)');
  }

  /**
   * 아웃박스 적재 대상. 호출자가 트랜잭션을 주면 거기에, 아니면 커넥션에 직접 쓴다.
   *
   * 옛 `InboxService.enqueue` 는 tx 가 없을 때 **자기 트랜잭션을 열었다**. insert 한 문이라
   * 트랜잭션이 더 보장하는 것이 없어 그대로 커넥션에 쓴다 — 공용 `DbTx` 가
   * `Pick<PostgresJsDatabase, 'insert'>` 인 것도 같은 이유다.
   */
  private writer(tx?: DbTx) {
    return tx ?? this.db.db;
  }

  /**
   * 채널 타입을 SalesChannel로 매핑
   */
  private mapChannelToSalesChannel(channel: 'naver_smartstore' | 'coupang' | string): SalesChannel {
    switch (channel) {
      case 'naver_smartstore':
        return 'naver';
      case 'coupang':
        return 'coupang';
      default:
        return 'naver'; // 기본값
    }
  }

  /**
   * 주문 확정 이벤트 발행 (매핑 자동 조회)
   *
   * 채널 상품 ID → PIM Variant ID 매핑을 조회하고:
   * - 모든 항목이 매핑됨: OrderCreated 이벤트를 Outbox에 enqueue
   * - 일부 미매핑: 미매핑 항목 정보 반환 (호출자가 계류 처리)
   *
   * @param channel - 채널 타입
   * @param orderEvent - 주문 이벤트
   * @param tx - 트랜잭션 컨텍스트 (선택적)
   */
  async publishOrderConfirmed(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    tx?: DbTx,
  ): Promise<PublishResult> {
    const channelCode = this.channelListingClient.getChannelCodeFromType(channel);

    const identity = getExternalLineIdentity(orderEvent);
    if (!identity.lookupId) {
      return { published: false, pendingReason: 'missing_external_product_identity', unmappedItems: [] };
    }

    // 매핑 조회
    const listing = await this.channelListingClient.lookupByChannelCode(channelCode, identity.lookupId);

    if (!listing) {
      // 매핑 없음 → 계류 필요
      const unmappedItems: UnmappedItem[] = [
        {
          channelItemId: identity.lookupId,
          channelItemName: orderEvent.productName ?? 'Unknown Product',
          channelOptionName: orderEvent.optionName,
        },
      ];

      this.logger.warn(`⏸️ 미매핑 주문 계류: ${orderEvent.externalOrderId} - ${identity.lookupId}`);

      return {
        published: false,
        pendingReason: 'unmapped_items',
        unmappedItems,
      };
    }

    // 매핑 있음 → Outbox에 이벤트 enqueue
    await this.enqueueOrderCreated(channel, orderEvent, listing, tx);

    return { published: true };
  }

  /**
   * 매핑 정보를 사용하여 주문 생성 이벤트를 Outbox에 enqueue
   */
  private async enqueueOrderCreated(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    listing: LookupVariantResult,
    tx?: DbTx,
  ): Promise<void> {
    const salesChannel = this.mapChannelToSalesChannel(channel);
    const orderId = uuidv4();

    const identity = getExternalLineIdentity(orderEvent);

    const items: OrderItem[] = [
      {
        ...(identity.orderItemId ? { orderItemId: identity.orderItemId } : {}),
        skuId: listing.variantId,
        masterId: listing.masterId,
        versionId: listing.versionId,
        variantId: listing.variantId,
        productName: listing.productName,
        ...(identity.channelProductId ? { channelProductId: identity.channelProductId } : {}),
        quantity: orderEvent.quantity ?? 1,
        unitPrice: orderEvent.priceAmount ?? 0,
        totalPrice: orderEvent.priceAmount ?? 0,
      },
    ];

    const shippingAddress: ShippingAddress = {
      recipientName: orderEvent.buyer?.name ?? 'Unknown',
      phone: orderEvent.buyer?.contact ?? '',
      postalCode: orderEvent.buyer?.address?.postalCode ?? '',
      roadAddress: orderEvent.buyer?.address?.roadAddress ?? '',
      detailAddress: orderEvent.buyer?.address?.detailAddress ?? '',
      deliveryNote: undefined,
    };

    const payload: OrderCreatedPayload = {
      orderId,
      externalOrderId: orderEvent.externalOrderId,
      salesChannel,
      // 비-로그인 외부 채널(Naver/Coupang)은 내부 user-service 계정이 없다. 이름은 customerId 가 아니므로 null.
      customerId: null,
      items,
      totalAmount: orderEvent.priceAmount ?? 0,
      subtotalAmount: orderEvent.priceAmount ?? 0,
      shippingAmount: 0,
      discountAmount: orderEvent.discountAmount ?? 0,
      currency: 'KRW',
      shippingAddress,
      status: 'confirmed',
      createdAt: orderEvent.createdAt ?? new Date().toISOString(),
    };

    // 공용 아웃박스에 적재 (트랜잭션 내에서 호출 가능).
    //
    // `partitionKey` 를 **명시**한다. ORDER_STREAM 에는 파생 함수가 없어 생략하면
    // `aggregateId`(= externalOrderId) 로 떨어지는데, 옛 디스패처는 행의 `partition_key`
    // (= 채널명)를 Kafka 키로 썼다. 생략하면 주문마다 파티션이 흩어져 **채널 단위 순서가
    // 조용히 사라진다.**
    //
    // `metadata` 는 `{ orderId, salesChannel, variantId }` 를 싣지 않는다 — 옛 디스패처가
    // 행의 metadata 컬럼을 읽지 않고 `{ partitionKey }` 만 envelope 에 넣었기 때문이다
    // (`outbox-dispatcher.service.ts:171`). 이 조각은 회수이지 개선이 아니므로 나가는
    // envelope 를 그대로 유지한다. 그 세 값은 로그로 남는다.
    await this.ordersPublisher.enqueue(
      {
        eventType: 'OrderCreated',
        aggregateId: orderEvent.externalOrderId,
        payload,
        partitionKey: channel,
        metadata: { partitionKey: channel },
      },
      this.writer(tx),
    );

    this.logger.log(`📤 [OrderCreated] Enqueued to outbox: ${orderEvent.externalOrderId} from ${channel}`, {
      orderId,
      salesChannel,
      variantId: listing.variantId,
    });
  }

  /**
   * 주문 취소 이벤트를 Outbox에 enqueue
   */
  async publishOrderCancelled(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    reason: string = 'CUSTOMER_REQUEST',
    cancelledBy: 'customer' | 'seller' | 'system' = 'customer',
    tx?: DbTx,
  ): Promise<void> {
    const salesChannel = this.mapChannelToSalesChannel(channel);

    const payload: OrderCancelledPayload = {
      orderId: orderEvent.internalOrderId ?? orderEvent.externalOrderId,
      reason: this.mapCancelReason(reason),
      reasonDetail: orderEvent.reason,
      cancelledBy: cancelledBy === 'customer' ? 'CUSTOMER' : 'ADMIN',
      cancelledAt: new Date().toISOString(),
      refundRequired: true,
      refundAmount: orderEvent.priceAmount,
    };

    // 공용 아웃박스에 적재. partitionKey·metadata 근거는 `enqueueOrderCreated` 주석 참조.
    await this.ordersPublisher.enqueue(
      {
        eventType: 'OrderCancelled',
        aggregateId: orderEvent.externalOrderId,
        payload,
        partitionKey: channel,
        metadata: { partitionKey: channel },
      },
      this.writer(tx),
    );

    this.logger.log(`📤 [OrderCancelled] Enqueued to outbox: ${orderEvent.externalOrderId} from ${channel}`, {
      reason,
      cancelledBy,
    });
  }

  /**
   * 주문 수정 이벤트를 Outbox에 enqueue
   */
  async publishOrderModified(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    changes: {
      shippingAddress?: ShippingAddress;
      items?: OrderItem[];
      totalAmount?: number;
    },
    modifiedBy: 'customer' | 'seller' | 'system' = 'customer',
    tx?: DbTx,
  ): Promise<void> {
    const payload: OrderModifiedPayload = {
      orderId: orderEvent.internalOrderId ?? orderEvent.externalOrderId,
      changes: {
        shippingAddress: changes.shippingAddress,
        items: changes.items,
        totalAmount: changes.totalAmount,
      },
      modifiedBy: modifiedBy === 'customer' ? 'CUSTOMER' : 'ADMIN',
      modifiedAt: new Date().toISOString(),
      reason: orderEvent.reason,
    };

    // 공용 아웃박스에 적재. partitionKey·metadata 근거는 `enqueueOrderCreated` 주석 참조.
    await this.ordersPublisher.enqueue(
      {
        eventType: 'OrderModified',
        aggregateId: orderEvent.externalOrderId,
        payload,
        partitionKey: channel,
        metadata: { partitionKey: channel },
      },
      this.writer(tx),
    );

    this.logger.log(`📤 [OrderModified] Enqueued to outbox: ${orderEvent.externalOrderId} from ${channel}`, {
      modifiedBy,
      hasAddressChange: !!changes.shippingAddress,
    });
  }

  /**
   * 취소 사유 매핑
   */
  private mapCancelReason(
    reason: string,
  ): 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT' {
    const reasonMap: Record<
      string,
      'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT'
    > = {
      CUSTOMER_REQUEST: 'CUSTOMER_REQUEST',
      OUT_OF_STOCK: 'OUT_OF_STOCK',
      PAYMENT_FAILED: 'PAYMENT_FAILED',
      SELLER_REQUEST: 'ADMIN_CANCEL',
      ADMIN_CANCEL: 'ADMIN_CANCEL',
      TIMEOUT: 'TIMEOUT',
    };

    return reasonMap[reason] ?? 'CUSTOMER_REQUEST';
  }
}
