import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { and, eq, inArray } from 'drizzle-orm';
import { PoliciesService } from '../../shared/services/policies.service';
import { AvailabilityService } from '../../shared/services/availability.service';
import { FULFILLMENT_EVENTS } from '../../shared/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { AuditService } from '../../../shared/services/audit.service';
import { MatchingsService } from '../../matchings/services/matchings.service';
import { ReservationLifecycleService } from '../../../shared/services/reservation-lifecycle.service';
import { ProductSkuMappingService } from '../../shared/services/product-sku-mapping.service';
import { CreateFulfillmentOrderDto } from '../dto/create-fulfillment-order.dto';
import { SplitFulfillmentOrderDto } from '../dto/split-fulfillment-order.dto';
import { AssignShipmentDto } from '../dto/assign-shipment.dto';
import {
  FulfillmentShippedPayload,
  FulfillmentCancelledPayload,
  Carrier,
} from '@packages/event-contracts/streams';


@Injectable()
export class FulfillmentsService {
  private readonly logger = new Logger(FulfillmentsService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly availability: AvailabilityService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly matchings?: MatchingsService,
    private readonly outbox?: OutboxService,
    private readonly audit?: AuditService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  private async determineModeFromSalesOrder(trx: DbTx, salesOrderId: string): Promise<'in_house' | '3pl' | 'drop_ship' | 'mixed'> {
    type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';
    const lines = await trx.query.salesOrderLines.findMany({
      where: (l, { eq: eqOp }) => eqOp(l.salesOrderId, salesOrderId)
    });
    if (lines.length === 0) return 'in_house';

    const modes = new Set<FulfillmentMode>();
    for (const sl of lines) {
      const policy = await this.policies.getVariantPolicy(sl.variantId, trx);
      const mode: FulfillmentMode = (policy?.fulfillmentMode as FulfillmentMode) ?? 'in_house';
      modes.add(mode);
    }

    if (modes.size > 1) return 'mixed';
    const [only] = Array.from(modes);
    return only;
  }

  private async isDropShipFo(trx: DbTx, fo: { salesOrderId: string | null }): Promise<boolean> {
    if (!fo.salesOrderId) return false;
    const mode = await this.determineModeFromSalesOrder(trx, fo.salesOrderId);
    return mode === 'drop_ship';
  }

  async create(dto: CreateFulfillmentOrderDto, tx?: DbTx) {
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
          // 명시적 라인 전달: 레거시 fulfillmentOrderLines에 저장
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
            lines.map((l) => ({
              fulfillmentOrderId: fo.id,
              skuId: l.skuId,
              quantity: l.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })),
          );
        } else if (dto.salesOrderId) {
          // SO 기반 자동 구성: 스냅샷 방식 우선, 폴백으로 실시간 매칭
          const mode = await this.determineModeFromSalesOrder(trx, dto.salesOrderId);
          if (mode === 'mixed') {
            throw new BadRequestException('MIXED_FULFILLMENT_MODE_NOT_SUPPORTED');
          }
          if (mode === '3pl' && !dto.ownerId) {
            throw new BadRequestException('OWNER_REQUIRED_FOR_3PL');
          }

          const soLines = await trx.query.salesOrderLines.findMany({
            where: eq(wmsTables.salesOrderLines.salesOrderId, dto.salesOrderId)
          });

          // fulfillmentOrderItems 데이터 (스냅샷 기반)
          const itemsToInsert: Array<{
            fulfillmentOrderId: string;
            salesOrderId: string;
            salesOrderLineId: string;
            mappingSnapshotId: string;
            variantId: string;
            skuId: string;
            qty: number;
            reservedQty: number;
            pickedQty: number;
            shippedQty: number;
          }> = [];

          // fulfillmentOrderLines 데이터 (레거시 호환성)
          const linesToInsert: Array<{
            fulfillmentOrderId: string;
            skuId: string;
            quantity: number;
            reservedQty: number;
            pickedQty: number;
            shippedQty: number;
            status: string;
          }> = [];

          for (const sl of soLines) {
            if (sl.mappingSnapshotId) {
              // 스냅샷 기반: SO 확정 시 저장된 스냅샷 활용
              const snapshot = await this.productSkuMapping.getMappingSnapshot(sl.mappingSnapshotId, trx);
              if (snapshot && snapshot.mappings.length > 0) {
                for (const mapping of snapshot.mappings) {
                  const qty = sl.quantity * Math.max(1, mapping.quantity);

                  itemsToInsert.push({
                    fulfillmentOrderId: fo.id,
                    salesOrderId: dto.salesOrderId,
                    salesOrderLineId: sl.id,
                    mappingSnapshotId: sl.mappingSnapshotId,
                    variantId: sl.variantId,
                    skuId: mapping.skuId,
                    qty,
                    reservedQty: 0,
                    pickedQty: 0,
                    shippedQty: 0,
                  });

                  // 레거시 호환성을 위해 fulfillmentOrderLines에도 저장
                  linesToInsert.push({
                    fulfillmentOrderId: fo.id,
                    skuId: mapping.skuId,
                    quantity: qty,
                    reservedQty: 0,
                    pickedQty: 0,
                    shippedQty: 0,
                    status: 'pending',
                  });
                }
                continue;
              }
            }

            // 폴백: 실시간 매칭 사용 (스냅샷이 없는 경우)
            if (this.matchings) {
              const matching = await this.matchings.getByVariant(sl.variantId, trx);
              if (matching && Array.isArray((matching as { links?: unknown[] }).links)) {
                const links = (matching as { links: Array<{ skuId: string; quantity: number }> }).links;
                for (const link of links) {
                  const qty = sl.quantity * Math.max(1, link.quantity || 1);
                  linesToInsert.push({
                    fulfillmentOrderId: fo.id,
                    skuId: link.skuId,
                    quantity: qty,
                    reservedQty: 0,
                    pickedQty: 0,
                    shippedQty: 0,
                    status: 'pending',
                  });
                }
              }
            }
          }

          // fulfillmentOrderItems 삽입 (스냅샷 기반)
          if (itemsToInsert.length > 0) {
            await trx.insert(wmsTables.fulfillmentOrderItems).values(itemsToInsert);
            this.logger.log(`Created ${itemsToInsert.length} fulfillment order items (snapshot-based)`);
          }

          // fulfillmentOrderLines 삽입 (레거시 호환성)
          if (linesToInsert.length > 0) {
            await trx.insert(wmsTables.fulfillmentOrderLines).values(linesToInsert);
          }
        }

