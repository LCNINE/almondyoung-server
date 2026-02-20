/**
 * Order Event Publisher
 *
 * Channel Adapter에서 발생하는 주문 이벤트를 Kafka로 발행합니다.
 * WMS OrderEventsConsumer가 이 이벤트를 구독하여 Sales Order를 생성합니다.
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher, ExtractPayloadType } from '@app/events';
import {
  ORDER_STREAM,
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

type OrderEvents = typeof ORDER_STREAM.events;

export interface PublishResult {
  published: boolean;
  pendingReason?: string;
  unmappedItems?: UnmappedItem[];
}

@Injectable()
export class OrderEventPublisher {
  private readonly logger = new Logger(OrderEventPublisher.name);

  constructor(
    @InjectStreamPublisher('orders.events.v1')
    private readonly ordersPublisher: StreamPublisher<OrderEvents>,
    private readonly channelListingClient: ChannelListingClient,
  ) {
    this.logger.log('📤 OrderEventPublisher 초기화 완료');
  }

  /**
   * 채널 타입을 SalesChannel로 매핑
   */
  private mapChannelToSalesChannel(
    channel: 'naver_smartstore' | 'coupang' | string,
  ): SalesChannel {
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
   * - 모든 항목이 매핑됨: OrderCreated 이벤트 발행
   * - 일부 미매핑: 미매핑 항목 정보 반환 (호출자가 계류 처리)
   */
  async publishOrderConfirmed(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
  ): Promise<PublishResult> {
    const channelCode = this.channelListingClient.getChannelCodeFromType(channel);

    // 채널 상품 ID 추출
    const channelProductId =
      orderEvent.externalProductOrderId ?? orderEvent.externalOrderId;

    // 매핑 조회
    const listing = await this.channelListingClient.lookupByChannelCode(
      channelCode,
      channelProductId,
    );

    if (!listing) {
      // 매핑 없음 → 계류 필요
      const unmappedItems: UnmappedItem[] = [
        {
          channelItemId: channelProductId,
          channelItemName: orderEvent.productName ?? 'Unknown Product',
          channelOptionName: orderEvent.optionName,
        },
      ];

      this.logger.warn(
        `⏸️ 미매핑 주문 계류: ${orderEvent.externalOrderId} - ${channelProductId}`,
      );

      return {
        published: false,
        pendingReason: 'unmapped_items',
        unmappedItems,
      };
    }

    // 매핑 있음 → 이벤트 발행
    await this.publishOrderCreatedWithMapping(channel, orderEvent, listing);

    return { published: true };
  }

  /**
   * 매핑 정보를 사용하여 주문 생성 이벤트 발행
   */
  private async publishOrderCreatedWithMapping(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    listing: LookupVariantResult,
  ): Promise<void> {
    const salesChannel = this.mapChannelToSalesChannel(channel);
    const orderId = uuidv4();

    const channelProductId =
      orderEvent.externalProductOrderId ?? orderEvent.externalOrderId;

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
      userId: orderEvent.buyer?.name ?? 'guest',
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

    await this.ordersPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: orderEvent.externalOrderId,
      payload,
    });

    this.logger.log(
      `📤 [OrderCreated] Published: ${orderEvent.externalOrderId} from ${channel}`,
      { orderId, salesChannel, variantId: listing.variantId },
    );
  }

  /**
   * 주문 생성 이벤트 발행 (레거시 - variantIdMapper 콜백 사용)
   *
   * 채널에서 새 주문이 확정되면 WMS에 알리기 위해 이벤트를 발행합니다.
   * @deprecated publishOrderConfirmed를 대신 사용하세요
   */
  async publishOrderCreated(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    variantIdMapper?: (channelProductId: string) => Promise<LookupVariantResult | string | null>,
  ): Promise<void> {
    const salesChannel = this.mapChannelToSalesChannel(channel);
    const orderId = uuidv4();

    // 주문 라인 아이템 변환
    const channelCode = this.channelListingClient.getChannelCodeFromType(channel);
    const fallbackMapper = async (channelProductId: string) => {
      return this.channelListingClient.lookupByChannelCode(channelCode, channelProductId);
    };
    const items: OrderItem[] = await this.transformOrderItems(
      orderEvent,
      variantIdMapper ?? fallbackMapper,
    );

    // 배송 주소 변환
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
      userId: orderEvent.buyer?.name ?? 'guest',
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

    await this.ordersPublisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: orderEvent.externalOrderId,
      payload,
    });

    this.logger.log(
      `📤 [OrderCreated] Published: ${orderEvent.externalOrderId} from ${channel}`,
      { orderId, salesChannel, itemCount: items.length },
    );
  }

  /**
   * 주문 취소 이벤트 발행
   */
  async publishOrderCancelled(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    reason: string = 'CUSTOMER_REQUEST',
    cancelledBy: 'customer' | 'seller' | 'system' = 'customer',
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

    await this.ordersPublisher.publishEvent({
      eventType: 'OrderCancelled',
      aggregateId: orderEvent.externalOrderId,
      payload,
    });

    this.logger.log(
      `📤 [OrderCancelled] Published: ${orderEvent.externalOrderId} from ${channel}`,
      { reason, cancelledBy },
    );
  }

  /**
   * 주문 수정 이벤트 발행
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

    await this.ordersPublisher.publishEvent({
      eventType: 'OrderModified',
      aggregateId: orderEvent.externalOrderId,
      payload,
    });

    this.logger.log(
      `📤 [OrderModified] Published: ${orderEvent.externalOrderId} from ${channel}`,
      { modifiedBy, hasAddressChange: !!changes.shippingAddress },
    );
  }

  /**
   * 주문 라인 아이템 변환
   *
   * variantIdMapper가 제공되면 채널 상품 ID를 PIM variantId로 매핑합니다.
   * 매핑 실패 시 채널 상품 ID를 그대로 사용합니다.
   */
  private async transformOrderItems(
    orderEvent: InternalOrderEvent,
    variantIdMapper?: (channelProductId: string) => Promise<LookupVariantResult | string | null>,
  ): Promise<OrderItem[]> {
    const channelProductId =
      orderEvent.externalProductOrderId ?? orderEvent.externalOrderId;

    // variantId 매핑 시도
    let skuId = channelProductId;
    let variantId: string | undefined;
    let masterId: string | undefined;
    let versionId: string | undefined;
    let productName: string | undefined;

    if (variantIdMapper) {
      try {
        const mapped = await variantIdMapper(channelProductId);
        if (mapped) {
          if (typeof mapped === 'string') {
            variantId = mapped;
            skuId = mapped;
          } else {
            variantId = mapped.variantId;
            skuId = mapped.variantId;
            masterId = mapped.masterId;
            versionId = mapped.versionId;
            productName = mapped.productName;
          }
        } else {
          this.logger.warn(
            `⚠️ variantId 매핑 실패: ${channelProductId}, 채널 ID 사용`,
          );
        }
      } catch (error) {
        this.logger.error(
          `❌ variantId 매핑 오류: ${channelProductId}`,
          error.message,
        );
      }
    }

    if (!variantId || !masterId || !versionId || !productName) {
      throw new Error(`Missing required product mapping for ${channelProductId}`);
    }

    return [
      {
        orderItemId: channelProductId,
        skuId,
        masterId,
        versionId,
        variantId,
        productName,
        channelProductId,
        quantity: orderEvent.quantity ?? 1,
        unitPrice: orderEvent.priceAmount ?? 0,
        totalPrice: orderEvent.priceAmount ?? 0,
      },
    ];
  }

  /**
   * 취소 사유 매핑
   */
  private mapCancelReason(
    reason: string,
  ): 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT' {
    const reasonMap: Record<string, 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT'> = {
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
