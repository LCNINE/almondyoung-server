import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { ChannelAdapterFactory, ChannelType } from './adapters/channel-adapter.factory';
import { InternalOrderEvent, DataType, SyncToChannelPayload, SyncResult, channelAdapterSchema } from '../types';
import { ChannelAdapterValidator } from '../validators/channel-adapter.validator';
import { ChannelsConfig } from '../config/channels.config';
import { OutboxService } from './outbox.service';
import { syncHistories, eventLogs } from '../schema';

/**
 * 채널 동기화 Manager
 *
 * 책임:
 * - Inbound/Outbound 동기화 처리
 * - 검증 로직 (Manager 책임!)
 * - DB 저장 (직접 DB 접근)
 * - 이벤트 발행
 *
 * 특징:
 * - 비즈니스 로직 포함
 * - 검증 로직 포함
 * - 트랜잭션 없음 (로깅 테이블)
 */
@Injectable()
export class ChannelSyncManager {
  private readonly logger = new Logger(ChannelSyncManager.name);

  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    private readonly outboxService: OutboxService,
    private readonly adapterFactory: ChannelAdapterFactory,
  ) {}

  /**
   * Inbound 동기화 처리
   *
   * 책임: 검증 + DB 저장 + 이벤트 발행
   *
   * @param events - 동기화할 이벤트 배열
   * @param channel - 대상 채널
   * @param dataType - 데이터 타입
   */
  async processInboundSync(events: InternalOrderEvent[], channel: ChannelType, dataType: DataType): Promise<void> {
    // 1️⃣ 검증 (Manager 책임!)
    ChannelAdapterValidator.validateEvents(events);

    this.logger.log(`💾 [${channel}] ${events.length}건 저장 시작`);

    const startTime = Date.now();

    // 2️⃣ DB 저장 및 이벤트 발행 (트랜잭션 내)
    await this.db.db.transaction(async (tx) => {
      // DB 저장
      await tx.insert(syncHistories).values({
        channelId: channel,
        syncType: dataType,
      totalCount: events.length,
        successCount: events.length,
        failedCount: 0,
      status: 'success',
        startedAt: new Date(),
        completedAt: new Date(),
      });

      if (events.length > 0) {
        const eventLogsData = events.map((event) => ({
          channelId: channel,
          eventType: 'order_received',
          externalOrderId: event.externalOrderId,
          externalClaimId: event.claimInfo?.claimId || null,
          rawData: event,
          transformedData: event,
          status: 'processed',
          processedAt: new Date(),
        }));

        await tx.insert(eventLogs).values(eventLogsData);
      }

      // 3️⃣ Outbox에 이벤트 enqueue (같은 트랜잭션!)
    if (dataType === 'orders') {
        await this.outboxService.enqueue(
          {
        eventType: 'OrderSyncCompleted',
        aggregateId: `${channel}-sync`,
            partitionKey: channel,
        payload: {
          channelType: channel,
          syncType: 'inbound' as const,
          orderCount: events.length,
          orders: events.map((e) => ({
            channelType: channel,
            externalOrderId: e.externalOrderId,
            status: e.status,
                quantity: e.quantity || 1,
                priceAmount: e.priceAmount || 0,
          })),
              syncDurationMs: Date.now() - startTime,
            },
            metadata: {
              dataType,
        },
          },
          tx,
        );
    }
    });

    this.logger.log(`✅ [${channel}] ${events.length}건 동기화 완료`);
  }

  /**
   * Outbound 동기화 로깅
   *
   * @param channel - 대상 채널
   * @param payload - 전송한 데이터
   * @param result - 전송 결과
   */
  async logOutboundSync(channel: ChannelType, payload: SyncToChannelPayload, result: SyncResult): Promise<void> {
    // DB 저장
    await this.db.db.insert(syncHistories).values({
      channelId: channel,
      syncType: payload.dataType,
      totalCount: 1,
      successCount: result.success ? 1 : 0,
      failedCount: result.success ? 0 : 1,
      status: result.success ? 'success' : 'failed',
      startedAt: new Date(),
      completedAt: new Date(),
    });

    if (payload.dataType === 'inventory' && result.success) {
      await this.outboxService.enqueue({
        eventType: 'InventorySyncCompleted',
        aggregateId: `${channel}-inventory-${payload.payload.productId}`,
        partitionKey: channel,
        payload: {
          channelType: channel,
          productId: payload.payload.productId,
          syncType: payload.payload.isOptionProduct ? 'option' : 'single',
          stockQuantity: payload.payload.stockQuantity,
          syncResult: 'success' as const,
        },
      });
    }

    this.logger.log(`${result.success ? '✅' : '❌'} [${channel}] ${payload.dataType} 동기화 로그 기록`);
  }

  /**
   * 전체 채널 동기화
   *
   * @param dataType - 데이터 타입
   * @returns 채널별 동기화 결과
   */
  async syncAllChannels(dataType: DataType): Promise<
    Array<{
      channel: ChannelType;
      events: InternalOrderEvent[];
      success: boolean;
      error?: string;
    }>
  > {
    const channels = ChannelsConfig.getActiveChannels();
    const results: Array<any> = [];

    this.logger.log(`🌐 전체 채널 ${dataType} 동기화 시작`);

    for (const channel of channels) {
      try {
        const adapter = this.adapterFactory.getAdapter(channel);
        const events = await adapter.syncFromChannel(dataType);

        await this.processInboundSync(events, channel, dataType);

        results.push({ channel, events, success: true });
      } catch (error) {
        this.logger.error(`❌ [${channel}] 동기화 실패:`, error.message);
        results.push({
          channel,
          events: [],
          success: false,
          error: error.message,
        });
      }
    }

    const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);
    const successCount = results.filter((r) => r.success).length;

    this.logger.log(`🎯 전체 채널 동기화 완료: ${successCount}/${channels.length}개, 총 ${totalEvents}건`);

    return results;
  }
}
