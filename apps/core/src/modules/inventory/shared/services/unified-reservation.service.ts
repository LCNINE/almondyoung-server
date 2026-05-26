import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, and, inArray, sum, sql, lt, isNotNull } from 'drizzle-orm';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

export interface ReserveStockDto {
  targetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK';
  targetId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  fulfillmentOrderItemId?: string; // FO 예약시 필요
  timeoutAt?: Date;
  reason?: string;
}

export interface Reservation {
  id: string;
  targetType: string;
  targetId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  status: string;
  fulfillmentOrderItemId: string | null;
  timeoutAt: Date | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationSummary {
  skuId: string;
  warehouseId: string;
  totalReserved: number;
  byTarget: {
    targetType: string;
    targetId: string;
    quantity: number;
  }[];
}

@Injectable()
export class UnifiedReservationService {
  private readonly logger = new Logger(UnifiedReservationService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  /**
   * 재고 예약 생성
   */
  async reserveStock(dto: ReserveStockDto, tx?: DbTx): Promise<Reservation> {
    return this.inTx(async (trx) => {
      // 1. 사용가능한 재고 확인
      const availableStock = await this.getAvailableStock(dto.skuId, dto.warehouseId, trx);

      if (availableStock < dto.quantity) {
        throw new ConflictException(`Insufficient stock. Available: ${availableStock}, Requested: ${dto.quantity}`);
      }

      // 2. 예약 생성
      const [reservation] = await trx
        .insert(wmsTables.stockReservations)
        .values({
          targetType: dto.targetType,
          targetId: dto.targetId,
          skuId: dto.skuId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          fulfillmentOrderItemId: dto.fulfillmentOrderItemId,
          status: 'confirmed',
          timeoutAt: dto.timeoutAt,
          reason: dto.reason,
        })
        .returning();

      this.logger.log(`Reserved ${dto.quantity} units of SKU ${dto.skuId} for ${dto.targetType}:${dto.targetId}`);

      await this.productSellableQuantity.recalculateAndPublishForSku(dto.skuId, trx);

      return reservation satisfies Reservation;
    }, tx);
  }

  /**
   * 예약 해제
   */
  async releaseReservation(id: string, tx?: DbTx): Promise<void> {
    return this.inTx(async (trx) => {
      const [updated] = await trx
        .update(wmsTables.stockReservations)
        .set({
          status: 'released',
          updatedAt: new Date(),
        })
        .where(eq(wmsTables.stockReservations.id, id))
        .returning();

      if (!updated) {
        throw new BadRequestException(`Reservation ${id} not found`);
      }

      await this.productSellableQuantity.recalculateAndPublishForSku(updated.skuId, trx);

      this.logger.log(`Released reservation ${id}`);
    }, tx);
  }

  /**
   * 예약 이전 (FO간, Task간)
   */
  async transferReservation(
    fromReservationId: string,
    toTargetType: 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK',
    toTargetId: string,
    tx?: DbTx,
  ): Promise<Reservation> {
    return this.inTx(async (trx) => {
      // 기존 예약 해제
      await this.releaseReservation(fromReservationId, trx);

      // 기존 예약 정보 조회
      const oldReservation = await trx.query.stockReservations.findFirst({
        where: eq(wmsTables.stockReservations.id, fromReservationId),
      });

      if (!oldReservation) {
        throw new BadRequestException(`Reservation ${fromReservationId} not found`);
      }

      // 새 예약 생성
      const newReservation = await this.reserveStock(
        {
          targetType: toTargetType,
          targetId: toTargetId,
          skuId: oldReservation.skuId,
          warehouseId: oldReservation.warehouseId,
          quantity: oldReservation.quantity,
          fulfillmentOrderItemId: oldReservation.fulfillmentOrderItemId || undefined,
          reason: `Transferred from ${oldReservation.targetType}:${oldReservation.targetId}`,
        },
        trx,
      );

      this.logger.log(`Transferred reservation ${fromReservationId} to ${toTargetType}:${toTargetId}`);

      return newReservation;
    }, tx);
  }

  /**
   * 특정 Target의 예약 현황 조회 (FO/Task가 어떤 SKU를 예약했는지)
   */
  async getReservationsByTarget(targetType: string, targetId: string, tx?: DbTx): Promise<Reservation[]> {
    const db = tx ?? this.db.db;

    const reservations = await db.query.stockReservations.findMany({
      where: and(
        eq(wmsTables.stockReservations.targetType, targetType),
        eq(wmsTables.stockReservations.targetId, targetId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    });

    return reservations satisfies Reservation[];
  }

  /**
   * 특정 SKU의 예약 현황 조회 (SKU가 어떤 FO/Task에 묶여있는지)
   */
  async getReservationsBySku(skuId: string, warehouseId?: string, tx?: DbTx): Promise<Reservation[]> {
    const db = tx ?? this.db.db;

    const conditions = [
      eq(wmsTables.stockReservations.skuId, skuId),
      eq(wmsTables.stockReservations.status, 'confirmed'),
    ];

    if (warehouseId) {
      conditions.push(eq(wmsTables.stockReservations.warehouseId, warehouseId));
    }

    const reservations = await db.query.stockReservations.findMany({
      where: and(...conditions),
    });

    return reservations satisfies Reservation[];
  }

  /**
   * SKU별 총 예약 수량 조회
   */
  async getTotalReservedQuantity(skuId: string, warehouseId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? this.db.db;

    const result = await db
      .select({ totalReserved: sum(wmsTables.stockReservations.quantity) })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.skuId, skuId),
          eq(wmsTables.stockReservations.warehouseId, warehouseId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );

    return Number(result[0]?.totalReserved || 0);
  }

  /**
   * 창고별 예약 통계
   */
  async getReservationSummary(warehouseId: string, tx?: DbTx): Promise<ReservationSummary[]> {
    const db = tx ?? this.db.db;

    const reservations = await db.query.stockReservations.findMany({
      where: and(
        eq(wmsTables.stockReservations.warehouseId, warehouseId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    });

    // SKU별로 그룹화
    const summary = new Map<string, ReservationSummary>();

    for (const reservation of reservations) {
      const key = `${reservation.skuId}:${reservation.warehouseId}`;

      if (!summary.has(key)) {
        summary.set(key, {
          skuId: reservation.skuId,
          warehouseId: reservation.warehouseId,
          totalReserved: 0,
          byTarget: [],
        });
      }

      const item = summary.get(key)!;
      item.totalReserved += reservation.quantity;
      item.byTarget.push({
        targetType: reservation.targetType,
        targetId: reservation.targetId,
        quantity: reservation.quantity,
      });
    }

    return Array.from(summary.values());
  }

  /**
   * 사용가능한 재고 계산 (ON_HAND - 예약됨)
   */
  private async getAvailableStock(skuId: string, warehouseId: string, tx?: DbTx): Promise<number> {
    const db = tx ?? this.db.db;

    // ON_HAND 재고 조회
    const onHandResult = await db
      .select({ quantity: sum(wmsTables.stockLedgers.qty) })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );

    const onHand = Number(onHandResult[0]?.quantity || 0);

    // 예약된 수량 조회
    const reserved = await this.getTotalReservedQuantity(skuId, warehouseId, tx);

    return onHand - reserved;
  }

  /**
   * 예약 만료 처리 (배치 작업용)
   */
  async releaseExpiredReservations(tx?: DbTx): Promise<number> {
    return this.inTx(async (trx) => {
      const now = new Date();

      const result = await trx
        .update(wmsTables.stockReservations)
        .set({
          status: 'released',
          updatedAt: now,
        })
        .where(
          and(
            eq(wmsTables.stockReservations.status, 'confirmed'),
            isNotNull(wmsTables.stockReservations.timeoutAt),
            lt(wmsTables.stockReservations.timeoutAt, now),
          ),
        )
        .returning();

      const skuIds = [...new Set(result.map((reservation) => reservation.skuId))];
      for (const skuId of skuIds) {
        await this.productSellableQuantity.recalculateAndPublishForSku(skuId, trx);
      }

      this.logger.log(`Released ${result.length} expired reservations`);
      return result.length;
    }, tx);
  }
}
