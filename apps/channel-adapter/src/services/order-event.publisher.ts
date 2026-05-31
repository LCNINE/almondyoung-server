/**
 * Order Event Publisher (Inbox Pattern 적용)
 *
 * Channel Adapter에서 발생하는 주문 이벤트를 Inbox를 통해 Kafka로 발행합니다.
 * WMS OrderEventsConsumer가 이 이벤트를 구독하여 Sales Order를 생성합니다.
 *
 * @see order-event.publisher.legacy.ts - 원본 직접 발행 버전
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  OrderCreatedPayload,
  OrderCancelledPayload,
  OrderModifiedPayload,
  SalesChannel,
  OrderItem,
  ShippingAddress,
} from '@packages/event-contracts/streams';
import { InternalOrderEvent, UnmappedItem } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { ChannelListingClient, LookupVariantResult } from './clients/channel-listing.client';
import { InboxService } from './inbox.service';
import { DbService } from '@app/db';
import { channelAdapterSchema } from '../types';

// DbTx 타입 정의
type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

export interface PublishResult {
  published: boolean;
  pendingReason?: string;
  unmappedItems?: UnmappedItem[];
}

@Injectable()
export class OrderEventPublisher {
  private readonly logger = new Logger(OrderEventPublisher.name);

  constructor(
    private readonly inboxService: InboxService,
    private readonly channelListingClient: ChannelListingClient,
  ) {
    this.logger.log('📤 OrderEventPublisher 초기화 완료 (Inbox Pattern)');
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

    // 채널 상품 ID 추출
    const channelProductId = orderEvent.externalProductOrderId ?? orderEvent.externalOrderId;

    // 매핑 조회
    const listing = await this.channelListingClient.lookupByChannelCode(channelCode, channelProductId);

    if (!listing) {
      // 매핑 없음 → 계류 필요
      const unmappedItems: UnmappedItem[] = [
        {
          channelItemId: channelProductId,
          channelItemName: orderEvent.productName ?? 'Unknown Product',
          channelOptionName: orderEvent.optionName,
        },
      ];

      this.logger.warn(`⏸️ 미매핑 주문 계류: ${orderEvent.externalOrderId} - ${channelProductId}`);

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

    const channelProductId = orderEvent.externalProductOrderId ?? orderEvent.externalOrderId;

    const items: OrderItem[] = [
      {
        orderItemId: channelProductId,
        skuId: listing.variantId,
        masterId: listing.masterId,
        versionId: listing.versionId,
        variantId: listing.variantId,
        productName: listing.productName,
        channelProductId,
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

    // Inbox에 enqueue (트랜잭션 내에서 호출 가능)
    // aggregateType은 'ChannelAdapter'로 통일 (동영님 의견: 채널 어댑터 서비스 자체가 aggregateType)
    // OutboxDispatcherService가 eventType으로 orders.events.v1 또는 channel-adapter.events.v1로 분기
    await this.inboxService.enqueue(
      {
        eventType: 'OrderCreated',
        aggregateId: orderEvent.externalOrderId,
        partitionKey: channel,
        payload,
        aggregateType: 'ChannelAdapter', // 채널 어댑터 서비스에서 발행한 이벤트
        metadata: {
          orderId,
          salesChannel,
          variantId: listing.variantId,
        },
      },
      tx,
    );

    this.logger.log(`📤 [OrderCreated] Enqueued to Inbox: ${orderEvent.externalOrderId} from ${channel}`, {
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

    // Inbox에 enqueue
    await this.inboxService.enqueue(
      {
        eventType: 'OrderCancelled',
        aggregateId: orderEvent.externalOrderId,
        partitionKey: channel,
        payload,
        aggregateType: 'ChannelAdapter', // 채널 어댑터 서비스에서 발행한 이벤트
        metadata: {
          reason,
          cancelledBy,
        },
      },
      tx,
    );

    this.logger.log(`📤 [OrderCancelled] Enqueued to Inbox: ${orderEvent.externalOrderId} from ${channel}`, {
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

    // Inbox에 enqueue
    await this.inboxService.enqueue(
      {
        eventType: 'OrderModified',
        aggregateId: orderEvent.externalOrderId,
        partitionKey: channel,
        payload,
        aggregateType: 'ChannelAdapter', // 채널 어댑터 서비스에서 발행한 이벤트
        metadata: {
          modifiedBy,
          hasAddressChange: !!changes.shippingAddress,
        },
      },
      tx,
    );

    this.logger.log(`📤 [OrderModified] Enqueued to Inbox: ${orderEvent.externalOrderId} from ${channel}`, {
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