        // 3PL: ownerId가 있으면 SKU.holderId 일치 검증
        if (fo.ownerId) {
          const fols = await trx.query.fulfillmentOrderLines.findMany({
            where: eq(wmsTables.fulfillmentOrderLines.fulfillmentOrderId, fo.id)
          });
          const skuIds = fols.map(l => l.skuId);
          if (skuIds.length > 0) {
            const skuRows = await trx.query.skus.findMany({
              where: (s, { inArray: ina }) => ina(s.id, skuIds) as ReturnType<typeof ina>
            });
            const mismatched = skuRows.find(s => s.holderId !== fo.ownerId);
            if (mismatched) {
              throw new BadRequestException('SKU_HOLDER_MISMATCH_FOR_3PL');
            }
          }
        }

        // 가용성/정책 평가 후 FO 상태 설정
        const allFulfillable = await this.evaluateFulfillability(trx, fo.id, dto.warehouseId ?? null);

        if (allFulfillable) {
          await trx.update(wmsTables.fulfillmentOrders)
            .set({ status: 'ready' })
            .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
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

  /**
   * FO의 출고 가능 여부 평가
   * fulfillmentOrderItems가 있으면 variantId 기반으로, 없으면 레거시 방식으로 평가
   */
  private async evaluateFulfillability(trx: DbTx, foId: string, warehouseId: string | null): Promise<boolean> {
    const fo = await trx.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, foId)
    });
    if (!fo) return false;

    // Drop-ship인 경우 로컬 가용성 검증 생략
    const isDrop = await this.isDropShipFo(trx, { salesOrderId: fo.salesOrderId });
    if (isDrop) return true;

    if (!warehouseId) return false;

    // fulfillmentOrderItems 확인 (스냅샷 기반)
    const items = await trx.query.fulfillmentOrderItems.findMany({
      where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId)
    });

    if (items.length > 0) {
      // 스냅샷 기반: variantId로 정책 평가
      for (const item of items) {
        const onHand = await this.availability.getAvailableQuantity(item.skuId, warehouseId, trx);
        const policy = await this.policies.getVariantPolicy(item.variantId, trx);
        const canFulfill = this.policies.evaluateFulfillability(
          {
            inventoryManagement: policy?.inventoryManagement ?? true,
            preStockSellable: policy?.preStockSellable ?? false,
            alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
          },
          onHand,
          item.qty,
        );
        if (!canFulfill) return false;
      }
      return true;
    }

    // 레거시: fulfillmentOrderLines 기반 평가 (variantId 없음)
    // TODO: 레거시 데이터 마이그레이션 후 이 경로 제거
    const fols = await trx.query.fulfillmentOrderLines.findMany({
      where: eq(wmsTables.fulfillmentOrderLines.fulfillmentOrderId, foId)
    });

    if (fols.length > 0) {
      this.logger.warn(`[evaluateFulfillability] Legacy path used for FO ${foId} - variantId unavailable, using default policy`);
    }

    for (const l of fols) {
      const onHand = await this.availability.getAvailableQuantity(l.skuId, warehouseId, trx);
      // 레거시: variantId가 없으므로 기본 정책(재고관리=true) 적용
      const canFulfill = this.policies.evaluateFulfillability(
        {
          inventoryManagement: true,
          preStockSellable: false,
          alwaysSellableZeroStock: false,
        },
        onHand,
        l.quantity,
      );
      if (!canFulfill) return false;
    }

    return true;
  }

  async split(id: string, dto: SplitFulfillmentOrderDto, tx?: DbTx) {
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
        // 예약 재분배는 예약 생명주기 서비스에 위임 (DI 사용)
        await this.reservationLifecycle.handleFulfillmentOrderSplit(
          id,
          newFo.id,
          splitItems,
          trx
        );
      }

      return newFo;
    }, tx);
  }

  async assignShipment(id: string, dto: AssignShipmentDto, tx?: DbTx) {
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
      await this.outbox?.enqueue({ eventType: FULFILLMENT_EVENTS.LABELLED, aggregateType: 'fulfillment', aggregateId: id, partitionKey: id, payload: { fulfillmentOrderId: id } }, trx);

      return this.getOne(id, trx);
    }, tx);
  }

  async ship(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // FO 조회
      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, id),
      });
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${id} not found`);
      }

      // Shipment 조회 (송장 정보)
      const shipment = await trx.query.shipments.findFirst({
        where: eq(wmsTables.shipments.fulfillmentOrderId, id),
      });

      // 라인 업데이트
      const lines = await trx.query.fulfillmentOrderLines.findMany({
        where: (l, { eq: eqOp }) => eqOp(l.fulfillmentOrderId, id),
      });
      for (const l of lines) {
        await trx
          .update(wmsTables.fulfillmentOrderLines)
          .set({ shippedQty: l.quantity, status: 'shipped' })
          .where(eq(wmsTables.fulfillmentOrderLines.id, l.id));
      }

      // FO 상태 업데이트
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      // FulfillmentShipped 이벤트 payload 생성
      const shippedPayload: FulfillmentShippedPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        trackingInfo: {
          carrier: (shipment?.carrier as Carrier) ?? 'CJ',
          trackingNumber: shipment?.trackingNo ?? '',
          invoiceUrl: shipment?.invoiceUrl ?? undefined,
        },
        shippedAt: new Date().toISOString(),
        estimatedDeliveryDate: shipment?.eta?.toISOString(),
        shippedItems: lines.map((l) => ({
          fulfillmentItemId: l.id,
          skuId: l.skuId,
          shippedQty: l.quantity,
        })),
      };

      await this.outbox?.enqueue({
        eventType: FULFILLMENT_EVENTS.SHIPPED,
        aggregateType: 'fulfillment',
        aggregateId: id,
        partitionKey: fo.salesOrderId ?? id,
        payload: shippedPayload,
      }, trx);

      return this.getOne(id, trx);
    }, tx);
  }

  async cancel(
    id: string,
    options?: {
      reason?: 'ORDER_CANCELLED' | 'OUT_OF_STOCK' | 'ADMIN_CANCEL';
      reasonDetail?: string;
      cancelledBy?: string;
    },
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      // FO 조회
      const fo = await trx.query.fulfillmentOrders.findFirst({
        where: eq(wmsTables.fulfillmentOrders.id, id),
      });
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${id} not found`);
      }

      // FO 상태 업데이트
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, id));

      // FulfillmentCancelled 이벤트 payload 생성
      const cancelledPayload: FulfillmentCancelledPayload = {
        fulfillmentId: id,
        orderId: fo.salesOrderId ?? '',
        reason: options?.reason ?? 'ADMIN_CANCEL',
        reasonDetail: options?.reasonDetail,
        cancelledBy: options?.cancelledBy ?? 'system',
        cancelledAt: new Date().toISOString(),
      };

      await this.outbox?.enqueue({
        eventType: FULFILLMENT_EVENTS.CANCELLED,
        aggregateType: 'fulfillment',
        aggregateId: id,
        partitionKey: fo.salesOrderId ?? id,
        payload: cancelledPayload,
      }, trx);

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
    return this.inTx(async (trx) => {
      const fo = await this.getOne(fulfillmentOrderId, trx);
      if (!fo?.warehouseId) return { ready: false };

      // fulfillmentOrderItems 확인 (스냅샷 기반)
      const items = await trx.query.fulfillmentOrderItems.findMany({
        where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId)
      });

      if (items.length > 0) {
        // 스냅샷 기반: variantId로 정책 평가
        for (const item of items) {
          const onHand = await this.availability.getAvailableQuantity(item.skuId, fo.warehouseId, trx);
          const policy = await this.policies.getVariantPolicy(item.variantId, trx);
          const canFulfill = this.policies.evaluateFulfillability(
            {
              inventoryManagement: policy?.inventoryManagement ?? true,
              preStockSellable: policy?.preStockSellable ?? false,
              alwaysSellableZeroStock: policy?.alwaysSellableZeroStock ?? false,
            },
            onHand,
            item.qty,
          );
          if (!canFulfill) return { ready: false };
        }
        return { ready: true };
      }

      // 레거시: fulfillmentOrderLines 기반 평가 (variantId 없음)
      // TODO: 레거시 데이터 마이그레이션 후 이 경로 제거
      const lines = await trx.query.fulfillmentOrderLines.findMany({
        where: eq(wmsTables.fulfillmentOrderLines.fulfillmentOrderId, fulfillmentOrderId)
      });

      if (lines.length > 0) {
        this.logger.warn(`[checkAvailability] Legacy path used for FO ${fulfillmentOrderId} - variantId unavailable, using default policy`);
      }

      for (const l of lines) {
        const onHand = await this.availability.getAvailableQuantity(l.skuId, fo.warehouseId, trx);
        // 레거시: variantId가 없으므로 기본 정책(재고관리=true) 적용
        const canFulfill = this.policies.evaluateFulfillability(
          {
            inventoryManagement: true,
            preStockSellable: false,
            alwaysSellableZeroStock: false,
          },
          onHand,
          l.quantity,
        );
        if (!canFulfill) return { ready: false };
      }

      return { ready: true };
    }, tx);
  }
}


