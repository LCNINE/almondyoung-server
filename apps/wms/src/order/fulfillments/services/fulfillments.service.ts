import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { and, eq, inArray, desc } from 'drizzle-orm';
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
import { FulfillmentShippedPayload, FulfillmentCancelledPayload, Carrier } from '@packages/event-contracts/streams';

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

  private async determineModeFromSalesOrder(
    trx: DbTx,
    salesOrderId: string,
  ): Promise<'in_house' | '3pl' | 'drop_ship' | 'mixed'> {
    type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';
    const lines = await trx.query.salesOrderLines.findMany({
      where: (l, { eq: eqOp }) => eqOp(l.salesOrderId, salesOrderId),
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
            where: eq(wmsTables.salesOrders.id, dto.salesOrderId),
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
            where: eq(wmsTables.warehouses.id, dto.warehouseId),
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

        await this.outbox?.enqueue(
          {
            eventType: FULFILLMENT_EVENTS.CREATED,
            aggregateType: 'fulfillment',
            aggregateId: fo.id,
            partitionKey: fo.id,
            payload: { fulfillmentOrderId: fo.id },
          },
          trx,
        );

        // dto.items (신규) 또는 dto.lines (deprecated) 처리
        const items = Array.isArray(dto.items) ? dto.items : [];
        const legacyLines = Array.isArray(dto.lines) ? dto.lines : [];

        if (items.length > 0) {
          // 명시적 아이템 전달: fulfillmentOrderItems에 저장
          for (const item of items) {
            if (!item.skuId || !item.quantity || item.quantity <= 0) {
              throw new BadRequestException(`Invalid item data: skuId and positive quantity are required`);
            }

            const sku = await trx.query.skus.findFirst({
              where: eq(wmsTables.skus.id, item.skuId),
            });
            if (!sku) {
              throw new BadRequestException(`SKU ${item.skuId} not found`);
            }
          }

          await trx.insert(wmsTables.fulfillmentOrderItems).values(
            items.map((item) => ({
              fulfillmentOrderId: fo.id,
              salesOrderId: dto.salesOrderId ?? null,
              salesOrderLineId: item.salesOrderLineId ?? null,
              mappingSnapshotId: item.mappingSnapshotId ?? null,
              variantId: item.variantId ?? null,
              skuId: item.skuId,
              qty: item.quantity,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })),
          );
        } else if (legacyLines.length > 0) {
          // 레거시 경로: dto.lines 사용 (deprecated)
          this.logger.warn(`[create] Using deprecated 'lines' field for FO creation. Please use 'items' instead.`);

          for (const line of legacyLines) {
            if (!line.skuId || !line.quantity || line.quantity <= 0) {
              throw new BadRequestException(`Invalid line data: skuId and positive quantity are required`);
            }

            const sku = await trx.query.skus.findFirst({
              where: eq(wmsTables.skus.id, line.skuId),
            });
            if (!sku) {
              throw new BadRequestException(`SKU ${line.skuId} not found`);
            }
          }

          await trx.insert(wmsTables.fulfillmentOrderItems).values(
            legacyLines.map((l) => ({
              fulfillmentOrderId: fo.id,
              salesOrderId: dto.salesOrderId ?? null,
              salesOrderLineId: null,
              mappingSnapshotId: null,
              variantId: null,
              skuId: l.skuId,
              qty: l.quantity,
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
            where: eq(wmsTables.salesOrderLines.salesOrderId, dto.salesOrderId),
          });

          // fulfillmentOrderItems 데이터
          const itemsToInsert: Array<{
            fulfillmentOrderId: string;
            salesOrderId: string;
            salesOrderLineId: string;
            mappingSnapshotId: string | null;
            variantId: string;
            skuId: string;
            qty: number;
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
                  itemsToInsert.push({
                    fulfillmentOrderId: fo.id,
                    salesOrderId: dto.salesOrderId,
                    salesOrderLineId: sl.id,
                    mappingSnapshotId: null,
                    variantId: sl.variantId,
                    skuId: link.skuId,
                    qty,
                    reservedQty: 0,
                    pickedQty: 0,
                    shippedQty: 0,
                    status: 'pending',
                  });
                }
              }
            }
          }

          // fulfillmentOrderItems 삽입
          if (itemsToInsert.length > 0) {
            await trx.insert(wmsTables.fulfillmentOrderItems).values(itemsToInsert);
            this.logger.log(`Created ${itemsToInsert.length} fulfillment order items`);
          }
        }

        // 3PL: ownerId가 있으면 SKU.holderId 일치 검증
        if (fo.ownerId) {
          const fois = await trx.query.fulfillmentOrderItems.findMany({
            where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id),
          });
          const skuIds = fois.map((item) => item.skuId);
          if (skuIds.length > 0) {
            const skuRows = await trx.query.skus.findMany({
              where: (s, { inArray: ina }) => ina(s.id, skuIds),
            });
            const mismatched = skuRows.find((s) => s.holderId !== fo.ownerId);
            if (mismatched) {
              throw new BadRequestException('SKU_HOLDER_MISMATCH_FOR_3PL');
            }
          }
        }

        // 가용성/정책 평가 후 FO 상태 설정
        const allFulfillable = await this.evaluateFulfillability(trx, fo.id, dto.warehouseId ?? null);

        if (allFulfillable) {
          await trx
            .update(wmsTables.fulfillmentOrders)
            .set({ status: 'ready' })
            .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
          await this.outbox?.enqueue(
            {
              eventType: FULFILLMENT_EVENTS.READY,
              aggregateType: 'fulfillment',
              aggregateId: fo.id,
              partitionKey: fo.id,
              payload: { fulfillmentOrderId: fo.id },
            },
            trx,
          );
        }

        this.logger.log(
          `Fulfillment order ${fo.id} created successfully with status: ${allFulfillable ? 'ready' : 'created'}`,
        );
        return this.getOne(fo.id, trx);
      } catch (error) {
        this.logger.error(`Failed to create fulfillment order for SO ${dto.salesOrderId}:`, error);
        throw error;
      }
    }, tx);
  }

  /**
   * FO의 출고 가능 여부 평가
   * fulfillmentOrderItems의 variantId 기반으로 정책 평가 (variantId가 없으면 기본 정책 사용)
   */
  private async evaluateFulfillability(trx: DbTx, foId: string, warehouseId: string | null): Promise<boolean> {
    const fo = await trx.query.fulfillmentOrders.findFirst({
      where: eq(wmsTables.fulfillmentOrders.id, foId),
    });
    if (!fo) return false;

    // Drop-ship인 경우 로컬 가용성 검증 생략
    const isDrop = await this.isDropShipFo(trx, { salesOrderId: fo.salesOrderId });
    if (isDrop) return true;

    if (!warehouseId) return false;

    const items = await trx.query.fulfillmentOrderItems.findMany({
      where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId),
    });

    if (items.length === 0) return true;

    for (const item of items) {
      const onHand = await this.availability.getAvailableQuantity(item.skuId, warehouseId, trx);

      // variantId가 있으면 정책 조회, 없으면 기본 정책 사용
      const policy = item.variantId ? await this.policies.getVariantPolicy(item.variantId, trx) : null;

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

      // 3) 아이템 분할 및 예약 처리
      const itemMoves = dto?.items ?? [];
      const legacyMoves = dto?.lines ?? [];

      // 신규 경로: dto.items 사용
      if (itemMoves.length > 0) {
        const splitItems: Array<{
          fulfillmentOrderItemId: string;
          skuId: string;
          splitQuantity: number;
          originalQuantity: number;
        }> = [];

        for (const mv of itemMoves) {
          const item = await trx.query.fulfillmentOrderItems.findFirst({
            where: eq(wmsTables.fulfillmentOrderItems.id, mv.fulfillmentOrderItemId),
          });
          if (!item) continue;
          const moveQty = Math.min(mv.quantity, item.qty - item.shippedQty);
          if (moveQty <= 0) continue;

          // 원본 아이템 수량 감소
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
              reservedQty: Math.max(0, item.reservedQty - moveQty),
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

          // 새 아이템 생성
          const [newItem] = await trx
            .insert(wmsTables.fulfillmentOrderItems)
            .values({
              fulfillmentOrderId: newFo.id,
              salesOrderId: item.salesOrderId,
              salesOrderLineId: item.salesOrderLineId,
              mappingSnapshotId: item.mappingSnapshotId,
              variantId: item.variantId,
              skuId: item.skuId,
              qty: moveQty,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })
            .returning();

          splitItems.push({
            fulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantity: item.qty,
          });
        }

        // 예약 재분배 처리
        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
      }
      // 레거시 경로: dto.lines 사용 (deprecated)
      else if (legacyMoves.length > 0) {
        this.logger.warn(`[split] Using deprecated 'lines' field. Please use 'items' instead.`);

        // 레거시: fulfillmentOrderLineId로 fulfillmentOrderItems 조회
        const splitItems: Array<{
          fulfillmentOrderItemId: string;
          skuId: string;
          splitQuantity: number;
          originalQuantity: number;
        }> = [];

        for (const mv of legacyMoves) {
          // fulfillmentOrderLineId는 이제 fulfillmentOrderItemId로 간주
          const item = await trx.query.fulfillmentOrderItems.findFirst({
            where: eq(wmsTables.fulfillmentOrderItems.id, mv.fulfillmentOrderLineId),
          });
          if (!item) continue;
          const moveQty = Math.min(mv.quantity, item.qty - item.shippedQty);
          if (moveQty <= 0) continue;

          // 원본 아이템 수량 감소
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({
              qty: item.qty - moveQty,
              reservedQty: Math.max(0, item.reservedQty - moveQty),
              updatedAt: new Date(),
            })
            .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));

          // 새 아이템 생성
          const [newItem] = await trx
            .insert(wmsTables.fulfillmentOrderItems)
            .values({
              fulfillmentOrderId: newFo.id,
              salesOrderId: item.salesOrderId,
              salesOrderLineId: item.salesOrderLineId,
              mappingSnapshotId: item.mappingSnapshotId,
              variantId: item.variantId,
              skuId: item.skuId,
              qty: moveQty,
              reservedQty: 0,
              pickedQty: 0,
              shippedQty: 0,
              status: 'pending',
            })
            .returning();

          splitItems.push({
            fulfillmentOrderItemId: newItem.id,
            skuId: item.skuId,
            splitQuantity: moveQty,
            originalQuantity: item.qty,
          });
        }

        // 예약 재분배 처리
        if (splitItems.length > 0) {
          await this.reservationLifecycle.handleFulfillmentOrderSplit(id, newFo.id, splitItems, trx);
        }
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
      await this.outbox?.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.LABELLED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: id,
          payload: { fulfillmentOrderId: id },
        },
        trx,
      );

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

      // 아이템 업데이트
      const items = await trx.query.fulfillmentOrderItems.findMany({
        where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, id),
      });
      for (const item of items) {
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({ shippedQty: item.qty, status: 'shipped', updatedAt: new Date() })
          .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
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
        shippedItems: items.map((item) => ({
          fulfillmentItemId: item.id,
          skuId: item.skuId,
          shippedQty: item.qty,
        })),
      };

      await this.outbox?.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.SHIPPED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: shippedPayload,
        },
        trx,
      );

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

      await this.outbox?.enqueue(
        {
          eventType: FULFILLMENT_EVENTS.CANCELLED,
          aggregateType: 'fulfillment',
          aggregateId: id,
          partitionKey: fo.salesOrderId ?? id,
          payload: cancelledPayload,
        },
        trx,
      );

      return this.getOne(id, trx);
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;

    // 1. Fulfillment Order 조회
    const [fulfillmentOrder] = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, id))
      .limit(1);

    if (!fulfillmentOrder) {
      return null;
    }

    // 2. Invoice 조회 (있으면)
    const invoiceRows = await db
      .select({
        id: wmsTables.invoices.id,
        invoiceNumber: wmsTables.invoices.invoiceNumber,
        status: wmsTables.invoices.status,
        carrierCode: wmsTables.invoices.carrierCode,
        issueMethod: wmsTables.invoices.issueMethod,
      })
      .from(wmsTables.invoices)
      .where(eq(wmsTables.invoices.fulfillmentOrderId, id))
      .limit(1);

    const invoice = invoiceRows[0] || null;

    // 3. Fulfillment Order에 Invoice 정보 추가
    return {
      ...fulfillmentOrder,
      invoice: invoice || null,
    };
  }

  async list(params: { limit: number; offset: number }, tx?: DbTx) {
    const db = tx ?? this.db.db;

    // 1. Fulfillment Order 목록 조회
    const fulfillmentOrders = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .limit(params.limit)
      .offset(params.offset)
      .orderBy(desc(wmsTables.fulfillmentOrders.createdAt));

    if (fulfillmentOrders.length === 0) {
      return [];
    }

    // 2. Fulfillment Order ID 목록 추출
    const fulfillmentOrderIds = fulfillmentOrders.map((fo) => fo.id);

    // 3. Invoice 목록 조회 (한 번에)
    const invoices = await db
      .select({
        id: wmsTables.invoices.id,
        fulfillmentOrderId: wmsTables.invoices.fulfillmentOrderId,
        invoiceNumber: wmsTables.invoices.invoiceNumber,
        status: wmsTables.invoices.status,
        carrierCode: wmsTables.invoices.carrierCode,
        issueMethod: wmsTables.invoices.issueMethod,
      })
      .from(wmsTables.invoices)
      .where(inArray(wmsTables.invoices.fulfillmentOrderId, fulfillmentOrderIds));

    // 4. Invoice를 Fulfillment Order ID별로 그룹화
    const invoicesByFoId = new Map<string, (typeof invoices)[0]>();
    for (const invoice of invoices) {
      invoicesByFoId.set(invoice.fulfillmentOrderId, invoice);
    }

    // 5. Fulfillment Order에 Invoice 정보 추가
    return fulfillmentOrders.map((fo) => ({
      ...fo,
      invoice: invoicesByFoId.get(fo.id) || null,
    }));
  }

  async checkAvailability(fulfillmentOrderId: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const fo = await this.getOne(fulfillmentOrderId, trx);
      if (!fo?.warehouseId) return { ready: false };

      const items = await trx.query.fulfillmentOrderItems.findMany({
        where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId),
      });

      if (items.length === 0) return { ready: true };

      for (const item of items) {
        const onHand = await this.availability.getAvailableQuantity(item.skuId, fo.warehouseId, trx);

        // variantId가 있으면 정책 조회, 없으면 기본 정책 사용
        const policy = item.variantId ? await this.policies.getVariantPolicy(item.variantId, trx) : null;

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
    }, tx);
  }
}
