import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';
import { eq, inArray } from 'drizzle-orm';
import { PoliciesService } from '../../shared/services/policies.service';
import { FulfillmentsService } from '../../fulfillments/services/fulfillments.service';
import { ORDER_EVENTS } from '../../shared/events';
import { OutboxService } from '../../shared/services/outbox.service';
import { EventPublisherService } from '@app/events';
import { ReservationLifecycleService } from '../../../shared/services/reservation-lifecycle.service';
import { AuditService } from '../../../shared/services/audit.service';
import { MetricsService } from '../../../shared/services/metrics.service';

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly policies: PoliciesService,
    private readonly events: EventPublisherService<any>,
    private readonly outbox: OutboxService,
    private readonly fulfillments: FulfillmentsService,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly audit?: AuditService,
    private readonly metrics?: MetricsService,
  ) {}

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.db.transaction(fn);
  }

  async create(dto: any, tx?: DbTx) {
    const timer = this.metrics?.startOrderTimer('create');
    const startTime = Date.now();

    return this.inTx(async (trx) => {
      const [order] = await trx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: dto.channelOrderId,
          salesChannel: dto.salesChannel,
          status: 'pending',
          customerName: dto.customer?.name ?? null,
          customerEmail: dto.customer?.email ?? null,
          customerPhone: dto.customer?.phone ?? null,
          shippingAddress: dto.shippingAddress,
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
        const values = [] as Array<any>;
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

  async update(id: string, dto: any, tx?: DbTx) {
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
          })
          .where(eq(wmsTables.salesOrders.id, id));
        const updated = await this.getOne(id, trx);
        await this.outbox?.enqueue({ eventType: ORDER_EVENTS.MODIFIED, aggregateType: 'order', aggregateId: id, partitionKey: id, payload: { orderId: id } }, trx);
        return updated;
    }, tx);
  }

  async confirm(id: string, tx?: DbTx) {
    return this.inTx(async (trx) => {
      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, id));
      const updated = await this.getOne(id, trx);
      try { await this.events?.publishEvent?.(ORDER_EVENTS.CONFIRMED as any, { orderId: id } as any); } catch {}
      await this.outbox?.enqueue({ eventType: ORDER_EVENTS.CONFIRMED, aggregateType: 'order', aggregateId: id, partitionKey: id, payload: { orderId: id } }, trx);
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
        try {
          await this.events?.publishEvent?.(ORDER_EVENTS.CANCELLED as any, { orderId: id } as any);
        } catch (eventError) {
          this.logger.error('Failed to publish CANCELLED event:', eventError);
        }

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

  async merge(dto: any, tx?: DbTx) {
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
          salesChannel: dto.salesChannel ?? base.salesChannel,
          status: 'pending',
          customerName: dto.customer?.name ?? base.customerName,
          customerEmail: dto.customer?.email ?? base.customerEmail,
          customerPhone: dto.customer?.phone ?? base.customerPhone,
          shippingAddress: dto.shippingAddress ?? base.shippingAddress,
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
      const lines: Array<any> = [];
      for (const so of sources) {
        const soLines = await trx.query.salesOrderLines.findMany({
          where: (l, { eq }) => eq(l.salesOrderId, so.id),
        });
        for (const l of soLines) {
          lines.push({
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
      if (lines.length > 0) {
        await trx.insert(wmsTables.salesOrderLines).values(lines);
      }

      // 1) 원본 SO의 FO/예약 해제 및 FO 취소
      const sourceFOs = await trx.query.fulfillmentOrders.findMany({ where: (f, { inArray: ina }) => ina(wmsTables.fulfillmentOrders.salesOrderId, sourceIds) as any });
      for (const fo of sourceFOs) {
        const fols = await trx.query.fulfillmentOrderLines.findMany({ where: (l, { eq }) => eq(l.fulfillmentOrderId, fo.id) });
        const folIds = fols.map(fl => fl.id);
        if (folIds.length > 0) {
          // 예약 원장 release
          await trx
            .update(wmsTables.stockReservations)
            .set({ status: 'released' })
            .where(inArray(wmsTables.stockReservations.fulfillmentOrderItemId, folIds) as any);
          // FOL reservedQty 초기화
          await trx
            .update(wmsTables.fulfillmentOrderLines)
            .set({ reservedQty: 0 })
            .where(inArray(wmsTables.fulfillmentOrderLines.id, folIds) as any);
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
          await this.fulfillments.create({ salesOrderId: merged.id, warehouseId: dto.warehouseId ?? null, shippingAddress: merged.shippingAddress }, trx);
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
    return db.query.salesOrders.findFirst({
      where: (o, { eq }) => eq(o.id, id),
    });
  }

  async list(params: { limit: number; offset: number }, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const rows = await db.query.salesOrders.findMany({
      limit: params.limit,
      offset: params.offset,
      orderBy: (o, { desc }) => [desc(o.createdAt as any)] as any,
    } as any);
    return rows;
  }
}


