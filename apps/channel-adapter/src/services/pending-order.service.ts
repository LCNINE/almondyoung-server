import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq, and, desc, SQL } from 'drizzle-orm';
import { channelAdapterSchema } from '../schema';
import { PendingOrder, NewPendingOrder, InternalOrderEvent } from '../types';
import { SalesChannelType } from './channel-product-mapping.service';

export type PendingOrderStatus = 'pending' | 'processed' | 'cancelled';
export type PendingReason = 'unmapped_product' | 'validation_error' | 'other';

export interface HoldOrderDto {
  salesChannel: SalesChannelType;
  channelOrderId: string;
  channelProductId: string;
  channelProductName?: string;
  orderData: InternalOrderEvent;
  reason?: PendingReason;
}

export interface PendingOrderFilters {
  salesChannel?: SalesChannelType;
  status?: PendingOrderStatus;
  channelProductId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 계류 주문 관리 서비스
 *
 * 채널 상품 매핑이 없어서 처리할 수 없는 주문을 임시 보관하고,
 * 매핑이 완료되면 재처리합니다.
 */
@Injectable()
export class PendingOrderService {
  private readonly logger = new Logger(PendingOrderService.name);

  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
  ) {
    this.logger.log('⏸️ 계류 주문 서비스 초기화 완료');
  }

