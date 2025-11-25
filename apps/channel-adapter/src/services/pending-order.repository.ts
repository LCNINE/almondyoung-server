import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { channelAdapterSchema, pendingOrders } from '../schema';
import {
  PendingOrder,
  NewPendingOrder,
  UpdatePendingOrder,
  PendingOrderStatus,
  UnmappedItem,
  InternalOrderEvent,
} from '../types';
import { eq, and, inArray, sql } from 'drizzle-orm';

/**
 * 미매핑 주문 계류 Repository
 *
 * 책임:
 * - 미매핑 주문의 CRUD
 * - 채널 상품 → PIM Variant 매핑 대기 주문 관리
 */
@Injectable()
export class PendingOrderRepository {
  private readonly logger = new Logger(PendingOrderRepository.name);

  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  /**
   * 계류 주문 저장
   */
  async save(data: {
    channel: string;
    externalOrderId: string;
    unmappedItems: UnmappedItem[];
    rawOrderEvent: InternalOrderEvent;
  }): Promise<PendingOrder> {
    const [inserted] = await this.db.db
      .insert(pendingOrders)
      .values({
        channel: data.channel,
        externalOrderId: data.externalOrderId,
        status: 'pending_mapping',
        unmappedItems: data.unmappedItems,
        rawOrderEvent: data.rawOrderEvent as unknown as Record<string, unknown>,
      })
      .returning();

    this.logger.debug(
      `⏸️ 계류 주문 저장: ${data.channel}/${data.externalOrderId}`,
    );

    return inserted;
  }

  /**
   * ID로 계류 주문 조회
   */
  async findById(id: string): Promise<PendingOrder | null> {
    const result = await this.db.db
      .select()
      .from(pendingOrders)
      .where(eq(pendingOrders.id, id))
      .limit(1);

    return result[0] || null;
  }

  /**
   * 채널 + 외부 주문 ID로 조회
   */
  async findByChannelOrder(
    channel: string,
    externalOrderId: string,
  ): Promise<PendingOrder | null> {
    const result = await this.db.db
      .select()
      .from(pendingOrders)
      .where(
        and(
          eq(pendingOrders.channel, channel),
          eq(pendingOrders.externalOrderId, externalOrderId),
        ),
      )
      .limit(1);

    return result[0] || null;
  }

  /**
   * 상태별 계류 주문 목록 조회
   */
  async findByStatus(
    status: PendingOrderStatus,
    options?: {
      channel?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<PendingOrder[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = [eq(pendingOrders.status, status)];
    if (options?.channel) {
      conditions.push(eq(pendingOrders.channel, options.channel));
    }

    return await this.db.db
      .select()
      .from(pendingOrders)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  /**
   * 특정 채널 상품 ID를 포함한 계류 주문 조회
   * (매핑 완료 후 재처리 대상 찾기용)
   */
  async findByUnmappedItem(channelItemId: string): Promise<PendingOrder[]> {
    return await this.db.db
      .select()
      .from(pendingOrders)
      .where(
        and(
          eq(pendingOrders.status, 'pending_mapping'),
          sql`${pendingOrders.unmappedItems}::jsonb @> ${JSON.stringify([{ channelItemId }])}::jsonb`,
        ),
      );
  }

  /**
   * 처리 완료로 상태 변경
   */
  async markAsProcessed(id: string): Promise<void> {
    await this.db.db
      .update(pendingOrders)
      .set({
        status: 'completed',
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pendingOrders.id, id));

    this.logger.debug(`✅ 계류 주문 처리 완료: ${id}`);
  }

  /**
   * 처리 중으로 상태 변경
   */
  async markAsProcessing(id: string): Promise<void> {
    await this.db.db
      .update(pendingOrders)
      .set({
        status: 'processing',
        lastRetryAt: new Date(),
        retryCount: sql`${pendingOrders.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(pendingOrders.id, id));
  }

  /**
   * 실패로 상태 변경
   */
  async markAsFailed(id: string, errorMessage: string): Promise<void> {
    await this.db.db
      .update(pendingOrders)
      .set({
        status: 'failed',
        errorMessage,
        lastRetryAt: new Date(),
        retryCount: sql`${pendingOrders.retryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(pendingOrders.id, id));

    this.logger.warn(`❌ 계류 주문 처리 실패: ${id} - ${errorMessage}`);
  }

  /**
   * 미매핑 항목 업데이트 (일부 항목만 매핑된 경우)
   */
  async updateUnmappedItems(
    id: string,
    unmappedItems: UnmappedItem[],
  ): Promise<void> {
    await this.db.db
      .update(pendingOrders)
      .set({
        unmappedItems,
        updatedAt: new Date(),
      })
      .where(eq(pendingOrders.id, id));
  }

  /**
   * 계류 주문 삭제 (완료된 주문 정리용)
   */
  async delete(id: string): Promise<void> {
    await this.db.db.delete(pendingOrders).where(eq(pendingOrders.id, id));
  }

  /**
   * 완료된 오래된 계류 주문 정리
   */
  async cleanupCompleted(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.db.db
      .delete(pendingOrders)
      .where(
        and(
          eq(pendingOrders.status, 'completed'),
          sql`${pendingOrders.processedAt} < ${cutoffDate.toISOString()}`,
        ),
      );

    const deletedCount = Number(result.rowCount ?? 0);
    if (deletedCount > 0) {
      this.logger.log(`🧹 완료된 계류 주문 ${deletedCount}건 정리`);
    }

    return deletedCount;
  }

  /**
   * 상태별 계류 주문 수 조회
   */
  async countByStatus(): Promise<Record<PendingOrderStatus, number>> {
    const result = await this.db.db
      .select({
        status: pendingOrders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(pendingOrders)
      .groupBy(pendingOrders.status);

    const counts: Record<PendingOrderStatus, number> = {
      pending_mapping: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };

    for (const row of result) {
      counts[row.status as PendingOrderStatus] = row.count;
    }

    return counts;
  }

  /**
   * 이미 존재하는지 확인
   */
  async exists(channel: string, externalOrderId: string): Promise<boolean> {
    const result = await this.db.db
      .select({ id: pendingOrders.id })
      .from(pendingOrders)
      .where(
        and(
          eq(pendingOrders.channel, channel),
          eq(pendingOrders.externalOrderId, externalOrderId),
        ),
      )
      .limit(1);

    return result.length > 0;
  }
}

