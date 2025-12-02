import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq, inArray, desc, and, gte, lte, type InferInsertModel, type SQL } from 'drizzle-orm';
import { PoliciesService } from '../../shared/services/policies.service';
import { FulfillmentsService } from '../../fulfillments/services/fulfillments.service';
import { ORDER_EVENTS } from '../../shared/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { ReservationLifecycleService } from '../../../shared/services/reservation-lifecycle.service';
import { AuditService } from '../../../shared/services/audit.service';
import { MetricsService } from '../../../shared/services/metrics.service';
import { ProductSkuMappingService } from '../../shared/services/product-sku-mapping.service';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { MergeSalesOrdersDto } from '../dto/merge-sales-orders.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { AddressDto } from '../../shared/dto/address.dto';
import { OrderCreatedPayload, OrderModifiedPayload, ShippingAddress, OrderItem } from '@packages/event-contracts';

type SalesOrderLineInsert = InferInsertModel<typeof wmsTables.salesOrderLines>;

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly outbox: OutboxService,
    private readonly fulfillments: FulfillmentsService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly audit?: AuditService,
    private readonly metrics?: MetricsService,
  ) { }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async create(dto: CreateSalesOrderDto, tx?: DbTx) {
    const timer = this.metrics?.startOrderTimer('create');
    const startTime = Date.now();

    return this.inTx(async (trx) => {
      const [order] = await trx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: dto.channelOrderId,
          salesChannel: dto.salesChannel as 'naver' | 'medusa' | 'coupang' | '3pl',
          status: 'pending' as const,
          customerName: dto.customer?.name ?? null,
          customerEmail: dto.customer?.email ?? null,
          customerPhone: dto.customer?.phone ?? null,
          shippingAddress: dto.shippingAddress as any,
          shippingAddressHash: dto.shippingAddressHash ?? null,
          totalAmount: dto.totalAmount ?? null,
          shippingFee: dto.shippingFee ?? 0,
          mergeGroupId: dto.mergeGroupId ?? null,
          isMerged: false,
          orderDate: new Date(dto.orderDate ?? Date.now()),
          confirmedAt: null,
          processedAt: null,
        })
        .returning();

      await this.outbox?.enqueue({
        eventType: ORDER_EVENTS.CREATED,
        aggregateType: 'order',
        aggregateId: order.id,
        partitionKey: order.id,
        payload: { orderId: order.id },
      }, trx);

      const lines = Array.isArray(dto.lines) ? dto.lines : [];
      if (lines.length > 0) {
        const values: SalesOrderLineInsert[] = [];
        for (const l of lines) {
          const policy = await this.policies.getVariantPolicy(l.variantId, trx);
          const acceptanceByPolicy = !policy.inventoryManagement || policy.preStockSellable || policy.alwaysSellableZeroStock;
          values.push({
            salesOrderId: order.id,
            variantId: l.variantId,
            productMatchingId: l.productMatchingId ?? null,
            productName: l.productName ?? '',
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? null,
            totalPrice: l.totalPrice ?? null,
            status: 'pending',
            // 정책만으로 접수 가능하면 제안 수량을 원요청으로 설정(향후 매칭/가용성 반영 예정)
            suggestedQuantity: acceptanceByPolicy ? l.quantity : null,
            unavailableSkuIds: null,
            deductedAt: null,
          });
        }
        await trx.insert(wmsTables.salesOrderLines).values(values);
      }

      // 감사 로그 기록
      await this.audit?.logResourceChange(
        'ORDER_CREATED',
        'create',
        'order',
        'salesOrder',
        order.id,
        `Sales Order ${dto.channelOrderId || order.id}`,
        undefined,
        {
          channelOrderId: order.channelOrderId,
          salesChannel: order.salesChannel,
          customerName: order.customerName,
          totalAmount: order.totalAmount,
          lineCount: lines.length,
        },
        undefined, // context - 실제로는 HTTP 요청에서 가져와야 함
        trx
      );

      // 메트릭 기록
      timer?.(); // 타이머 종료
      this.metrics?.incrementOrderCounter('created', order.salesChannel || 'unknown');
      this.metrics?.incrementBusinessOperation('order', 'create', 'success');

      return order;
    }, tx).catch((error) => {
      // 에러 메트릭 기록
      timer?.(); // 에러 시에도 타이머 종료
      this.metrics?.incrementErrorCounter('order', 'create_failed', 'high');
      this.metrics?.incrementBusinessOperation('order', 'create', 'failure');
      throw error;
    });
  }

  async update(id: string, dto: UpdateSalesOrderDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      await trx
        .update(wmsTables.salesOrders)
        .set({
          customerName: dto.customer?.name ?? null,
          customerEmail: dto.customer?.email ?? null,
          customerPhone: dto.customer?.phone ?? null,
          shippingAddress: dto.shippingAddress,
          totalAmount: dto.totalAmount ?? null,
          shippingFee: dto.shippingFee ?? 0,
          processedAt: dto.processedAt ? new Date(dto.processedAt) : null,
          memo: dto.memo ?? null,
        })
        .where(eq(wmsTables.salesOrders.id, id));
      const updated = await this.getOne(id, trx);
      await this.outbox?.enqueue({ eventType: ORDER_EVENTS.MODIFIED, aggregateType: 'order', aggregateId: id, partitionKey: id, payload: { orderId: id } }, trx);
      return updated;
    }, tx);
  }

  async confirm(id: string, warehouseId?: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      // 1. SO 라인 조회
      const lines = await trx.query.salesOrderLines.findMany({
        where: eq(wmsTables.salesOrderLines.salesOrderId, id),
      });

      // 2. 각 라인에 대해 매핑 스냅샷 생성 (warehouseId가 제공된 경우)
      if (warehouseId && lines.length > 0) {
        for (const line of lines) {
          const snapshotId = await this.productSkuMapping.createSnapshotForVariant(
            line.variantId,
            warehouseId,
            trx,
          );

          if (snapshotId) {
            await trx
              .update(wmsTables.salesOrderLines)
              .set({ mappingSnapshotId: snapshotId })
              .where(eq(wmsTables.salesOrderLines.id, line.id));
          } else {
            // 매핑이 없는 경우 로그만 남기고 진행 (정책에 따라 에러 처리 가능)
            this.logger.warn(
              `No mapping found for variantId=${line.variantId} in warehouseId=${warehouseId}`,
            );
          }
        }
      }

      // 3. SO 상태 업데이트
      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, id));

      const updated = await this.getOne(id, trx);

      // 4. 이벤트 발행
      await this.outbox?.enqueue({
        eventType: ORDER_EVENTS.CONFIRMED,
        aggregateType: 'order',
        aggregateId: id,
        partitionKey: id,
        payload: { orderId: id, warehouseId },
      }, trx);

      return updated;
    }, tx);
  }

  async cancel(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      this.logger.log(`Cancelling sales order: ${id}`);

      try {
        // 1. 먼저 주문 상태 확인
        const salesOrder = await trx.query.salesOrders.findFirst({
          where: eq(wmsTables.salesOrders.id, id)
        });

        if (!salesOrder) {
          throw new Error(`Sales order ${id} not found`);
        }

        if (salesOrder.status === 'cancelled') {
          this.logger.warn(`Sales order ${id} is already cancelled`);
          return salesOrder;
        }

        // 2. 연관된 FO들 조회
        const fulfillmentOrders = await trx.query.fulfillmentOrders.findMany({
          where: eq(wmsTables.fulfillmentOrders.salesOrderId, id)
        });

        this.logger.log(`Found ${fulfillmentOrders.length} fulfillment orders for SO ${id}`);

        // 3. 각 FO의 예약 해제 및 취소
        for (const fo of fulfillmentOrders) {
          if (fo.status === 'canceled') {
            continue; // 이미 취소된 FO는 스킵
          }

          // 라이프사이클 서비스로 FO 예약 일괄 해제 위임
          try {
            await this.reservationLifecycle.handleFulfillmentOrderStatusChange(
              fo.id,
              fo.status,
              'canceled',
              trx,
            );
          } catch (error) {
            this.logger.error(`Failed to release reservations for FO ${fo.id}:`, error);
            // 예약 해제 실패는 로그만 남기고 계속 진행
          }

          // FO 상태를 취소로 업데이트
          await trx
            .update(wmsTables.fulfillmentOrders)
            .set({ status: 'canceled' })
            .where(eq(wmsTables.fulfillmentOrders.id, fo.id));

          this.logger.log(`Cancelled fulfillment order: ${fo.id}`);
        }

        // 4. SO 상태를 취소로 업데이트
        await trx
          .update(wmsTables.salesOrders)
          .set({ status: 'cancelled' })
          .where(eq(wmsTables.salesOrders.id, id));

        const updated = await this.getOne(id, trx);

        // 5. 이벤트 발행
        await this.outbox.enqueue({
          eventType: ORDER_EVENTS.CANCELLED,
          aggregateType: 'order',
          aggregateId: id,
          partitionKey: id,
          payload: { orderId: id, cancelledFulfillmentOrderIds: fulfillmentOrders.map(fo => fo.id) }
        }, trx);

        // 6. 감사 로그 기록
        await this.audit?.logResourceChange(
          'ORDER_CANCELLED',
          'cancel',
          'order',
          'salesOrder',
          id,
          `Sales Order ${salesOrder.channelOrderId || id}`,
          { status: salesOrder.status },
          { status: 'cancelled' },
          undefined, // context
          trx
        );

        this.logger.log(`Successfully cancelled sales order ${id} and ${fulfillmentOrders.length} fulfillment orders`);
        return updated;

      } catch (error) {
        this.logger.error(`Failed to cancel sales order ${id}:`, error);
        throw error;
      }
    }, tx);
  }

  async merge(dto: MergeSalesOrdersDto, tx?: DbTx) {
    return this.inTx(async (trx) => {
      const sourceIds: string[] = dto?.sourceOrderIds ?? [];
      if (!Array.isArray(sourceIds) || sourceIds.length < 2) {
        return { ok: false, reason: 'NEED_AT_LEAST_TWO_ORDERS' };
      }

      const sources = await trx.query.salesOrders.findMany({
        where: inArray(wmsTables.salesOrders.id, sourceIds) as any,
      } as any);
      if (sources.length !== sourceIds.length) {
        return { ok: false, reason: 'ORDER_NOT_FOUND' };
      }

      // 새 SO 생성(헤더 병합: 기본은 첫 주문 기준, override 허용)
      const base = sources[0];
      const [merged] = await trx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: dto.channelOrderId ?? base.channelOrderId,
          salesChannel: (dto.salesChannel ?? base.salesChannel) as 'naver' | 'medusa' | 'coupang' | '3pl',
          status: 'pending' as const,
          customerName: dto.customer?.name ?? base.customerName,
          customerEmail: dto.customer?.email ?? base.customerEmail,
          customerPhone: dto.customer?.phone ?? base.customerPhone,
          shippingAddress: (dto.shippingAddress ?? base.shippingAddress) as any,
          shippingAddressHash: dto.shippingAddressHash ?? base.shippingAddressHash,
          totalAmount: dto.totalAmount ?? base.totalAmount,
          shippingFee: dto.shippingFee ?? base.shippingFee,
          mergeGroupId: null,
          isMerged: true,
          orderDate: new Date(),
          confirmedAt: null,
          processedAt: null,
        })
        .returning();

      // 라인 병합: 단순히 모두 복사(추후 동일 variant 병합 가능)
      const mergedLines: SalesOrderLineInsert[] = [];
      for (const so of sources) {
        const soLines = await trx.query.salesOrderLines.findMany({
          where: (l, { eq }) => eq(l.salesOrderId, so.id),
        });
        for (const l of soLines) {
          mergedLines.push({
            salesOrderId: merged.id,
            variantId: l.variantId,
            productMatchingId: l.productMatchingId,
            productName: l.productName,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            totalPrice: l.totalPrice,
            status: 'pending',
            suggestedQuantity: null,
            unavailableSkuIds: null,
            deductedAt: null,
          });
        }
      }
      if (mergedLines.length > 0) {
        await trx.insert(wmsTables.salesOrderLines).values(mergedLines);
      }

      // 1) 원본 SO의 FO/예약 해제 및 FO 취소
      const sourceFOs = await trx.query.fulfillmentOrders.findMany({ where: (f, { inArray: ina }) => ina(wmsTables.fulfillmentOrders.salesOrderId, sourceIds) as any });
      for (const fo of sourceFOs) {
        const fois = await trx.query.fulfillmentOrderItems.findMany({ where: eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id) });
        const foiIds = fois.map(item => item.id);
        if (foiIds.length > 0) {
          // 예약 원장 release
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released' })
            .where(inArray(wmsTables.stockReservations.fulfillmentOrderItemId, foiIds) as any);
          // FOI reservedQty 초기화
          await trx
            .update(wmsTables.fulfillmentOrderItems)
            .set({ reservedQty: 0, updatedAt: new Date() })
            .where(inArray(wmsTables.fulfillmentOrderItems.id, foiIds) as any);
        }
        // FO 취소
        await trx
          .update(wmsTables.fulfillmentOrders)
          .set({ status: 'canceled' })
          .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
      }

      // 2) 원본 SO 취소 처리
      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(inArray(wmsTables.salesOrders.id, sourceIds) as any);

      // 3) 병합된 SO 기준 FO 재구성(옵션: warehouseId 전달 시 생성)
      if (this.fulfillments) {
        try {
          await this.fulfillments.create({
            salesOrderId: merged.id,
            warehouseId: dto.warehouseId ?? undefined,
            shippingAddress: merged.shippingAddress as any,
            lines: []
          }, trx);
        } catch {
          // 생성 실패는 무시(후속 요청에서 생성 가능)
        }
      }

      await this.outbox?.enqueue({ eventType: 'ORDER_MERGED', aggregateType: 'order', aggregateId: merged.id, partitionKey: merged.id, payload: { targetOrderId: merged.id, sourceOrderIds: sourceIds } }, trx);
      return merged;
    }, tx);
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;

    // 1. 주문 조회
    const [order] = await db
      .select()
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, id))
      .limit(1);

    if (!order) {
      return null;
    }

    // 2. 주문 라인 조회
    const lines = await db
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));

    // 3. 주문에 라인 정보 추가
    return {
      ...order,
      lines,
    };
  }

  /**
   * 채널 + 채널주문ID로 SO 조회
   * 멱등성 체크용
   */
  async findByChannelOrderId(
    salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl',
    channelOrderId: string,
    tx?: DbTx,
  ) {
    const db = tx ?? this.db.db;
    return db.query.salesOrders.findFirst({
      where: (o, { eq, and }) =>
        and(eq(o.salesChannel, salesChannel), eq(o.channelOrderId, channelOrderId)),
    });
  }

  async list(params: SalesOrderFilterDto, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const conditions: SQL[] = [];

    if (params.startDate) {
      conditions.push(gte(wmsTables.salesOrders.orderDate, new Date(params.startDate)));
    }
    if (params.endDate) {
      // 종료일은 해당 일자의 마지막 시간까지 포함해야 함
      // YYYY-MM-DD 입력 시 00:00:00으로 생성되므로, 23:59:59로 설정하여 비교
      const end = new Date(params.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(wmsTables.salesOrders.orderDate, end));
    }
    if (params.channel) {
      conditions.push(eq(wmsTables.salesOrders.salesChannel, params.channel as any));
    }
    if (params.status) {
      conditions.push(eq(wmsTables.salesOrders.status, params.status as any));
    }

    // 1. 주문 목록 조회
    let query = db
      .select()
      .from(wmsTables.salesOrders)
      .$dynamic();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const orders = await query
      .limit(params.limit ?? 20)
      .offset(params.offset ?? 0)
      .orderBy(desc(wmsTables.salesOrders.createdAt));

    if (orders.length === 0) {
      return [];
    }

    // 2. 주문 ID 목록 추출
    const orderIds = orders.map((o) => o.id);

    // 3. 주문 라인 조회
    const lines = await db
      .select()
      .from(wmsTables.salesOrderLines)
      .where(inArray(wmsTables.salesOrderLines.salesOrderId, orderIds));

    // 4. 주문 라인을 주문별로 그룹화
    const linesByOrderId = new Map<string, typeof lines>();
    for (const line of lines) {
      if (!linesByOrderId.has(line.salesOrderId)) {
        linesByOrderId.set(line.salesOrderId, []);
      }
      linesByOrderId.get(line.salesOrderId)!.push(line);
    }

    // 5. 주문에 라인 정보 추가
    return orders.map((order) => ({
      ...order,
      lines: linesByOrderId.get(order.id) || [],
    }));
  }

  /**
   * 이벤트 기반 SO 생성
   * OrderCreatedPayload를 CreateSalesOrderDto 형식으로 변환하여 생성
   */
  async createFromEvent(payload: OrderCreatedPayload, tx?: DbTx) {
    const dto: CreateSalesOrderDto = {
      channelOrderId: payload.externalOrderId ?? payload.orderId,
      salesChannel: payload.salesChannel,
      customer: {
        name: payload.shippingAddress.recipientName,
        phone: payload.shippingAddress.phone,
      },
      shippingAddress: this.convertShippingAddress(payload.shippingAddress),
      totalAmount: payload.totalAmount,
      shippingFee: payload.shippingAmount ?? 0,
      orderDate: payload.createdAt,
      lines: this.convertOrderItems(payload.items),
    };

    return this.create(dto, tx);
  }

  /**
   * 이벤트 기반 SO 수정
   * OrderModifiedPayload.changes를 적용
   */
  async updateFromEvent(
    id: string,
    changes: OrderModifiedPayload['changes'],
    tx?: DbTx,
  ) {
    return this.inTx(async (trx) => {
      const updateData: Partial<UpdateSalesOrderDto> = {};

      if (changes.shippingAddress) {
        updateData.shippingAddress = this.convertShippingAddress(changes.shippingAddress);
      }

      if (changes.totalAmount !== undefined) {
        updateData.totalAmount = changes.totalAmount;
      }

      // 변경 사항이 있을 때만 업데이트
      if (Object.keys(updateData).length > 0) {
        await trx
          .update(wmsTables.salesOrders)
          .set({
            ...(updateData.shippingAddress && { shippingAddress: updateData.shippingAddress }),
            ...(updateData.totalAmount !== undefined && { totalAmount: updateData.totalAmount }),
            updatedAt: new Date(),
          })
          .where(eq(wmsTables.salesOrders.id, id));
      }

      // items 변경은 라인 단위로 처리 (복잡한 로직은 향후 구현)
      if (changes.items && changes.items.length > 0) {
        this.logger.warn(
          `[updateFromEvent] Item changes detected but not yet implemented for order ${id}`,
        );
      }

      const updated = await this.getOne(id, trx);
      await this.outbox?.enqueue({
        eventType: ORDER_EVENTS.MODIFIED,
        aggregateType: 'order',
        aggregateId: id,
        partitionKey: id,
        payload: { orderId: id, changes },
      }, trx);

      return updated;
    }, tx);
  }

  /**
   * 이벤트 ShippingAddress를 DTO AddressDto로 변환
   */
  private convertShippingAddress(address: ShippingAddress): AddressDto {
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      roadAddress: address.roadAddress,
      detailAddress: address.detailAddress,
      deliveryNote: address.deliveryNote,
    };
  }

  /**
   * 이벤트 OrderItem[]을 CreateSalesOrderLineDto[]로 변환
   */
  private convertOrderItems(items: OrderItem[]) {
    return items.map(item => ({
      variantId: item.variantId ?? item.skuId, // variantId가 없으면 skuId 사용
      productName: item.productId ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    }));
  }
}