  /**
   * 주문 계류 (미매핑 상품으로 인한 보류)
   */
  async holdOrder(dto: HoldOrderDto): Promise<PendingOrder> {
    try {
      // 이미 계류된 주문인지 확인
      const existing = await this.findByChannelOrderId(
        dto.salesChannel,
        dto.channelOrderId,
      );

      if (existing) {
        this.logger.warn(
          `⚠️ 이미 계류된 주문: ${dto.salesChannel}/${dto.channelOrderId}`,
        );
        return existing;
      }

      const newPendingOrder: NewPendingOrder = {
        salesChannel: dto.salesChannel,
        channelOrderId: dto.channelOrderId,
        channelProductId: dto.channelProductId,
        channelProductName: dto.channelProductName,
        orderData: dto.orderData,
        status: 'pending',
        reason: dto.reason ?? 'unmapped_product',
      };

      const [created] = await this.db.db
        .insert(channelAdapterSchema.pendingOrders)
        .values(newPendingOrder)
        .returning();

      this.logger.log(
        `⏸️ 주문 계류: ${dto.salesChannel}/${dto.channelOrderId} (사유: ${dto.reason ?? 'unmapped_product'})`,
      );

      return created;
    } catch (error) {
      this.logger.error(
        `❌ 주문 계류 실패: ${dto.salesChannel}/${dto.channelOrderId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 채널 주문 ID로 계류 주문 조회
   */
  async findByChannelOrderId(
    salesChannel: SalesChannelType,
    channelOrderId: string,
  ): Promise<PendingOrder | null> {
    try {
      const [order] = await this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders)
        .where(
          and(
            eq(channelAdapterSchema.pendingOrders.salesChannel, salesChannel),
            eq(channelAdapterSchema.pendingOrders.channelOrderId, channelOrderId),
          ),
        )
        .limit(1);

      return order ?? null;
    } catch (error) {
      this.logger.error(
        `❌ 계류 주문 조회 실패: ${salesChannel}/${channelOrderId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 채널 상품 ID로 계류 주문 목록 조회 (매핑 완료 시 일괄 재처리용)
   */
  async findByProductId(
    salesChannel: SalesChannelType,
    channelProductId: string,
    status: PendingOrderStatus = 'pending',
  ): Promise<PendingOrder[]> {
    try {
      return await this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders)
        .where(
          and(
            eq(channelAdapterSchema.pendingOrders.salesChannel, salesChannel),
            eq(channelAdapterSchema.pendingOrders.channelProductId, channelProductId),
            eq(channelAdapterSchema.pendingOrders.status, status),
          ),
        )
        .orderBy(channelAdapterSchema.pendingOrders.createdAt);
    } catch (error) {
      this.logger.error(
        `❌ 상품별 계류 주문 조회 실패: ${salesChannel}/${channelProductId}`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 계류 주문 목록 조회 (필터링 + 페이징)
   */
  async findAll(filters?: PendingOrderFilters): Promise<{
    orders: PendingOrder[];
    total: number;
  }> {
    try {
      const limit = filters?.limit ?? 50;
      const offset = filters?.offset ?? 0;

      // 조건 배열 구성
      const conditions: SQL[] = [];
      
      if (filters?.salesChannel) {
        conditions.push(
          eq(channelAdapterSchema.pendingOrders.salesChannel, filters.salesChannel),
        );
      }
      
      if (filters?.status) {
        conditions.push(
          eq(channelAdapterSchema.pendingOrders.status, filters.status),
        );
      }
      
      if (filters?.channelProductId) {
        conditions.push(
          eq(channelAdapterSchema.pendingOrders.channelProductId, filters.channelProductId),
        );
      }

      let query = this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders);

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }

      const orders = await query
        .orderBy(desc(channelAdapterSchema.pendingOrders.createdAt))
        .limit(limit)
        .offset(offset);

      // 총 개수 조회
      let countQuery = this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders);
      
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
      }
      
      const allRecords = await countQuery;

      return {
        orders,
        total: allRecords.length,
      };
    } catch (error) {
      this.logger.error('❌ 계류 주문 목록 조회 실패', error.message);
      throw error;
    }
  }

  /**
   * 계류 주문 처리 완료 표시
   */
  async markAsProcessed(id: string, processedBy?: string): Promise<PendingOrder> {
    try {
      const [updated] = await this.db.db
        .update(channelAdapterSchema.pendingOrders)
        .set({
          status: 'processed',
          processedAt: new Date(),
          processedBy,
          updatedAt: new Date(),
        })
        .where(eq(channelAdapterSchema.pendingOrders.id, id))
        .returning();

      if (!updated) {
        throw new Error(`계류 주문을 찾을 수 없습니다: ${id}`);
      }

      this.logger.log(`✅ 계류 주문 처리 완료: ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`❌ 계류 주문 처리 완료 실패: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * 계류 주문 취소
   */
  async cancel(id: string, processedBy?: string): Promise<PendingOrder> {
    try {
      const [updated] = await this.db.db
        .update(channelAdapterSchema.pendingOrders)
        .set({
          status: 'cancelled',
          processedAt: new Date(),
          processedBy,
          updatedAt: new Date(),
        })
        .where(eq(channelAdapterSchema.pendingOrders.id, id))
        .returning();

      if (!updated) {
        throw new Error(`계류 주문을 찾을 수 없습니다: ${id}`);
      }

      this.logger.log(`🚫 계류 주문 취소: ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(`❌ 계류 주문 취소 실패: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * ID로 계류 주문 조회
   */
  async findById(id: string): Promise<PendingOrder | null> {
    try {
      const [order] = await this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders)
        .where(eq(channelAdapterSchema.pendingOrders.id, id))
        .limit(1);

      return order ?? null;
    } catch (error) {
      this.logger.error(`❌ 계류 주문 조회 실패: ${id}`, error.message);
      throw error;
    }
  }

  /**
   * 미매핑 상품별 계류 주문 수 집계
   */
  async getUnmappedProductStats(salesChannel?: SalesChannelType): Promise<
    Array<{
      channelProductId: string;
      channelProductName: string | null;
      salesChannel: string;
      pendingCount: number;
    }>
  > {
    try {
      const conditions = [
        eq(channelAdapterSchema.pendingOrders.status, 'pending'),
      ];

      if (salesChannel) {
        conditions.push(
          eq(channelAdapterSchema.pendingOrders.salesChannel, salesChannel),
        );
      }

      const orders = await this.db.db
        .select()
        .from(channelAdapterSchema.pendingOrders)
        .where(and(...conditions));

      // 상품별 그룹화
      const statsMap = new Map<string, {
        channelProductId: string;
        channelProductName: string | null;
        salesChannel: string;
        pendingCount: number;
      }>();

      for (const order of orders) {
        const key = `${order.salesChannel}:${order.channelProductId}`;
        const existing = statsMap.get(key);

        if (existing) {
          existing.pendingCount++;
        } else {
          statsMap.set(key, {
            channelProductId: order.channelProductId,
            channelProductName: order.channelProductName,
            salesChannel: order.salesChannel,
            pendingCount: 1,
          });
        }
      }

      return Array.from(statsMap.values()).sort((a, b) => b.pendingCount - a.pendingCount);
    } catch (error) {
      this.logger.error('❌ 미매핑 상품 통계 조회 실패', error.message);
      throw error;
    }
  }
}

