import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelAdapterFactory,
  ChannelType,
} from '../adapters/channel-adapter.factory';
import {
  InternalOrderEvent,
  DataType,
  SyncToChannelPayload,
  SyncResult,
  OrderQuery,
  ChannelQuery,
} from '../types';

/**
 * 채널 데이터 조회 전담 클래스
 *
 * 책임:
 * - 채널에서 원시 데이터 가져오기 (조회만)
 * - 웹훅 이벤트 처리
 * - 채널에 데이터 전송
 * - 주문 조회
 * - 채널 쿼리 실행
 *
 * 특징:
 * - 비즈니스 로직 없음
 * - 검증 로직 없음
 * - DB 접근 없음
 * - 순수하게 Adapter 호출만 담당
 */
@Injectable()
export class ChannelDataReader {
  private readonly logger = new Logger(ChannelDataReader.name);

  constructor(private readonly adapterFactory: ChannelAdapterFactory) {}

  /**
   * 채널에서 원시 데이터 가져오기
   *
   * @param channel - 대상 채널
   * @param dataType - 데이터 타입 (orders, claims, inventory 등)
   * @returns 내부 표준 이벤트 배열
   */
  async fetchFromChannel(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`📡 [${channel}] ${dataType} 데이터 조회 시작`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const events = await adapter.syncFromChannel(dataType);

    this.logger.log(`✅ [${channel}] ${events.length}건 조회 완료`);
    return events;
  }

  /**
   * 웹훅 이벤트 처리
   *
   * @param channel - 대상 채널
   * @param payload - 웹훅 페이로드
   * @returns 내부 표준 이벤트 배열
   */
  async processWebhook(
    channel: ChannelType,
    payload: any,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`📨 [${channel}] 웹훅 이벤트 수신`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const events = await adapter.processIncomingEvent(payload);

    this.logger.log(`✅ [${channel}] ${events.length}건 처리 완료`);
    return events;
  }

  /**
   * 채널에 데이터 전송
   *
   * @param channel - 대상 채널
   * @param payload - 전송할 데이터
   * @returns 동기화 결과
   */
  async sendToChannel(
    channel: ChannelType,
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    this.logger.log(`📤 [${channel}] ${payload.dataType} 전송 시작`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.syncToChannel(payload);

    this.logger.log(
      `${result.success ? '✅' : '❌'} [${channel}] ${payload.dataType} 전송 ${result.success ? '성공' : '실패'}`,
    );
    return result;
  }

  /**
   * 주문 조회
   *
   * @param channel - 대상 채널
   * @param query - 조회 쿼리
   * @returns 내부 표준 이벤트 배열
   */
  async findOrders(
    channel: ChannelType,
    query: OrderQuery,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`🔍 [${channel}] 주문 조회: ${query.by} = ${query.id}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const orders = await adapter.findOrders(query);

    this.logger.log(`✅ [${channel}] ${orders.length}건 조회 완료`);
    return orders;
  }

  /**
   * 채널 쿼리 실행
   *
   * @param channel - 대상 채널
   * @param query - 실행할 쿼리
   * @returns 쿼리 결과
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    this.logger.log(`🔍 [${channel}] 쿼리 실행: ${query.type}`);

    const adapter = this.adapterFactory.getAdapter(channel);
    const result = await adapter.executeQuery(query);

    this.logger.log(`✅ [${channel}] 쿼리 실행 완료`);
    return result;
  }
}
