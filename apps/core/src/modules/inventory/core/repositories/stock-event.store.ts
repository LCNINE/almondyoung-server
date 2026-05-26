import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { DbService } from '@app/db';
import { and, or, eq, lte, gte, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { StockStateEnum } from '../../schema/enum-values';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

// TransitionType alias for strong typing
type TransitionType = (typeof wmsTables.stockEvents.$inferInsert)['transitionType'];

type CreateEventInput = {
  journalId?: string;
  skuId: string;

  // 전이 방향 (한쪽 또는 양쪽)
  fromWarehouseId?: string | null;
  fromLocationId?: string | null;
  toWarehouseId?: string | null;
  toLocationId?: string | null;

  fromState?: (typeof wmsTables.stockEvents.$inferInsert)['fromState'] | null;
  toState?: (typeof wmsTables.stockEvents.$inferInsert)['toState'] | null;

  transitionType: (typeof wmsTables.stockEvents.$inferInsert)['transitionType'];
  quantity: number; // 항상 양수
  occurredAt: Date; // 비즈니스 발생시각
  idempotencyKey?: string;
  reason?: string;
};

@Injectable()
export class StockEventStore {
  private readonly logger = new Logger(StockEventStore.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSellableQuantity: ProductSellableQuantityService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /** 공용 트랜잭션 헬퍼 */
  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  // -----------------------------
  // 생성/커밋 (이벤트 + 레저 갱신)
  // -----------------------------

  /** 이벤트 1건 생성 + 레저 프로젝션 갱신(동일 트랜잭션) */
  async createEvent(input: CreateEventInput, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // 1) 이벤트 삽입 (멱등키가 있으면 중복 방지)
      const [event] = await trx
        .insert(wmsTables.stockEvents)
        .values({
          journalId: input.journalId ?? null,
          skuId: input.skuId,
          fromWarehouseId: input.fromWarehouseId ?? null,
          fromLocationId: input.fromLocationId ?? null,
          toWarehouseId: input.toWarehouseId ?? null,
          toLocationId: input.toLocationId ?? null,
          fromState: input.fromState ?? null,
          toState: input.toState ?? null,
          transitionType: input.transitionType,
          quantity: input.quantity,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
          eventStatus: 'POSTED', // MVP 기본값
          reason: input.reason ?? null,
        })
        .onConflictDoNothing({ target: wmsTables.stockEvents.idempotencyKey }) // 멱등
        .returning();

      if (!event) {
        this.logger.debug(`Idempotent createEvent skipped: ${input.idempotencyKey}`);
        if (input.idempotencyKey) {
          const existing = await trx.query.stockEvents.findFirst({
            where: (e, { eq }) => eq(e.idempotencyKey, input.idempotencyKey!),
          });
          return existing ?? null;
        }
        return null;
      }

      // 2) 레저 갱신 (from -= qty, to += qty)
      await this.applyProjection(trx, {
        skuId: event.skuId,
        fromWarehouseId: event.fromWarehouseId,
        fromLocationId: event.fromLocationId,
        toWarehouseId: event.toWarehouseId,
        toLocationId: event.toLocationId,
        fromState: event.fromState,
        toState: event.toState,
        quantity: event.quantity,
      });

      await this.productSellableQuantity.recalculateAndPublishForSku(event.skuId, trx);

      this.logger.debug(`Created ${event.transitionType} ev#${event.id} sku=${event.skuId} qty=${event.quantity}`);
      return event;
    }, tx);
  }

  /** 내부용: 레저 가/감산 (음수 금지 정책은 여기서 체크 가능) */
  private async applyProjection(
    tx: DbTx,
    params: {
      skuId: string;
      fromWarehouseId: string | null;
      fromLocationId: string | null;
      toWarehouseId: string | null;
      toLocationId: string | null;
      fromState: StockStateEnum | null;
      toState: StockStateEnum | null;
      quantity: number;
    },
    options?: { forbidNegative?: boolean },
  ) {
    const now = new Date();

    // fromState 감소
    if (params.fromState) {
      if (!params.fromWarehouseId || !params.fromLocationId) {
        throw new BadRequestException('fromState가 있으면 fromWarehouse/Location이 필요합니다.');
      }

      // 음수 INSERT를 금지하고, 충분 수량이 있는 기존 행에 대해서만 조건부 UPDATE 수행
      const decreased = await tx
        .update(wmsTables.stockLedgers)
        .set({
          qty: sql`${wmsTables.stockLedgers.qty} - ${params.quantity}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, params.skuId),
            eq(wmsTables.stockLedgers.warehouseId, params.fromWarehouseId),
            eq(wmsTables.stockLedgers.locationId, params.fromLocationId),
            eq(wmsTables.stockLedgers.stockState, params.fromState),
            gte(wmsTables.stockLedgers.qty, params.quantity),
          ),
        )
        .returning();

      if (!decreased || decreased.length === 0) {
        throw new BadRequestException('insufficient on-hand at source');
      }
    }

    // toState 증가
    if (params.toState) {
      if (!params.toWarehouseId || !params.toLocationId) {
        throw new BadRequestException('toState가 있으면 toWarehouse/Location이 필요합니다.');
      }
      await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: params.skuId,
          warehouseId: params.toWarehouseId,
          locationId: params.toLocationId,
          stockState: params.toState,
          qty: params.quantity,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            wmsTables.stockLedgers.skuId,
            wmsTables.stockLedgers.warehouseId,
            wmsTables.stockLedgers.locationId,
            wmsTables.stockLedgers.stockState,
          ],
          set: {
            qty: sql`${wmsTables.stockLedgers.qty} + ${params.quantity}`,
            updatedAt: now,
          },
        });
    }
  }

  // -----------------------------
  // 조회
  // -----------------------------

  /** 이벤트 이력 (SKU 중심, 특정 창고의 from/to 모두 포함) */
  async getEventHistory(skuId?: string, warehouseId?: string, startDate?: string, endDate?: string) {
    const where = (e: typeof wmsTables.stockEvents) =>
      and(
        skuId ? eq(e.skuId, skuId) : undefined,
        warehouseId ? or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)) : undefined,
        startDate ? gte(e.occurredAt, new Date(startDate)) : undefined,
        endDate ? lte(e.occurredAt, new Date(new Date(endDate).setHours(23, 59, 59, 999))) : undefined,
        eq(e.eventStatus, 'POSTED'),
        isNull(e.voidedByEventId),
      );

    return this.db.query.stockEvents.findMany({
      where,
      orderBy: (e, { asc }) => [asc(e.occurredAt)],
    });
  }

  /** 특정 시점(as-of)의 수량 (그레인=창고/로케/상태) */
  async calculateQuantityAsOf(params: {
    skuId: string;
    warehouseId: string;
    locationId: string;
    state: (typeof wmsTables.stockLedgers.$inferSelect)['stockState'];
    at: Date;
  }): Promise<number> {
    const { skuId, warehouseId, locationId, state, at } = params;

    const [row] = await this.db
      .select({
        qtyAsOf: sql<number>`
          coalesce(sum(
            case when ${wmsTables.stockEvents.toState} = ${state}
               and ${wmsTables.stockEvents.toWarehouseId} = ${warehouseId}
               and ${wmsTables.stockEvents.toLocationId} = ${locationId}
             then ${wmsTables.stockEvents.quantity} else 0 end
          ),0)
          -
          coalesce(sum(
            case when ${wmsTables.stockEvents.fromState} = ${state}
               and ${wmsTables.stockEvents.fromWarehouseId} = ${warehouseId}
               and ${wmsTables.stockEvents.fromLocationId} = ${locationId}
             then ${wmsTables.stockEvents.quantity} else 0 end
          ),0)
        `,
      })
      .from(wmsTables.stockEvents)
      .where(
        and(
          eq(wmsTables.stockEvents.skuId, skuId),
          lte(wmsTables.stockEvents.occurredAt, at),
          eq(wmsTables.stockEvents.eventStatus, 'POSTED'),
          isNull(wmsTables.stockEvents.voidedByEventId),
        ),
      );

    return row?.qtyAsOf ?? 0;
  }

  /** 이벤트 통계 (전이 타입별 카운트/합계) */
  async getEventStatistics(params: { skuId: string; warehouseId?: string; startDate?: Date; endDate?: Date }) {
    const { skuId, warehouseId, startDate, endDate } = params;

    const events = await this.db.query.stockEvents.findMany({
      where: (e, { and, or, eq, gte, lte, isNull }) =>
        and(
          eq(e.skuId, skuId),
          warehouseId ? or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)) : undefined,
          startDate ? gte(e.occurredAt, startDate) : undefined,
          endDate ? lte(e.occurredAt, endDate) : undefined,
          eq(e.eventStatus, 'POSTED'),
          isNull(e.voidedByEventId),
        ),
    });

    const byType: Record<string, { count: number; totalQty: number }> = {};
    for (const ev of events) {
      const k = ev.transitionType as string;
      if (!byType[k]) byType[k] = { count: 0, totalQty: 0 };
      byType[k].count += 1;
      byType[k].totalQty += ev.quantity;
    }

    return {
      skuId,
      warehouseId: warehouseId ?? null,
      totalEvents: events.length,
      byTransitionType: byType,
    };
  }

  /** 최근 이벤트 (특정 창고 관점이면 from/to 모두 포함) */
  async getRecentEvents(limit = 100, warehouseId?: string) {
    return this.db.query.stockEvents.findMany({
      where: (e, { or, eq, isNull }) =>
        warehouseId
          ? and(
              or(eq(e.fromWarehouseId, warehouseId), eq(e.toWarehouseId, warehouseId)),
              eq(e.eventStatus, 'POSTED'),
              isNull(e.voidedByEventId),
            )
          : and(eq(e.eventStatus, 'POSTED'), isNull(e.voidedByEventId)),
      orderBy: (e, { desc }) => [desc(e.occurredAt)],
      limit,
      with: {
        sku: true,
      },
    });
  }

  // -----------------------------
  // 정정(역분개)
  // -----------------------------

  /** 이벤트 역분개(취소): 원 이벤트의 효과를 상쇄하는 반대 이벤트 생성 */
  async reverseEvent(eventId: string, reason: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const original = await trx.query.stockEvents.findFirst({
        where: eq(wmsTables.stockEvents.id, eventId),
      });
      if (!original) throw new BadRequestException(`Event ${eventId} not found`);
      if (original.eventStatus !== 'POSTED') {
        throw new BadRequestException('PENDING/VOIDED 이벤트는 역분개할 수 없습니다.');
      }

      // 전이 타입 역매핑
      const reverseType = this.getReversalType(original.transitionType);

      const [rev] = await trx
        .insert(wmsTables.stockEvents)
        .values({
          journalId: original.journalId,
          skuId: original.skuId,

          // 방향 반전: to → from, from → to
          fromWarehouseId: original.toWarehouseId,
          fromLocationId: original.toLocationId,
          toWarehouseId: original.fromWarehouseId,
          toLocationId: original.fromLocationId,

          fromState: original.toState,
          toState: original.fromState,
          transitionType: reverseType,

          quantity: original.quantity,
          occurredAt: new Date(),
          eventStatus: 'POSTED',
          reversalOfEventId: original.id,
          reason: `REVERSAL of ${original.id}: ${reason}`,
        })
        .returning();

      await this.applyProjection(trx, {
        skuId: rev.skuId,
        fromWarehouseId: rev.fromWarehouseId,
        fromLocationId: rev.fromLocationId,
        toWarehouseId: rev.toWarehouseId,
        toLocationId: rev.toLocationId,
        fromState: rev.fromState,
        toState: rev.toState,
        quantity: rev.quantity,
      });

      await this.productSellableQuantity.recalculateAndPublishForSku(rev.skuId, trx);

      this.logger.log(`Reversed event#${eventId} with new event#${rev.id} (${reverseType})`);
      return rev;
    }, tx);
  }

  private getReversalType(t: TransitionType): TransitionType {
    const map: Record<TransitionType, TransitionType> = {
      // 기본 흐름
      RECEIVE: 'ADJUST_DOWN',
      SHIP: 'ADJUST_UP',
      MOVE: 'MOVE', // 이동은 반대 방향 이동으로 역분개

      // 품질 관리
      MARK_DEFECT: 'REWORK_GOOD',
      REWORK_GOOD: 'MARK_DEFECT',
      SCRAP: 'ADJUST_UP', // 폐기 취소는 재고 증가

      // 수동 조정
      ADJUST_UP: 'ADJUST_DOWN',
      ADJUST_DOWN: 'ADJUST_UP',
    } as const;
    return map[t] ?? 'ADJUST_DOWN';
  }
}
