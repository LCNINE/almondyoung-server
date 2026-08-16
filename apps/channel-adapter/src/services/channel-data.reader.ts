import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapterFactory, ChannelType } from '../adapters/channel-adapter.factory';
import { InternalOrderEvent, OrderQuery, ChannelQuery } from '../types';

/**
 * 네이버·쿠팡 **조회 전용** 어댑터 호출.
 *
 * 수집(`fetchFromChannel`)과 웹훅(`processWebhook`), 채널 쓰기(`sendToChannel`)는 제거됐다.
 * 수집의 canonical 경로는 `OrderPollerOrchestrator` 이고(ADR-0013), 채널 mutation 은
 * 출고 경로 하나로 모은다.
 *
 * 특징: 부작용 없음 · DB 접근 없음 · 순수하게 어댑터 조회 위임.
 */
@Injectable()
export class ChannelDataReader {
  private readonly logger = new Logger(ChannelDataReader.name);

  constructor(private readonly adapterFactory: ChannelAdapterFactory) {}

  /**
   * 주문 조회 (운영자가 채널 원본을 확인할 때 쓴다)
   */
  async findOrders(channel: ChannelType, query: OrderQuery): Promise<InternalOrderEvent[]> {
    this.logger.log(`🔍 [${channel}] 주문 조회: ${query.by} = ${query.id}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    return adapter.findOrders(query);
  }

  /**
   * 채널 쿼리 실행 (교환 요청 목록, 배송 이력 등)
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    this.logger.log(`🔍 [${channel}] 쿼리 실행: ${query.type}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    return adapter.executeQuery(query);
  }
}
