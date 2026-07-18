import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { eq, and, sum, sql } from 'drizzle-orm';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { acquireStockAvailabilityLock } from '../locks/stock-availability-lock';

export interface ReserveStockDto {
  // Task 25 contract: V2 예약은 shipment-line 단위만 (FO-target 생성 경로는 은퇴). shipmentLineId 필수.
  targetType: 'SHIPMENT_LINE';
  targetId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  fulfillmentOrderItemId?: string; // legacy FO 예약 호환 컬럼(nullable) — V2 는 미설정
  shipmentLineId: string;
  requestedAt?: Date;
  /** Internal: the domain owner already holds the transaction advisory lock. */
  stockLockHeld?: boolean;
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
  shipmentLineId: string | null;
  timeoutAt: Date | null;
  reason: string | null;
  requestedAt: Date | null;
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

  /**
   * 재고 예약 생성
   */
  async reserveStock(dto: ReserveStockDto, tx?: DbTx): Promise<Reservation> {
    return this.db.run(async (trx) => {
      if (
        dto.targetType === 'SHIPMENT_LINE' &&
        (dto.shipmentLineId !== dto.targetId || dto.fulfillmentOrderItemId !== undefined || !dto.requestedAt)
      ) {
        throw new BadRequestException(
          'SHIPMENT_LINE reservation requires matching shipmentLineId/requestedAt and cannot use fulfillmentOrderItemId',
        );
      }

      // 0. (sku,warehouse) 직렬화 — available 확인↔INSERT 사이 TOCTOU 차단
      if (!dto.stockLockHeld) {
        await acquireStockAvailabilityLock(trx, dto.skuId, dto.warehouseId);
      }

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
          shipmentLineId: dto.shipmentLineId,
          status: 'confirmed',
          timeoutAt: dto.timeoutAt,
          reason: dto.reason,
          requestedAt: dto.requestedAt,
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
    return this.db.run(async (trx) => {
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

  /** V2 callers already hold the `(sku, warehouse)` advisory lock before this read. */
  async getAvailableQuantity(skuId: string, warehouseId: string, tx: DbTx): Promise<number> {
    return this.getAvailableStock(skuId, warehouseId, tx);
  }

  /** Keep sellable projections in sync after a reservation-set mutation performed by a domain owner. */
  async recalculateSellableForSku(skuId: string, tx: DbTx): Promise<void> {
    await this.productSellableQuantity.recalculateAndPublishForSku(skuId, tx);
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

    // 단일 스냅샷: on_hand 와 reserved 를 한 statement 로 계산 → READ COMMITTED 에서 SHIP 소진 등
    // 비-락 경로가 두 읽기 사이 커밋될 때의 torn read(초과예약) 차단.
    const rows = (await db.execute(sql`
      SELECT
        COALESCE((SELECT SUM(qty) FROM stock_ledgers
                   WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND stock_state = 'ON_HAND'), 0)
        - COALESCE((SELECT SUM(quantity) FROM stock_reservations
                     WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND status = 'confirmed'), 0)
          AS available
    `)) as unknown as { available: number | string }[];
    return Number(rows[0]?.available ?? 0);
  }
}
