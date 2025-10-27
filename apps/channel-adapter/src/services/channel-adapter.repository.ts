import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema } from '../schema';
import { InternalOrderEvent } from '../types';
import { eq, and, desc } from 'drizzle-orm';

/**
 * 채널 어댑터 Repository
 *
 * 책임:
 * - DB 접근 (도메인당 1개 Repository)
 * - 순수 데이터 CRUD
 * - 비즈니스 로직 없음
 * - 검증 로직 없음
 */
@Injectable()
export class ChannelAdapterRepository {
  private readonly logger = new Logger(ChannelAdapterRepository.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  // ========================================
  // Sync History
  // ========================================

  async saveSyncHistory(data: {
    channel: string;
    dataType: string;
    totalCount: number;
    status: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.syncHistories).values({
      channelId: data.channel,
      syncType: data.dataType,
      totalCount: data.totalCount,
      successCount: data.status === 'success' ? data.totalCount : 0,
      failedCount: data.status === 'failed' ? data.totalCount : 0,
      status: data.status,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    this.logger.debug(
      `📊 동기화 히스토리 저장: ${data.channel}/${data.dataType}`,
    );
  }

  async findSyncHistoriesByChannel(channel: string, limit = 10) {
    return await this.db.db
      .select()
      .from(channelAdapterSchema.syncHistories)
      .where(eq(channelAdapterSchema.syncHistories.channelId, channel))
      .orderBy(desc(channelAdapterSchema.syncHistories.createdAt))
      .limit(limit);
  }

  // ========================================
  // Event Logs
  // ========================================

  async saveEventLogs(
    events: InternalOrderEvent[],
    channel: string,
  ): Promise<void> {
    if (events.length === 0) return;

    const eventLogs = events.map((event) => ({
      channelId: channel,
      eventType: 'order_received',
      externalOrderId: event.externalOrderId,
      externalClaimId: event.claimInfo?.claimId || null,
      rawData: event,
      transformedData: event,
      status: 'processed',
      processedAt: new Date(),
    }));

    await this.db.db.insert(channelAdapterSchema.eventLogs).values(eventLogs);

    this.logger.debug(`📝 이벤트 로그 저장: ${events.length}건`);
  }

  async findEventsByOrderId(orderId: string, channel?: string): Promise<any[]> {
    const whereConditions = channel
      ? and(
          eq(channelAdapterSchema.eventLogs.externalOrderId, orderId),
          eq(channelAdapterSchema.eventLogs.channelId, channel),
        )
      : eq(channelAdapterSchema.eventLogs.externalOrderId, orderId);

    return await this.db.db
      .select()
      .from(channelAdapterSchema.eventLogs)
      .where(whereConditions)
      .orderBy(desc(channelAdapterSchema.eventLogs.createdAt));
  }

  // ========================================
  // WMS Mapping
  // ========================================

  async saveWmsMapping(data: {
    salesChannel: string;
    channelOrderId: string;
    wmsOrderId: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.wmsOrderMappings).values({
      salesChannel: data.salesChannel,
      channelOrderId: data.channelOrderId,
      wmsOrderId: data.wmsOrderId,
    });

    this.logger.debug(
      `🔗 WMS 매핑 저장: ${data.salesChannel}/${data.channelOrderId} → ${data.wmsOrderId}`,
    );
  }

  async findWmsMappingByChannelOrder(
    salesChannel: string,
    channelOrderId: string,
  ): Promise<any | null> {
    const result = await this.db.db
      .select()
      .from(channelAdapterSchema.wmsOrderMappings)
      .where(
        and(
          eq(channelAdapterSchema.wmsOrderMappings.salesChannel, salesChannel),
          eq(
            channelAdapterSchema.wmsOrderMappings.channelOrderId,
            channelOrderId,
          ),
        ),
      )
      .limit(1);

    return result[0] || null;
  }

  async findWmsMappingByWmsOrderId(wmsOrderId: string): Promise<any | null> {
    const result = await this.db.db
      .select()
      .from(channelAdapterSchema.wmsOrderMappings)
      .where(eq(channelAdapterSchema.wmsOrderMappings.wmsOrderId, wmsOrderId))
      .limit(1);

    return result[0] || null;
  }

  // ========================================
  // WMS Event Logging
  // ========================================

  async logWmsEvent(data: {
    channel: string;
    type: string;
    channelOrderId: string;
    wmsOrderId: string;
    claimId?: string;
    reason?: string;
  }): Promise<void> {
    await this.db.db.insert(channelAdapterSchema.eventLogs).values({
      channelId: data.channel,
      eventType: data.type,
      externalOrderId: data.channelOrderId,
      externalClaimId: data.claimId || null,
      rawData: {
        wmsOrderId: data.wmsOrderId,
        reason: data.reason,
      },
      status: 'processed',
      processedAt: new Date(),
    });

    this.logger.debug(`📝 WMS 이벤트 로그: ${data.type}`);
  }
}
