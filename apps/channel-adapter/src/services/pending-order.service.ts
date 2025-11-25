import { Injectable, Logger } from '@nestjs/common';
import { PendingOrderRepository } from './pending-order.repository';
import { OrderEventPublisher } from './order-event.publisher';
import { ChannelListingClient } from './clients/channel-listing.client';
import { InternalOrderEvent, PendingOrder, UnmappedItem } from '../types';

/**
 * 계류 주문 서비스
 *
 * 책임:
 * - 미매핑 주문의 계류 처리
 * - 매핑 완료 후 재처리
 */
@Injectable()
export class PendingOrderService {
  private readonly logger = new Logger(PendingOrderService.name);

  constructor(
    private readonly pendingOrderRepository: PendingOrderRepository,
    private readonly orderEventPublisher: OrderEventPublisher,
    private readonly channelListingClient: ChannelListingClient,
  ) {}

  /**
   * 미매핑 주문을 계류 상태로 저장
   */
  async savePendingOrder(
    channel: 'naver_smartstore' | 'coupang',
    orderEvent: InternalOrderEvent,
    unmappedItems: UnmappedItem[],
  ): Promise<PendingOrder> {
    // 이미 존재하는지 확인
    const exists = await this.pendingOrderRepository.exists(
      channel,
      orderEvent.externalOrderId,
    );

    if (exists) {
      this.logger.warn(
        `⚠️ 이미 계류 중인 주문: ${channel}/${orderEvent.externalOrderId}`,
      );
      const existing = await this.pendingOrderRepository.findByChannelOrder(
        channel,
        orderEvent.externalOrderId,
      );
      return existing!;
    }

    return await this.pendingOrderRepository.save({
      channel,
      externalOrderId: orderEvent.externalOrderId,
      unmappedItems,
      rawOrderEvent: orderEvent,
    });
  }

  /**
   * 특정 채널 상품 ID가 매핑된 후 관련 계류 주문 재처리
   */
  async retryPendingOrdersForItem(channelItemId: string): Promise<number> {
    const pendingOrders =
      await this.pendingOrderRepository.findByUnmappedItem(channelItemId);

    if (pendingOrders.length === 0) {
      this.logger.debug(`재처리할 계류 주문 없음: ${channelItemId}`);
      return 0;
    }

    let processedCount = 0;

    for (const order of pendingOrders) {
      try {
        const result = await this.retryOrder(order);
        if (result) {
          processedCount++;
        }
      } catch (error) {
        this.logger.error(
          `❌ 계류 주문 재처리 실패: ${order.id}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    this.logger.log(
      `✅ 채널 상품 ${channelItemId} 매핑 후 ${processedCount}/${pendingOrders.length}건 재처리 완료`,
    );

    return processedCount;
  }

  /**
   * 특정 계류 주문 재처리
   */
  async retryOrderById(orderId: string): Promise<boolean> {
    const order = await this.pendingOrderRepository.findById(orderId);
    if (!order) {
      this.logger.warn(`계류 주문 없음: ${orderId}`);
      return false;
    }

    return await this.retryOrder(order);
  }

  /**
   * 계류 주문 재처리
   */
  private async retryOrder(order: PendingOrder): Promise<boolean> {
    const rawEvent = order.rawOrderEvent as unknown as InternalOrderEvent;
    const channel = order.channel as 'naver_smartstore' | 'coupang';
    const channelCode = this.channelListingClient.getChannelCodeFromType(channel);

    // processing 상태로 변경
    await this.pendingOrderRepository.markAsProcessing(order.id);

    try {
      // 모든 미매핑 항목에 대해 매핑 재조회
      const stillUnmapped: UnmappedItem[] = [];

      for (const item of order.unmappedItems) {
        const listing = await this.channelListingClient.lookupByChannelCode(
          channelCode,
          item.channelItemId,
        );

        if (!listing) {
          stillUnmapped.push(item);
        }
      }

      if (stillUnmapped.length > 0) {
        // 아직 미매핑 항목이 있음 → 다시 계류 상태로
        await this.pendingOrderRepository.updateUnmappedItems(
          order.id,
          stillUnmapped,
        );
        await this.pendingOrderRepository.markAsFailed(
          order.id,
          `Still ${stillUnmapped.length} unmapped items`,
        );
        return false;
      }

      // 모든 항목이 매핑됨 → 이벤트 발행
      const result = await this.orderEventPublisher.publishOrderConfirmed(
        channel,
        rawEvent,
      );

      if (result.published) {
        await this.pendingOrderRepository.markAsProcessed(order.id);
        this.logger.log(
          `✅ 계류 주문 처리 완료: ${order.channel}/${order.externalOrderId}`,
        );
        return true;
      } else {
        await this.pendingOrderRepository.markAsFailed(
          order.id,
          result.pendingReason || 'Failed to publish',
        );
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.pendingOrderRepository.markAsFailed(order.id, errorMessage);
      throw error;
    }
  }

  /**
   * 상태별 계류 주문 수 조회
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    return await this.pendingOrderRepository.countByStatus();
  }

  /**
   * 계류 중인 주문 목록 조회
   */
  async getPendingOrders(options?: {
    channel?: string;
    limit?: number;
    offset?: number;
  }): Promise<PendingOrder[]> {
    return await this.pendingOrderRepository.findByStatus('pending_mapping', options);
  }

  /**
   * 실패한 주문 목록 조회
   */
  async getFailedOrders(options?: {
    channel?: string;
    limit?: number;
    offset?: number;
  }): Promise<PendingOrder[]> {
    return await this.pendingOrderRepository.findByStatus('failed', options);
  }

  /**
   * 완료된 오래된 계류 주문 정리
   */
  async cleanupCompletedOrders(olderThanDays: number = 30): Promise<number> {
    return await this.pendingOrderRepository.cleanupCompleted(olderThanDays);
  }
}

