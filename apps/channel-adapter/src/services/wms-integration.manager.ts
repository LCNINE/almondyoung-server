import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelAdapterFactory,
  ChannelType,
} from './adapters/channel-adapter.factory';
import { ChannelAdapterRepository } from './channel-adapter.repository';
import { InternalOrderEvent } from '../types';
import { SalesOrder } from './apis/wms.api.service';
import { ChannelAdapterValidator } from '../validators/channel-adapter.validator';

/**
 * WMS 연동 Manager
 *
 * 책임:
 * - WMS 주문 생성/취소/교환 처리
 * - 검증 로직 (Manager 책임!)
 * - WMS 매핑 저장 (Repository 호출)
 * - 이벤트 로그
 *
 * 특징:
 * - 비즈니스 로직 포함
 * - 검증 로직 포함
 * - DB 접근 (Repository 통해서만)
 */
@Injectable()
export class WmsIntegrationManager {
  private readonly logger = new Logger(WmsIntegrationManager.name);

  constructor(
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly repo: ChannelAdapterRepository,
  ) {}

  /**
   * WMS 주문 생성
   *
   * 책임: 검증 + WMS 전달 + 매핑 저장
   *
   * @param channel - 대상 채널
   * @param orderEvent - 주문 이벤트
   * @returns WMS 주문 정보
   */
  async createOrder(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
  ): Promise<SalesOrder> {
    const operationId = `CREATE_ORDER_WMS:${channel}:${orderEvent.externalOrderId}`;

    // 1️⃣ 검증 (Manager 책임!)
    ChannelAdapterValidator.validateOrderEvent(orderEvent);

    this.logger.log(
      `🏭 [${channel}→WMS] 주문 생성: ${orderEvent.externalOrderId}`,
      { operationId },
    );

    let wmsOrder: SalesOrder;

    try {
      // 2️⃣ WMS에 주문 생성
      const adapter = this.adapterFactory.getAdapter(channel);
      wmsOrder = await adapter.createOrderInWms(orderEvent);
    } catch (error) {
      throw new Error(`WMS order creation failed: ${error.message}`);
    }

    try {
      // 3️⃣ 매핑 저장
      await this.repo.saveWmsMapping({
        salesChannel: channel,
        channelOrderId: orderEvent.externalOrderId,
        wmsOrderId: wmsOrder.id,
      });

      // 4️⃣ 이벤트 로그
      await this.repo.logWmsEvent({
        channel,
        type: 'order_created_in_wms',
        channelOrderId: orderEvent.externalOrderId,
        wmsOrderId: wmsOrder.id,
      });
    } catch (error) {
      // 보상 트랜잭션: 매핑 저장 실패 시 로깅
      this.logger.error(
        `Failed to save WMS mapping for order ${wmsOrder.id}. Manual intervention may be required.`,
        {
          channel,
          channelOrderId: orderEvent.externalOrderId,
          wmsOrderId: wmsOrder.id,
          error: error.message,
        },
      );
      // WMS 주문은 이미 생성되었으므로 성공으로 간주하되, 매핑 실패를 알림
    }

    this.logger.log(`✅ [${channel}→WMS] 주문 생성 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }

  /**
   * WMS 주문 취소
   *
   * @param channel - 대상 채널
   * @param orderEvent - 주문 이벤트
   * @param reason - 취소 사유
   * @returns WMS 주문 정보
   */
  async cancelOrder(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
    reason?: string,
  ): Promise<SalesOrder> {
    // 검증
    ChannelAdapterValidator.validateOrderEvent(orderEvent);

    this.logger.log(
      `❌ [${channel}→WMS] 주문 취소: ${orderEvent.externalOrderId}`,
      { reason },
    );

    // WMS 취소 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const wmsOrder = await adapter.cancelOrderInWms(orderEvent, reason);

    // 이벤트 로그
    await this.repo.logWmsEvent({
      channel,
      type: 'order_cancelled_in_wms',
      channelOrderId: orderEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
      reason,
    });

    this.logger.log(`✅ [${channel}→WMS] 주문 취소 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }

  /**
   * WMS 교환 처리
   *
   * @param channel - 대상 채널
   * @param exchangeEvent - 교환 이벤트
   * @returns WMS 주문 정보
   */
  async processExchange(
    channel: ChannelType,
    exchangeEvent: InternalOrderEvent,
  ): Promise<SalesOrder> {
    // 검증
    ChannelAdapterValidator.validateOrderEvent(exchangeEvent);

    this.logger.log(
      `🔄 [${channel}→WMS] 교환 처리: ${exchangeEvent.externalOrderId}`,
    );

    // WMS 교환 실행
    const adapter = this.adapterFactory.getAdapter(channel);
    const wmsOrder = await adapter.processExchangeInWms(exchangeEvent);

    // 이벤트 로그
    await this.repo.logWmsEvent({
      channel,
      type: 'exchange_processed_in_wms',
      channelOrderId: exchangeEvent.externalOrderId,
      wmsOrderId: wmsOrder.id,
      claimId: exchangeEvent.claimInfo?.claimId,
    });

    this.logger.log(`✅ [${channel}→WMS] 교환 처리 성공: ${wmsOrder.id}`);

    return wmsOrder;
  }
}
