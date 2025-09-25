import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { and, eq, inArray } from 'drizzle-orm';
import { PoliciesService } from '../../shared/services/policies.service';
import { AvailabilityService } from '../../shared/services/availability.service';
import { EventPublisherService } from '@app/events';
import { FULFILLMENT_EVENTS } from '../../shared/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { AuditService } from '../../../shared/services/audit.service';
import { MatchingsService } from '../../matchings/services/matchings.service';


@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly availability: AvailabilityService,
    private readonly matchings?: MatchingsService,
    private readonly events?: EventPublisherService<any>,
    private readonly outbox?: OutboxService,
    private readonly audit?: AuditService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private async determineModeFromSalesOrder(trx: DbTx, salesOrderId: string): Promise<'in_house' | '3pl' | 'drop_ship' | 'mixed'> {
    const lines = await trx.query.salesOrderLines.findMany({ where: (l, { eq }) => eq(l.salesOrderId, salesOrderId) });
    if (lines.length === 0) return 'in_house';
    const modes = new Set<string>();
    for (const sl of lines) {
      const p = await this.policies.getVariantPolicy(sl.variantId, trx) as any;
      const m = p?.fulfillmentMode ?? 'in_house';
      modes.add(m);
    }
    if (modes.size > 1) return 'mixed';
    const [only] = Array.from(modes);
    return (only as any) as 'in_house' | '3pl' | 'drop_ship';
  }

  private async isDropShipFo(trx: DbTx, fo: { salesOrderId: string | null }): Promise<boolean> {
    if (!fo.salesOrderId) return false;
    const mode = await this.determineModeFromSalesOrder(trx, fo.salesOrderId);
    return mode === 'drop_ship';
  }

  async create(dto: any, tx?: DbTx) {
    // dto: { salesOrderId, warehouseId, shippingAddress, lines:[{ skuId, quantity }] }
    return this.inTx(async (trx) => {
      try {
        // 입력 검증
        if (dto.salesOrderId) {
          const salesOrder = await trx.query.salesOrders.findFirst({
            where: eq(wmsTables.salesOrders.id, dto.salesOrderId)
          });
          if (!salesOrder) {
            throw new BadRequestException(`Sales order ${dto.salesOrderId} not found`);
          }
          if (salesOrder.status === 'cancelled') {
            throw new BadRequestException(`Cannot create fulfillment for cancelled sales order ${dto.salesOrderId}`);
          }
        }

        if (dto.warehouseId) {
          const warehouse = await trx.query.warehouses.findFirst({
            where: eq(wmsTables.warehouses.id, dto.warehouseId)
          });
          if (!warehouse) {
            throw new BadRequestException(`Warehouse ${dto.warehouseId} not found`);
          }
        }

        this.logger.log(`Creating fulfillment order for SO: ${dto.salesOrderId || 'standalone'}`);

        const [fo] = await trx
          .insert(wmsTables.fulfillmentOrders)
          .values({
            salesOrderId: dto.salesOrderId ?? null,
            warehouseId: dto.warehouseId ?? null,
            ownerId: dto.ownerId ?? null,
            status: 'created',
            shippingAddress: dto.shippingAddress ?? null,
            labelNo: null,
          })
          .returning();

        if (!fo) {
          throw new Error('Failed to create fulfillment order');
        }

        await this.outbox?.enqueue({
          eventType: FULFILLMENT_EVENTS.CREATED,
          aggregateType: 'fulfillment',
          aggregateId: fo.id,
          partitionKey: fo.id,
          payload: { fulfillmentOrderId: fo.id }
        }, trx);

        const lines = Array.isArray(dto.lines) ? dto.lines : [];
        if (lines.length > 0) {
          // 라인 검증
          for (const line of lines) {
            if (!line.skuId || !line.quantity || line.quantity <= 0) {
              throw new BadRequestException(`Invalid line data: skuId and positive quantity are required`);
            }

            const sku = await trx.query.skus.findFirst({
              where: eq(wmsTables.skus.id, line.skuId)
            });
            if (!sku) {
              throw new BadRequestException(`SKU ${line.skuId} not found`);
            }
          }

          await trx.insert(wmsTables.fulfillmentOrderLines).values(
            lines.map((l: any) => ({
              fulfillmentOrderId: fo.id,
              skuId: l.skuId,
              quantity: l.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })),
          );
      } else if (dto.salesOrderId && this.matchings) {
        // SO 기반 자동 구성: SO 라인 매칭을 통해 SKU 라인 생성
      const mode = await this.determineModeFromSalesOrder(trx, dto.salesOrderId);
        if (mode === 'mixed') {
          throw new (await import('@nestjs/common')).BadRequestException('MIXED_FULFILLMENT_MODE_NOT_SUPPORTED');
        }
        if (mode === '3pl' && !dto.ownerId) {
          throw new (await import('@nestjs/common')).BadRequestException('OWNER_REQUIRED_FOR_3PL');
        }
        const soLines = await trx.query.salesOrderLines.findMany({ where: (l, { eq }) => eq(l.salesOrderId, dto.salesOrderId) });
        const toInsert: Array<{ fulfillmentOrderId: string; skuId: string; quantity: number; reservedQty: number; pickedQty: number; shippedQty: number; status: string; }> = [];
        for (const sl of soLines) {
          const m = await this.matchings.getByVariant(sl.variantId, trx);
          if (!m || !Array.isArray((m as any).links) || (m as any).links.length === 0) continue;
          for (const link of (m as any).links as Array<{ skuId: string; quantity: number }>) {
            toInsert.push({
              fulfillmentOrderId: fo.id,
              skuId: link.skuId,
              quantity: sl.quantity * Math.max(1, link.quantity | 0),
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            });
          }
        }
        if (toInsert.length > 0) {
          await trx.insert(wmsTables.fulfillmentOrderLines).values(toInsert);
        }
      }

      // 3PL: ownerId가 있으면 SKU.holderId 일치 검증
      if (fo.ownerId) {
        const fols = await trx.query.fulfillmentOrderLines.findMany({ where: (l, { eq }) => eq(l.fulfillmentOrderId, fo.id) });
        const skuIds = fols.map(l => l.skuId);
        if (skuIds.length > 0) {
          const skuRows = await trx.query.skus.findMany({ where: (s, { inArray }) => inArray(s.id, skuIds) as any });
          const mismatched = skuRows.find(s => s.holderId !== fo.ownerId);
          if (mismatched) {
            throw new (await import('@nestjs/common')).BadRequestException('SKU_HOLDER_MISMATCH_FOR_3PL');
          }
        }
      }

      // 가용성/정책 평가 후 FO 상태 설정
      const fols = await trx.query.fulfillmentOrderLines.findMany({ where: (l, { eq }) => eq(l.fulfillmentOrderId, fo.id) });
      let allFulfillable = true;
      // Drop-ship인 경우 로컬 가용성 검증을 생략하고 ready로 처리
      const isDrop = await this.isDropShipFo(trx, { salesOrderId: fo.salesOrderId });
      if (isDrop) {
        allFulfillable = true;
      } else {
      for (const l of fols) {
        // variant 정책은 SO 라인 기준이지만, 여기서는 SKU 기준으로 onHand만 평가
        const whId = dto.warehouseId ?? null;
        if (!whId) { allFulfillable = false; break; }
        const onHand = await this.availability.getAvailableQuantity(l.skuId, whId, trx);
        // 기본 정책: 재고관리 true 가정 시 onHand 비교만으로 fulfillability
        const policy = await this.policies.getVariantPolicy(l.skuId as any, trx) as any; // TODO: sku->variant 매핑 전 임시
        const canFulfill = this.policies.evaluateFulfillability(
          {
            inventoryManagement: policy?.inventoryManagement ?? true,
            preStockSellable: policy?.preStockSellable ?? false,
            alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
          },
          onHand,
          l.quantity,
        );
        if (!canFulfill) { allFulfillable = false; }
      }
      }
      if (allFulfillable) {
        await trx.update(wmsTables.fulfillmentOrders).set({ status: 'ready' }).where(eq(wmsTables.fulfillmentOrders.id, fo.id));
        try { await this.events?.publishEvent?.(FULFILLMENT_EVENTS.READY as any, { fulfillmentOrderId: fo.id } as any); } catch {}
          await this.outbox?.enqueue({
            eventType: FULFILLMENT_EVENTS.READY,
            aggregateType: 'fulfillment',
            aggregateId: fo.id,
            partitionKey: fo.id,
            payload: { fulfillmentOrderId: fo.id }
          }, trx);
        }

        this.logger.log(`Fulfillment order ${fo.id} created successfully with status: ${allFulfillable ? 'ready' : 'created'}`);
        return this.getOne(fo.id, trx);

      } catch (error) {
        this.logger.error(`Failed to create fulfillment order for SO ${dto.salesOrderId}:`, error);
        throw error;
      }
    }, tx);
  }

  async split(id: string, dto: any, tx?: DbTx) {
    // dto: { lines:[{ fulfillmentOrderLineId, quantity }] }
    return this.inTx(async (trx) => {
      // 1) 원본 FO 조회
      const origin = await trx.query.fulfillmentOrders.findFirst({ where: (t, { eq }) => eq(t.id, id) });
      if (!origin) return null;

      // 2) 새 FO 생성(헤더 복제)
      const [newFo] = await trx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: origin.salesOrderId,
          warehouseId: origin.warehouseId,
          ownerId: origin.ownerId,
          status: 'created',
          shippingAddress: origin.shippingAddress,
          labelNo: null,
        })
        .returning();

      // 3) 라인 분할 및 예약 처리
      const moves: Array<{ fulfillmentOrderLineId: string; quantity: number }> = dto?.lines ?? [];
      const splitItems: Array<{
        fulfillmentOrderLineId: string;
        skuId: string;
        splitQuantity: number;
        originalQuantity: number;
      }> = [];

      for (const mv of moves) {
        const line = await trx.query.fulfillmentOrderLines.findFirst({
          where: (l, { eq }) => eq(l.id, mv.fulfillmentOrderLineId),
        });
        if (!line) continue;
        const moveQty = Math.min(mv.quantity, line.quantity - line.shippedQty);
        if (moveQty <= 0) continue;

        // 원본 라인 수량 감소
        await trx
          .update(wmsTables.fulfillmentOrderLines)
          .set({
            quantity: line.quantity - moveQty,
            reservedQty: Math.max(0, line.reservedQty - moveQty) // 예약 수량도 조정
          })
          .where(eq(wmsTables.fulfillmentOrderLines.id, line.id));

        // 새 라인 생성
        const [newLine] = await trx.insert(wmsTables.fulfillmentOrderLines).values({
          fulfillmentOrderId: newFo.id,
          skuId: line.skuId,
          quantity: moveQty,
          reservedQty: 0, // 예약은 lifecycle service에서 처리
          pickedQty: 0,
          shippedQty: 0,
          status: 'pending',
        }).returning();

        // 예약 처리를 위한 정보 수집
        splitItems.push({
          fulfillmentOrderLineId: newLine.id,
          skuId: line.skuId,
          splitQuantity: moveQty,
          originalQuantity: line.quantity
        });
      }

      // 4) 예약 재분배 처리
      if (splitItems.length > 0) {
        // TODO: DI로 주입받도록 수정 필요
        const { ReservationLifecycleService } = await import('../../../shared/services/reservation-lifecycle.service');
        const { UnifiedReservationService } = await import('../../../shared/services/unified-reservation.service');

        const dbService = this.db; // 현재 DB 서비스 사용
        const unifiedReservation = new UnifiedReservationService(dbService as any);
        const lifecycleService = new ReservationLifecycleService(dbService as any, unifiedReservation);

        await lifecycleService.handleFulfillmentOrderSplit(
          id,
          newFo.id,
          splitItems,
          trx
        );
      }

      return newFo;
    }, tx);
  }

  async assignShipment(id: string, dto: any, tx?: DbTx) {
    // dto: { trackingNo, eta }
    return this.inTx(async (trx) => {
      await trx.insert(wmsTables.shipments).values({
        trackingNo: dto.trackingNo,
        status: 'created',
        eta: dto.eta ? new Date(dto.eta) : null,
        splitStatus: false,
        fulfillmentOrderId: id,
      });

      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'labeled' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));
      try { await this.events?.publishEvent?.(FULFILLMENT_EVENTS.LABELLED as any, { fulfillmentOrderId: id } as any); } catch {}
      await this.outbox?.enqueue({ eventType: FULFILLMENT_EVENTS.LABELLED, aggregateType: 'fulfillment', aggregateId: id, partitionKey: id, payload: { fulfillmentOrderId: id } }, trx);

      return this.getOne(id, trx);
    }, tx);
  }

  async ship(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const lines = await trx.query.fulfillmentOrderLines.findMany({
        where: (l, { eq }) => eq(l.fulfillmentOrderId, id),
      });
      for (const l of lines) {
        await trx
          .update(wmsTables.fulfillmentOrderLines)
          .set({ shippedQty: l.quantity, status: 'shipped' })
          .where(eq(wmsTables.fulfillmentOrderLines.id, l.id));
      }
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));
      try { await this.events?.publishEvent?.(FULFILLMENT_EVENTS.SHIPPED as any, { fulfillmentOrderId: id } as any); } catch {}
      await this.outbox?.enqueue({ eventType: FULFILLMENT_EVENTS.SHIPPED, aggregateType: 'fulfillment', aggregateId: id, partitionKey: id, payload: { fulfillmentOrderId: id } }, trx);
      return this.getOne(id, trx);
    }, tx);
  }

  async cancel(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));
      try { await this.events?.publishEvent?.(FULFILLMENT_EVENTS.CANCELLED as any, { fulfillmentOrderId: id } as any); } catch {}
      await this.outbox?.enqueue({ eventType: FULFILLMENT_EVENTS.CANCELLED, aggregateType: 'fulfillment', aggregateId: id, partitionKey: id, payload: { fulfillmentOrderId: id } }, trx);
      return this.getOne(id, trx);
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    return db.query.fulfillmentOrders.findFirst({
      where: (o, { eq }) => eq(o.id, id),
    });
  }

  async list(params: { limit: number; offset: number }, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const rows = await db.query.fulfillmentOrders.findMany({
      limit: params.limit,
      offset: params.offset,
      orderBy: (o, { desc }) => [desc(o.createdAt as any)] as any,
    } as any);
    return rows;
  }

  async checkAvailability(fulfillmentOrderId: string, tx?: DbTx) {
    const fo = await this.getOne(fulfillmentOrderId, tx);
    if (!fo?.warehouseId) return { ready: false };
    const db = tx ?? this.db.db;
    const lines = await db.query.fulfillmentOrderLines.findMany({ where: (l, { eq }) => eq(l.fulfillmentOrderId, fulfillmentOrderId) });
    let allOk = true;
    for (const l of lines) {
      const onHand = await this.availability.getAvailableQuantity(l.skuId, fo.warehouseId, tx);
      const policy = await this.policies.getVariantPolicy(l.skuId as any, tx) as any; // TODO: sku->variant 매핑 필요
      const can = this.policies.evaluateFulfillability(
        {
          inventoryManagement: policy?.inventoryManagement ?? true,
          preStockSellable: policy?.preStockSellable ?? false,
          alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
        },
        onHand,
        l.quantity,
      );
      if (!can) { allOk = false; break; }
    }
    return { ready: allOk };
  }
}


