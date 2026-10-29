import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import {
  eq,
  gt,
  asc,
  inArray,
  notInArray,
  desc,
  and,
  or,
  gte,
  lte,
  count,
  sql,
  ilike,
  isNotNull,
  isNull,
  exists,
  notExists,
  getTableColumns,
  type InferInsertModel,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { lineMatchingBadgeResolvedSql } from '../../product-matching/line-composition/line-resolved.sql';
import { isDigitalFulfillmentLine, isOutsourcedLine } from '../../product-matching/line-composition/line-composition';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { physicalCancellationByItem } from './boxed-cancellation-units';
import { lineSkuQuantitiesSql } from '../line-quantities/line-quantities.sql';
import { LineQuantities, readLineQuantities } from '../line-quantities/line-quantities.reader';
import { cancellableSalesUnits } from '../line-quantities/line-sales-units';
import type { OrderProgressStage } from '../../fulfillment/order-progress/order-progress.thresholds';
import { computeEntrancePasswordExpiry } from './entrance-password-expiry';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { MetricsService } from '../../inventory/shared/services/metrics.service';
import { ProductSkuMappingService } from '../../product-matching/services/product-sku-mapping.service';
import { FulfillmentOrderCreationBacklogService } from '../../fulfillment/backlog/fulfillment-order-creation-backlog.service';
import { LibraryService } from '../../library/services/library.service';
import { randomUUID } from 'crypto';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ORDER_EVENTS } from '../common/events';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from '../dto/update-sales-order.dto';
import { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';
import { kstDayStart, kstDayEndInclusive, kstTodayRange } from '../utils/kst-date.util';
import { extractDisplayOrderNo } from '../utils/display-order-no.util';
import { ChannelCancelRequestReader } from '../channel-cancel-request/channel-cancel-request.reader';
import { toCancelRequestView } from '../channel-cancel-request/channel-cancel-request.types';
import { buildDailyOrderStatusSeries, DailyOrderStatusPoint } from '../utils/daily-order-status';
import { orderFulfillmentPhaseSql, type OrderShipmentPhase } from '../line-quantities/order-fulfillment-phase.sql';
import { readOrderFulfillmentPhases } from '../line-quantities/order-fulfillment-phase.reader';
import { BusinessLinkReferenceDto, CreateBusinessLinkDto } from '../dto/create-business-link.dto';
import { CancelSalesOrderDto } from '../dto/cancel-sales-order.dto';
import { AddressDto } from '../dto/address.dto';
import {
  OrderCreatedPayload,
  OrderCancelledPayload,
  SalesOrderCancelledPayload,
  ShippingAddress,
  OrderItem,
} from '@packages/event-contracts';
import { ModuleRef } from '@nestjs/core';
import { ShipmentPlanningService } from '../../fulfillment/services/shipment-planning.service';
import { UnboxedDemandCancellation } from '../../fulfillment/unboxed-demand/unboxed-demand-cancellation';
import type {
  ReducedDemandItem,
  UnboxedDemandItem,
  UnboxedDemandReduction,
} from '../../fulfillment/unboxed-demand/unboxed-demand.types';
import { canonicalFulfillmentRequestHash } from '../../fulfillment/services/fulfillment-command.service';
import type { CancellationEffect } from '../cancellation-record/cancellation-lines';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { FULFILLMENT_SYSTEM_ACTOR } from '../../../platform/auth/system-actor';

type SalesOrderLineInsert = InferInsertModel<typeof wmsTables.salesOrderLines>;
type BusinessLinkInsert = InferInsertModel<typeof wmsTables.businessLinks>;
type SalesOrderCancellationInsert = InferInsertModel<typeof wmsTables.salesOrderCancellations>;
type BusinessLinkRow = typeof wmsTables.businessLinks.$inferSelect;
type WmsDb = DbService<typeof wmsSchema>['db'];
type BusinessLinkReference = {
  type: string;
  id: string | null;
  externalRef: string | null;
};
type SalesOrderTimelineContext = {
  salesOrderId: string;
  cancellationIds: Set<string>;
  amendmentIds: Set<string>;
  csCaseIds: Set<string>;
};
type TimelineEffectStatus = {
  owner: string;
  value: string;
};
type SalesOrderContractField =
  | 'customer'
  | 'customerId'
  | 'shippingAddress'
  | 'totalAmount'
  | 'shippingFee'
  | 'items'
  | 'lines';
type SalesOrderPatchInput = UpdateSalesOrderDto & Partial<Record<SalesOrderContractField, unknown>>;
type CancelSalesOrderOptions = CancelSalesOrderDto & {
  fulfillmentCommandContext?: {
    idempotencyKey: string;
    actorId: string;
    actorRoles: string[];
  };
};
type PartialCancellationLine = {
  salesOrderLineId: string;
  quantity: number;
};
/**
 * 상자 전 부분취소의 감소 자리표시 — 계획 때는 FOI·수량만 정하고, 명령이 쓴 뒤 `adjusted_fulfillment_order_item` 효과로 바꾼다.
 * 효과 배열 안에 끼워 두는 건 라인·SKU 마다 «감소 → 출고 뒤 몫» 순서를 지금처럼 남기기 위해서다.
 */
type PlannedUnboxedReduction = { reduction: { item: UnboxedDemandItem; salesOrderLineId: string; qty: number } };
type PlannedPartialEffect = CancellationEffect | PlannedUnboxedReduction;
type PostShipmentHandoffType = 'return' | 'recovery' | 'refund' | 'compensation';
type PostShipmentHandoffOptions = NonNullable<CancelSalesOrderOptions['postShipmentHandoff']>;
type PriorCancellationContext = {
  /** 라인 수량 문의 `remaining`(주문 − 갈래 무관 취소) — 호출자는 뺄셈을 다시 하지 않는다 (K6 PR2b). */
  remainingByLine: Map<string, number>;
  /**
   * 요청 검사의 취소 상한 = `remaining − returnHeld`(K8 PR5) — 반품이 잡은 물건을 취소로 또 환불하지 않게.
   * 전체취소 몫·«남는 것 없음» 판정은 반품과 무관하게 `remainingByLine` 으로 센다(N6).
   */
  cancelableByLine: Map<string, number>;
  preservedShippedByFulfillmentItem: Map<string, number>;
};
type AfterBoxingPlan = {
  salesOrderLines: Array<typeof wmsTables.salesOrderLines.$inferSelect>;
  salesLineById: Map<string, typeof wmsTables.salesOrderLines.$inferSelect>;
  fulfillmentItems: Array<{
    id: string;
    qty: number;
    shippedQty: number;
    canceledQty: number;
    salesOrderLineId: string | null;
  }>;
  prior: PriorCancellationContext;
  requestedSalesLines: PartialCancellationLine[];
  cancellationByShipment: Map<
    string,
    { manifestVersion: number; lines: Array<{ shipmentLineId: string; expectedLineVersion: number; qty: number }> }
  >;
};

export interface CancellationPlan {
  /** 이 취소가 실제로 줄일 판매주문 줄과 수량(0 인 줄 없음). 전체취소면 줄마다 «안 나간·안 취소된» 몫 전부 */
  lines: PartialCancellationLine[];
  /** 이미 출고된 몫이 있다 — 운영자 전체취소는 31번 전환 대상 */
  hasShippedQuantity: boolean;
  /** 이 취소 뒤 주문에 남는 수량이 0 이다 — 부분 요청이어도 주문 전체다 */
  leavesNothing: boolean;
}
type V2PlanningSalesOrderLineIdentity = {
  id: string;
  channelOrderItemId: string | null;
  channelProductId?: string | null;
};

const ACCEPTED_CONTRACT_CHANNELS = new Set(['medusa', 'naver', 'coupang']);
const CONTRACT_PATCH_FIELDS: SalesOrderContractField[] = [
  'customer',
  'customerId',
  'shippingAddress',
  'totalAmount',
  'shippingFee',
  'items',
  'lines',
];
// 취소 거절 문구 — `cancel`·`cancelBeforeBoxingPartial` 과 `planCancellation`(요청 때 판정)이 같은 문구를 쓰게 한 곳에 둔다.
const CANCEL_MSG_ALREADY_CANCELLED = '이미 전체 취소된 주문입니다.';
const CANCEL_MSG_FULL_CANCELLATION_EXISTS = '이미 전체 취소 처리된 주문입니다.';
const CANCEL_MSG_NOTHING_TO_CANCEL = '취소할 수 있는 수량이 없습니다. 이미 출고된 상품은 반품 접수로 환불해 주세요.';
const CANCEL_MSG_SHIPPED_FULFILLMENT =
  '출고 완료된 항목이 포함된 주문은 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.';
const CANCEL_MSG_SHIPPED_ITEMS =
  '출고 수량이 있는 항목이 포함되어 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.';
const cancelQuantityExceedsMessage = (requested: number, remaining: number) =>
  `취소 수량(${requested}개)이 취소 가능 수량(${remaining}개)을 초과합니다.`;
const SALES_ORDER_REF_TYPE = 'sales_order';

/** 주문의 어느 라인·SKU 든 출고 수량이 있다 — 상자 전 전체취소의 «출고 수량이 있는 항목» 거절(라인 수량 문의 `skus`). */
function hasShippedSku(lineQuantities: Map<string, LineQuantities>): boolean {
  return [...lineQuantities.values()].some((line) => line.skus.some((sku) => sku.shipped > 0));
}

/** 라인의 남은 수량. 문은 주문의 모든 라인을 내므로 없으면 다른 주문의 라인이다 — `?? 0` 으로 덮지 않는다. */
function remainingOf(prior: PriorCancellationContext, salesOrderLineId: string): number {
  const remaining = prior.remainingByLine.get(salesOrderLineId);
  if (remaining === undefined) {
    throw new Error(`Line quantities are missing SalesOrder line ${salesOrderLineId}`);
  }
  return remaining;
}

/** 라인의 취소 상한(남은 수량 − 반품이 잡은 수량). 없으면 `remainingOf` 와 같이 다른 주문의 라인이다. */
function cancelableOf(prior: PriorCancellationContext, salesOrderLineId: string): number {
  const cancelable = prior.cancelableByLine.get(salesOrderLineId);
  if (cancelable === undefined) {
    throw new Error(`Line quantities are missing SalesOrder line ${salesOrderLineId}`);
  }
  return cancelable;
}

/** 단계 행이 없는 주문(SQL 이 존재하는 주문마다 한 행을 내므로 일어나지 않는다)에 던지는 대신 쓰는 중립값 */
const FALLBACK_SHIPMENT_PHASE: OrderShipmentPhase = 'preparing';
const ORDER_CANCELLATION_REF_TYPE = 'order_cancellation';
const SALES_ORDER_AMENDMENT_REF_TYPE = 'sales_order_amendment';
const CS_CASE_REF_TYPE = 'cs_case';
const WALLET_EFFECT_REF_TYPES = new Set([
  'wallet_refund',
  'wallet_payment_effect',
  'wallet_payment_intent',
  'wallet_charge',
]);
const LOGISTICS_EFFECT_REF_TYPES = new Set(['return', 'return_handoff']);
const OPERATIONS_EFFECT_REF_TYPES = new Set(['recovery_handoff', 'refund_policy_handoff', 'compensation_handoff']);
const OPEN_FULFILLMENT_BACKLOG_STATUSES = new Set(['pending', 'failed', 'processing', 'awaiting_matching']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CANCEL_REASONS = new Set<OrderCancelledPayload['reason']>([
  'CUSTOMER_REQUEST',
  'OUT_OF_STOCK',
  'PAYMENT_FAILED',
  'ADMIN_CANCEL',
  'TIMEOUT',
]);

function toCancelReason(reasonCode: string | null | undefined): OrderCancelledPayload['reason'] {
  return VALID_CANCEL_REASONS.has(reasonCode as OrderCancelledPayload['reason'])
    ? (reasonCode as OrderCancelledPayload['reason'])
    : 'ADMIN_CANCEL';
}

export const PRINT_PAYMENT_UNCONFIRMED_ERROR = 'payment not confirmed — verify payment, then retry';

/**
 * 교환 줄(K8 PR11)은 취소로 줄이지 않는다(N18) — 교환 사실로만 생기고 지워진다. Medusa 는 정산 전까지 그 줄을 모르고,
 * 정산 뒤엔 대체 품목 줄의 반품이 갈 길이다.
 */
function isExchangeLine(line: { exchangeReturnLineId: string | null }): boolean {
  // 칸을 고르지 않은 행이면(undefined) «교환 아님»으로 새지 않고 결함으로 멈춘다 — 타입이 막고, 런타임도 막는다
  if (line.exchangeReturnLineId === undefined) {
    throw new Error('sales order line was read without exchange_return_line_id');
  }
  return line.exchangeReturnLineId !== null;
}

function assertNotExchangeLine(line: { id: string; exchangeReturnLineId: string | null }): void {
  if (isExchangeLine(line)) {
    throw new BadRequestError(`교환 줄은 취소할 수 없습니다 (line ${line.id})`);
  }
}

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly db: DbService<typeof wmsSchema>,
    @InjectPublisher(FULFILLMENT_STREAM)
    private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    @InjectPublisher(CORE_ORDER_STREAM)
    private readonly coreOrders: PublisherFor<typeof CORE_ORDER_STREAM>,
    private readonly unboxedDemand: UnboxedDemandCancellation,
    private readonly productSkuMapping: ProductSkuMappingService,
    private readonly fulfillmentBacklog: FulfillmentOrderCreationBacklogService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly library?: LibraryService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  // paymentConfirmed: 결제 확정을 모르는 주문의 인쇄는 발주하지 않되 빠뜨리지도 않는다.
  // failed 로 만들어 워커는 집지 않고, 보드 발주 실패 탭에서 운영자가 결제를 확인한 뒤 재전송한다
  async create(dto: CreateSalesOrderDto, tx?: DbTx, opts: { paymentConfirmed?: boolean } = {}) {
    this.assertUniqueTrustedChannelOrderItemIds(dto.salesChannel, Array.isArray(dto.lines) ? dto.lines : []);

    const timer = this.metrics?.startOrderTimer('create');

    return this.db
      .run(async (trx) => {
        // orderDate 는 아래 컬럼과 entrancePasswordExpiresAt 계산에 동일한 값을 써야 하므로
        // 한 번만 계산해 공유한다. 만료 산식 자체는 entrance-password-expiry.ts 참고.
        const orderDate = new Date(dto.orderDate ?? Date.now());
        const [order] = await trx
          .insert(wmsTables.salesOrders)
          .values({
            channelOrderId: dto.channelOrderId,
            displayOrderNo: dto.displayOrderNo ?? null,
            salesChannel: dto.salesChannel as 'naver' | 'medusa' | 'coupang' | '3pl',
            status: 'pending' as const,
            customerId: dto.customer?.id ?? null,
            customerName: dto.customer?.name ?? null,
            customerEmail: dto.customer?.email ?? null,
            customerPhone: dto.customer?.phone ?? null,
            shippingAddress: dto.shippingAddress as any,
            shippingAddressHash: dto.shippingAddressHash ?? null,
            totalAmount: dto.totalAmount ?? null,
            shippingFee: dto.shippingFee ?? 0,
            mergeGroupId: dto.mergeGroupId ?? null,
            isMerged: false,
            walletIntentId: dto.walletIntentId ?? null,
            orderDate,
            // 최초 insert 경로라 기존 값을 덮어쓸 걱정이 없다 (existing row 없음).
            // 리플레이가 이 값을 지울 수 있는지는 여기가 아니라 OrderModified 소비 경로가
            // 결정한다 — order-events.consumer.ts#handleOrderModified 참고 (구조적으로 no-op).
            entrancePassword: dto.entrancePassword ?? null,
            entrancePasswordExpiresAt: dto.entrancePassword
              ? computeEntrancePasswordExpiry(orderDate.toISOString())
              : null,
            confirmedAt: null,
            processedAt: null,
          })
          .returning();

        await this.fulfillmentsV1.enqueue(
          {
            // 역사적 폴백 목적지 보존: topicless 시절 dispatcher catch-all 이 이 이벤트를
            // fulfillments.events.v1 로 실어 왔다. 재라우팅은 컨슈머 분석이 필요한 별도 결정.
            idempotencyKey: `order-created:${order.id}`,
            eventType: ORDER_EVENTS.CREATED,
            aggregateId: order.id,
            partitionKey: order.id,
            payload: { orderId: order.id },
          },
          trx,
        );

        const lines = Array.isArray(dto.lines) ? dto.lines : [];
        if (lines.length > 0) {
          const values: SalesOrderLineInsert[] = [];
          for (const l of lines) {
            values.push({
              salesOrderId: order.id,
              channelOrderItemId: l.channelOrderItemId ?? null,
              channelProductId: l.channelProductId ?? null,
              variantId: l.variantId,
              productName: l.productName ?? '',
              quantity: l.quantity,
              unitPrice: l.unitPrice ?? null,
              totalPrice: l.totalPrice ?? null,
              fulfillmentKind: l.fulfillmentKind ?? null,
              requiresShipping: l.requiresShipping ?? null,
              almondDesignId: l.almondDesignId ?? null,
            });
          }
          const insertedLines = await trx
            .insert(wmsTables.salesOrderLines)
            .values(values)
            .returning({ id: wmsTables.salesOrderLines.id, almondDesignId: wmsTables.salesOrderLines.almondDesignId });

          const printRows = insertedLines.flatMap(({ id, almondDesignId }) =>
            almondDesignId
              ? [
                  opts.paymentConfirmed
                    ? { salesOrderId: order.id, salesOrderLineId: id, almondDesignId, status: 'pending' as const }
                    : {
                        salesOrderId: order.id,
                        salesOrderLineId: id,
                        almondDesignId,
                        status: 'failed' as const,
                        lastError: PRINT_PAYMENT_UNCONFIRMED_ERROR,
                      },
                ]
              : [],
          );
          if (printRows.length > 0) {
            await trx
              .insert(wmsTables.printOrders)
              .values(printRows)
              .onConflictDoNothing({ target: wmsTables.printOrders.salesOrderLineId });
          }
        }

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
          undefined,
          trx,
        );

        timer?.();
        this.metrics?.incrementOrderCounter('created', order.salesChannel || 'unknown');
        this.metrics?.incrementBusinessOperation('order', 'create', 'success');

        return order;
      }, tx)
      .catch((error) => {
        timer?.();
        this.metrics?.incrementErrorCounter('order', 'create_failed', 'high');
        this.metrics?.incrementBusinessOperation('order', 'create', 'failure');
        throw error;
      });
  }

  async update(id: string, dto: UpdateSalesOrderDto, tx?: DbTx) {
    return this.db.run(async (trx) => {
      const [salesOrder] = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1);
      if (!salesOrder) {
        throw new NotFoundException(`Sales order ${id} not found`);
      }

      this.assertAcceptedContractIsNotPatched(salesOrder, dto);

      const updateData: Record<string, unknown> = {};

      if (dto.customer) {
        if ('name' in dto.customer) updateData.customerName = dto.customer.name ?? null;
        if ('email' in dto.customer) updateData.customerEmail = dto.customer.email ?? null;
        if ('phone' in dto.customer) updateData.customerPhone = dto.customer.phone ?? null;
      }
      if (dto.shippingAddress !== undefined) updateData.shippingAddress = dto.shippingAddress;
      if (dto.totalAmount !== undefined) updateData.totalAmount = dto.totalAmount;
      if (dto.shippingFee !== undefined) updateData.shippingFee = dto.shippingFee;
      if (dto.processedAt !== undefined) updateData.processedAt = dto.processedAt ? new Date(dto.processedAt) : null;
      if (dto.memo !== undefined) updateData.memo = dto.memo;

      if (Object.keys(updateData).length > 0) {
        await trx
          .update(wmsTables.salesOrders)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(wmsTables.salesOrders.id, id));

        await this.fulfillmentsV1.enqueue(
          {
            // 역사적 폴백 목적지 보존 (위 ORDER_CREATED 참조). 수정 이벤트는 주문당 여러 번이
            // 정당하므로 자연 멱등키가 없다 — 호출마다 고유 키로 topicless 시절의 무중복 동작 유지.
            idempotencyKey: `order-modified:${id}:${randomUUID()}`,
            eventType: ORDER_EVENTS.MODIFIED,
            aggregateId: id,
            partitionKey: id,
            payload: { orderId: id },
          },
          trx,
        );
      }

      const updated = await this.getOne(id, trx);
      return updated;
    }, tx);
  }

  async confirm(id: string, tx?: DbTx) {
    return this.db.run(async (trx) => {
      // Row lock before state check to prevent concurrent double-confirm races
      await trx.execute(sql`
        SELECT id FROM ${wmsTables.salesOrders}
        WHERE ${wmsTables.salesOrders.id} = ${id}
        FOR UPDATE
      `);

      const [salesOrder] = await trx
        .select({ id: wmsTables.salesOrders.id, status: wmsTables.salesOrders.status })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1);

      if (!salesOrder) throw new NotFoundException(`Sales order ${id} not found`);

      if (salesOrder.status === 'confirmed') {
        // Idempotent: already in target state — return current record without mutation
        return this.getOne(id, trx);
      }

      // shipped/delivered/processing 는 producer 0(작업 15, ADR-0017)이라 도달 불가하나,
      // 미래 값 부활 시 confirm 재진입을 막도록 방어적으로 존치한다.
      const NON_CONFIRMABLE = new Set(['cancelled', 'shipped', 'delivered', 'timeout', 'processing']);
      if (NON_CONFIRMABLE.has(salesOrder.status)) {
        throw new ConflictException(`Cannot confirm sales order ${id}: current status is '${salesOrder.status}'`);
      }

      // salesOrder.status === 'pending' — proceed with confirm
      await trx
        .update(wmsTables.salesOrders)
        .set({ status: 'confirmed', confirmedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, id));

      return this.getOne(id, trx);
    }, tx);
  }

  async cancel(id: string, optionsOrTx?: CancelSalesOrderOptions | DbTx, tx?: DbTx) {
    const { options, tx: explicitTx } = this.normalizeCancelArgs(optionsOrTx, tx);

    return this.db.run(async (trx) => {
      this.logger.log(`Cancelling sales order: ${id}`);

      await trx.execute(sql`
        SELECT id
        FROM ${wmsTables.salesOrders}
        WHERE ${wmsTables.salesOrders.id} = ${id}
        FOR UPDATE
      `);

      const salesOrder = await trx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1)
        .then((r) => r[0]);

      if (!salesOrder) throw new NotFoundException(`Sales order ${id} not found`);

      if (Array.isArray(options.lines) && options.lines.length === 0) {
        throw new BadRequestException('Partial cancellation lines cannot be empty; omit lines for full cancellation');
      }

      const isFullCancel = !this.hasPartialCancellationLines(options);
      const replay = await this.findAfterBoxingReplay(id, options, trx);
      if (replay) {
        if (replay.requestHash !== this.afterBoxingRequestHash(id, options)) {
          throw new ConflictException({
            code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH',
            message: 'Idempotency key was already used with a different cancellation request',
          });
        }
        return this.getOne(id, trx);
      }
      if (await this.hasBoxedFulfillment(id, trx)) {
        return this.cancelAfterBoxing(id, salesOrder, options, isFullCancel, trx);
      }
      if (isFullCancel && (salesOrder.status === 'shipped' || salesOrder.status === 'delivered')) {
        throw new BadRequestException(
          '이미 출고/배송 완료된 주문은 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.',
        );
      }

      if (!isFullCancel) {
        return this.cancelBeforeBoxingPartial(id, salesOrder, options, trx);
      }

      return this.cancelBeforeBoxingFull(id, salesOrder, options, trx);
    }, explicitTx);
  }

  async validateCancellationReplay(
    salesOrderId: string,
    request: {
      sourceKey: string;
      reasonCode?: string;
      reasonDetail?: string;
      lines?: Array<{ salesOrderLineId: string; quantity: number }>;
    },
    tx?: DbTx,
  ): Promise<boolean> {
    const normalizedSourceKey = request.sourceKey.trim();
    if (!normalizedSourceKey) return false;
    return this.db.run(async (trx) => {
      const rows = await trx
        .select({ metadata: wmsTables.salesOrderCancellations.metadata })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
      const replay = rows.find((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        return metadata.fulfillmentCommandSourceKey === normalizedSourceKey;
      });
      if (!replay) return false;
      const metadata = (replay.metadata ?? {}) as Record<string, unknown>;
      const requestHash = this.afterBoxingRequestHash(salesOrderId, {
        reasonCode: request.reasonCode,
        reasonDetail: request.reasonDetail,
        lines: request.lines,
      });
      if (metadata.fulfillmentCommandRequestHash !== requestHash) {
        throw new ConflictException({
          code: 'FULFILLMENT_IDEMPOTENCY_MISMATCH',
          message: 'Idempotency key was already used with a different cancellation request',
        });
      }
      return true;
    }, tx);
  }

  /**
   * 주문 id 들의 관리자 출고 단계를 한 번에 읽는다. 단계는 일별 통계·고객 화면과 같은 사다리 한 벌
   * (`orderFulfillmentPhaseSql`)의 `admin_phase` 다.
   * 반환 맵에 없는 id 는 주문이 없다는 뜻이다(SQL 은 존재하는 주문마다 정확히 한 행을 낸다).
   */
  private async loadShipmentPhases(orderIds: string[], db: DbTx | WmsDb): Promise<Map<string, OrderShipmentPhase>> {
    const phases = await readOrderFulfillmentPhases(db, orderIds);
    return new Map(Array.from(phases, ([id, phase]) => [id, phase.adminPhase]));
  }

  async getOne(id: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    const [order] = await db.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, id)).limit(1);
    if (!order) return null;
    // 라인 배지(«매칭 대기»)는 이 값을 본다(#1063)
    const lines = await db
      .select({ ...getTableColumns(wmsTables.salesOrderLines), matchingResolved: lineMatchingBadgeResolvedSql() })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));
    const shipmentPhase = (await this.loadShipmentPhases([id], db)).get(id) ?? FALLBACK_SHIPMENT_PHASE;
    const { links: businessLinks, context } = await this.loadBusinessTimelineLinks(id, db);
    // 리더는 상태가 없다 — 생성자에 넣으면 이 서비스를 위치 인자로 만드는 통합 스펙이 깨진다
    const cancelRequestRow = await new ChannelCancelRequestReader().latestFor(id, db);
    return {
      ...order,
      shipmentPhase,
      lines,
      businessTimeline: this.toBusinessTimeline(context, businessLinks),
      // 채널 주문 취소 요청(#1016 35번) — admin-web 이 «취소 요청됨»·«취소 실패»를 그린다
      cancelRequest: cancelRequestRow ? toCancelRequestView(cancelRequestRow) : null,
    };
  }

  async createBusinessLink(id: string, dto: CreateBusinessLinkDto, tx?: DbTx) {
    return this.db.run(async (trx) => {
      const [order] = await trx
        .select({ id: wmsTables.salesOrders.id })
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, id))
        .limit(1);
      if (!order) {
        throw new NotFoundException(`Sales order ${id} not found`);
      }
      if (!dto.target) {
        throw new BadRequestException('Business link target is required');
      }

      const source = this.normalizeBusinessLinkRef(dto.source ?? { type: 'sales_order', id });
      const target = this.normalizeBusinessLinkRef(dto.target);

      if (!this.hasBusinessLinkRef(source)) {
        throw new BadRequestException('Business link source must include id or externalRef');
      }
      if (!this.hasBusinessLinkRef(target)) {
        throw new BadRequestException('Business link target must include id or externalRef');
      }
      const sourceBelongsToTimeline = await this.referencesSalesOrderTimeline(source, id, trx);
      const targetBelongsToTimeline = await this.referencesSalesOrderTimeline(target, id, trx);
      if (!sourceBelongsToTimeline && !targetBelongsToTimeline) {
        throw new BadRequestException(
          'Business link must reference the requested SalesOrder or a lifecycle entity linked to it',
        );
      }

      const values: BusinessLinkInsert = {
        sourceType: source.type,
        sourceId: source.id,
        sourceExternalRef: source.externalRef,
        targetType: target.type,
        targetId: target.id,
        targetExternalRef: target.externalRef,
        relationName: dto.relationName,
        metadata: dto.metadata ?? {},
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      };

      const [businessLink] = await trx.insert(wmsTables.businessLinks).values(values).returning();
      const context = await this.loadBusinessTimelineContext(id, trx);
      if (sourceBelongsToTimeline) {
        this.collectTimelineCsCaseId(context, source.type, source.id);
      }
      if (targetBelongsToTimeline) {
        this.collectTimelineCsCaseId(context, target.type, target.id);
      }
      return this.toBusinessTimelineItem(context, businessLink);
    }, tx);
  }

  async findByChannelOrderId(salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl', channelOrderId: string, tx?: DbTx) {
    const db = tx ?? this.db.db;
    return db.query.salesOrders.findFirst({
      where: (o, { eq, and }) => and(eq(o.salesChannel, salesChannel), eq(o.channelOrderId, channelOrderId)),
    });
  }

  /**
   * 채널이 소유한 라인 식별자 → 우리 `sales_order_lines.id`.
   *
   * `(salesOrderId, channelOrderItemId)` 부분 unique 인덱스가 있으므로
   * (`inventory.schema.ts:1343`) 주문 안에서 단건 확정이다.
   */
  async findLineIdsByChannelOrderItemIds(
    salesOrderId: string,
    channelOrderItemIds: string[],
    tx?: DbTx,
  ): Promise<Map<string, string>> {
    if (channelOrderItemIds.length === 0) return new Map();

    return this.db.run(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.salesOrderLines.id,
          channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        })
        .from(wmsTables.salesOrderLines)
        .where(
          and(
            eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
            inArray(wmsTables.salesOrderLines.channelOrderItemId, channelOrderItemIds),
          ),
        );

      return new Map(
        rows
          .filter((row): row is { id: string; channelOrderItemId: string } => row.channelOrderItemId !== null)
          .map((row) => [row.channelOrderItemId, row.id]),
      );
    }, tx);
  }

  async list(params: SalesOrderFilterDto, tx?: DbTx) {
    return this.db.run(async (trx) => {
      const S = wmsTables;

      // ── 상관 서브쿼리 헬퍼: 현재 주문에 조건을 만족하는 라인이 있다 ──
      const lineExists = (cond: SQL) =>
        exists(
          trx
            .select({ x: sql`1` })
            .from(S.salesOrderLines)
            .where(and(eq(S.salesOrderLines.salesOrderId, S.salesOrders.id), cond)),
        );

      const conditions: SQL[] = [];

      if (params.startDate) {
        // KST 달력일 00:00 부터 (order_date 는 UTC 저장)
        conditions.push(gte(S.salesOrders.orderDate, kstDayStart(params.startDate)));
      }
      if (params.endDate) {
        // KST 달력일 23:59:59.999 까지 (inclusive)
        conditions.push(lte(S.salesOrders.orderDate, kstDayEndInclusive(params.endDate)));
      }
      if (params.channel) {
        conditions.push(eq(S.salesOrders.salesChannel, params.channel));
      }
      if (params.status) {
        conditions.push(eq(S.salesOrders.status, params.status));
      }

      // ── 구분(typeGroup): 재고/매칭 상태 파생 (주문 단위) ──
      switch (params.typeGroup) {
        case 'pending':
          conditions.push(eq(S.salesOrders.status, 'pending'));
          break;
        case 'unmatched': // 매칭안됨: 매칭이 없어 FO 생성을 기다리는 주문. 대기열이 라인 구성 판정의 결과다(#1063 스펙 D8)
          conditions.push(
            exists(
              trx
                .select({ x: sql`1` })
                .from(S.fulfillmentOrderCreationBacklogs)
                .where(
                  and(
                    eq(S.fulfillmentOrderCreationBacklogs.salesOrderId, S.salesOrders.id),
                    eq(S.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
                  ),
                ),
            ),
          );
          break;
        case 'direct': // 직배송: 입점사 상자 존재(K3 PR4) — FO 모드가 아니다
          conditions.push(
            exists(
              trx
                .select({ x: sql`1` })
                .from(S.shipments)
                .innerJoin(S.shipmentLines, eq(S.shipmentLines.shipmentId, S.shipments.id))
                .innerJoin(
                  S.fulfillmentOrderItems,
                  eq(S.fulfillmentOrderItems.id, S.shipmentLines.fulfillmentOrderItemId),
                )
                .innerJoin(S.fulfillmentOrders, eq(S.fulfillmentOrders.id, S.fulfillmentOrderItems.fulfillmentOrderId))
                .where(
                  and(
                    eq(S.fulfillmentOrders.salesOrderId, S.salesOrders.id),
                    isNotNull(S.shipments.supplierId),
                    notInArray(S.shipments.status, ['canceled', 'superseded']),
                  ),
                ),
            ),
          );
          break;
        case 'all':
        default:
          if (params.excludeTerminal) {
            conditions.push(notInArray(S.salesOrders.status, ['cancelled', 'timeout']));
          }
          break;
      }

      // ── 환불 결정 전·실패만 ──
      // 어드민 주문내역 화면(use-order-rows)의 refundStatus 도출과 동일 규칙:
      //   effectiveLink = (미완료 manual_pending 링크) ?? (최신 링크)
      //   이 링크가 failed/manual_pending/requested 면 이슈. → 아래 세 조건의 OR 로 정확히 재현.
      //   ① 미완료 manual_pending 링크 존재 (succeeded·waived 가 completedRefundLinkId 로 닫지 않은 것.
      //      뒤에 무관한 succeeded 가 생겨도 여전히 미처리로 노출)
      //   ② 최신 링크가 failed
      //   ③ 최신 링크가 requested (환불을 요청만 하고 결과 기록이 안 온 채 멈춘 건)
      // 주문 상태는 묻지 않는다 — core 가 돈을 쥔 주문은 취소 전에도 환불 결정 대기(manual_pending)가 생긴다.
      // 링크 앵커: sourceType='sales_order', sourceId=SO (store-sales-orders 와 동일).
      if (params.refundIssueOnly) {
        const REFUND_RELATION = 'cancellation_linked_wallet_refund';
        const mp = alias(S.businessLinks, 'refund_mp'); // manual_pending 후보
        const completion = alias(S.businessLinks, 'refund_completion'); // mp 를 종결한 succeeded·waived
        const failedLink = alias(S.businessLinks, 'refund_failed'); // failed 후보
        const laterLink = alias(S.businessLinks, 'refund_later'); // failedLink 이후 링크
        const requestedLink = alias(S.businessLinks, 'refund_requested'); // requested 후보
        const laterOfRequested = alias(S.businessLinks, 'refund_later_req'); // requestedLink 이후 링크

        // ① 아직 종결되지 않은 manual_pending 링크
        const uncompletedManualPending = exists(
          trx
            .select({ x: sql`1` })
            .from(mp)
            .where(
              and(
                eq(mp.sourceType, SALES_ORDER_REF_TYPE),
                eq(mp.sourceId, S.salesOrders.id),
                eq(mp.relationName, REFUND_RELATION),
                sql`${mp.metadata}->>'refundStatus' = 'manual_pending'`,
                notExists(
                  trx
                    .select({ x: sql`1` })
                    .from(completion)
                    .where(
                      and(
                        eq(completion.relationName, REFUND_RELATION),
                        sql`${completion.metadata}->>'refundStatus' IN ('succeeded', 'waived')`,
                        sql`${completion.metadata}->>'completedRefundLinkId' = ${mp.id}::text`,
                      ),
                    ),
                ),
              ),
            ),
        );

        // ② 최신 링크가 failed
        const latestIsFailed = exists(
          trx
            .select({ x: sql`1` })
            .from(failedLink)
            .where(
              and(
                eq(failedLink.sourceType, SALES_ORDER_REF_TYPE),
                eq(failedLink.sourceId, S.salesOrders.id),
                eq(failedLink.relationName, REFUND_RELATION),
                sql`${failedLink.metadata}->>'refundStatus' = 'failed'`,
                notExists(
                  trx
                    .select({ x: sql`1` })
                    .from(laterLink)
                    .where(
                      and(
                        eq(laterLink.sourceType, SALES_ORDER_REF_TYPE),
                        eq(laterLink.sourceId, S.salesOrders.id),
                        eq(laterLink.relationName, REFUND_RELATION),
                        gt(laterLink.createdAt, failedLink.createdAt),
                      ),
                    ),
                ),
              ),
            ),
        );

        // ③ 최신 링크가 requested
        const latestIsRequested = exists(
          trx
            .select({ x: sql`1` })
            .from(requestedLink)
            .where(
              and(
                eq(requestedLink.sourceType, SALES_ORDER_REF_TYPE),
                eq(requestedLink.sourceId, S.salesOrders.id),
                eq(requestedLink.relationName, REFUND_RELATION),
                sql`${requestedLink.metadata}->>'refundStatus' = 'requested'`,
                notExists(
                  trx
                    .select({ x: sql`1` })
                    .from(laterOfRequested)
                    .where(
                      and(
                        eq(laterOfRequested.sourceType, SALES_ORDER_REF_TYPE),
                        eq(laterOfRequested.sourceId, S.salesOrders.id),
                        eq(laterOfRequested.relationName, REFUND_RELATION),
                        gt(laterOfRequested.createdAt, requestedLink.createdAt),
                      ),
                    ),
                ),
              ),
            ),
        );

        conditions.push(or(uncompletedManualPending, latestIsFailed, latestIsRequested)!);
      }

      // ── 키워드 검색 ──
      if (params.keyword && params.keyword.trim()) {
        const raw = params.keyword.trim();
        const kw = `%${raw}%`;
        // 고객이 보는 주문번호는 «식별자»다. `%3900%` 로 부분일치시키면 13900·39001 이 딸려오므로
        // 등호로 맞춘다. 운영자가 화면·알림에서 옮겨 적는 표기(`20260910-3900`, `#3900`, `3900`)를
        // 모두 같은 번호로 읽도록 여기서 한 번만 정규화한다.
        const displayNo = extractDisplayOrderNo(raw);
        const orderNoCond = or(
          ilike(S.salesOrders.channelOrderId, kw),
          sql`${S.salesOrders.id}::text ILIKE ${kw}`,
          ...(displayNo ? [eq(S.salesOrders.displayOrderNo, displayNo)] : []),
        )!;
        const receiverCond = or(
          sql`${S.salesOrders.shippingAddress}->>'recipientName' ILIKE ${kw}`,
          ilike(S.salesOrders.customerName, kw),
        )!;
        const phoneCond = or(
          ilike(S.salesOrders.customerPhone, kw),
          sql`${S.salesOrders.shippingAddress}->>'phone' ILIKE ${kw}`,
        )!;
        const productCond = lineExists(ilike(S.salesOrderLines.productName, kw));
        switch (params.keywordType) {
          case 'orderNo':
            conditions.push(orderNoCond);
            break;
          case 'receiver':
            conditions.push(receiverCond);
            break;
          case 'phone':
            conditions.push(phoneCond);
            break;
          case 'product':
            conditions.push(productCond);
            break;
          case 'all':
          default:
            conditions.push(or(orderNoCond, receiverCond, phoneCond, productCond)!);
            break;
        }
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = params.limit ?? 20;
      const offset = params.offset ?? 0;

      // 주문 수 + 라인 수(집계) 병렬
      const [[{ total }], [{ lineTotal }]] = await Promise.all([
        trx.select({ total: count() }).from(S.salesOrders).where(where),
        trx
          .select({ lineTotal: count() })
          .from(S.salesOrderLines)
          .innerJoin(S.salesOrders, eq(S.salesOrders.id, S.salesOrderLines.salesOrderId))
          .where(where),
      ]);

      const orders = await trx
        .select()
        .from(S.salesOrders)
        .where(where)
        .limit(limit)
        .offset(offset)
        // createdAt 동률(대량수입) 시 offset 페이지 경계에서 행이 밀리는 것 방지 — id 2차정렬
        .orderBy(desc(S.salesOrders.createdAt), desc(S.salesOrders.id));

      if (orders.length === 0) {
        return {
          data: [],
          total,
          lineTotal,
          page: Math.floor(offset / limit) + 1,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }

      const orderIds = orders.map((o) => o.id);
      const lines = await trx
        .select({ ...getTableColumns(S.salesOrderLines), matchingResolved: lineMatchingBadgeResolvedSql() })
        .from(S.salesOrderLines)
        .where(inArray(S.salesOrderLines.salesOrderId, orderIds));
      // 페이지 주문 전부를 한 번에 — 주문마다 부르면 N+1 이다
      const phaseByOrderId = await this.loadShipmentPhases(orderIds, trx);

      const linesByOrderId = new Map<string, typeof lines>();
      for (const line of lines) {
        if (!linesByOrderId.has(line.salesOrderId)) {
          linesByOrderId.set(line.salesOrderId, []);
        }
        linesByOrderId.get(line.salesOrderId)!.push(line);
      }

      const data = orders.map((order) => ({
        ...order,
        shipmentPhase: phaseByOrderId.get(order.id) ?? FALLBACK_SHIPMENT_PHASE,
        lines: linesByOrderId.get(order.id) || [],
      }));

      return {
        data,
        total,
        lineTotal,
        page: Math.floor(offset / limit) + 1,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }, tx);
  }

  async getDailyStatusStats(
    from: string,
    to: string,
  ): Promise<{ range: { from: string; to: string }; series: DailyOrderStatusPoint[] }> {
    if (from > to) throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);

    const start = sql`(${from}::date)::timestamp AT TIME ZONE 'Asia/Seoul'`;
    const end = sql`(${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'`;
    const db = this.db.db;

    const [orderRows, returnRows] = await Promise.all([
      // 단계는 주문 목록·상세 뱃지와 같은 사다리 한 벌(orderFulfillmentPhaseSql)의 admin_phase — 숫자와 뱃지가 어긋나지 않게.
      db.execute(sql`
        WITH ranged AS (
          SELECT id, ((order_date AT TIME ZONE 'Asia/Seoul')::date)::text AS day
            FROM sales_orders
           WHERE order_date >= ${start} AND order_date < ${end}
        ),
        ph AS (${orderFulfillmentPhaseSql(sql`SELECT ranged.id FROM ranged`)})
        SELECT ranged.day,
               count(*) FILTER (WHERE ph.admin_phase = 'pending')::int AS pending,
               count(*) FILTER (WHERE ph.admin_phase = 'preparing')::int AS preparing,
               count(*) FILTER (WHERE ph.admin_phase = 'shipping')::int AS shipping,
               count(*) FILTER (WHERE ph.admin_phase = 'delivered')::int AS delivered,
               count(*) FILTER (WHERE ph.admin_phase = 'external_shipped')::int AS "externalShipped",
               count(*) FILTER (WHERE ph.admin_phase = 'cancelled')::int AS cancelled,
               count(*)::int AS total
          FROM ranged
          JOIN ph ON ph.sales_order_id = ranged.id
         GROUP BY ranged.day
      `),
      // 반품 = 그날 접수된 반품 예정 기록(K8 PR 10, 취소 포함 — «접수된 수»). 교환(K8 PR11)도 같은 표의 행이라 함께 센다
      db.execute(sql`
        SELECT ((cr.requested_at AT TIME ZONE 'Asia/Seoul')::date)::text AS day, count(*)::int AS count
          FROM customer_returns cr
         WHERE cr.requested_at >= ${start} AND cr.requested_at < ${end}
         GROUP BY 1
      `),
    ]);

    type DayCount = { day: string; count: number };
    type OrderDayRow = Parameters<typeof buildDailyOrderStatusSeries>[0][number];
    return {
      range: { from, to },
      series: buildDailyOrderStatusSeries(
        Array.from(orderRows as unknown as ArrayLike<OrderDayRow>),
        Array.from(returnRows as unknown as ArrayLike<DayCount>),
        from,
        to,
      ),
    };
  }

  async getStats() {
    const db = this.db.db;

    // KST 달력일 기준 오늘/최근 14일 경계 (서버 TZ 무관)
    const { start: today, end: todayEnd, backStart: fourteenDaysAgo } = kstTodayRange(13);

    // 칩 하나에 숫자 하나씩이라 행을 실어 오지 않고 DB 에서 세서 받는다. 서로 의존하지 않는
    // 질문들이라 순차로 기다릴 이유도 없다 — 관리자 메인과 통계 종합 탭이 같이 부르는 경로다.
    const [todayResult, statusCounts, [waitingMatchRow], [shipBlockRow], [directShipRow], outboundRows] =
      await Promise.all([
        db
          .select({ cnt: count() })
          .from(wmsTables.salesOrders)
          .where(and(gte(wmsTables.salesOrders.orderDate, today), lte(wmsTables.salesOrders.orderDate, todayEnd)))
          .then((rows) => rows[0]),

        db
          .select({ status: wmsTables.salesOrders.status, cnt: count() })
          .from(wmsTables.salesOrders)
          .where(gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo))
          .groupBy(wmsTables.salesOrders.status),

        db
          .select({
            cnt: sql<number>`count(distinct ${wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId})::int`,
          })
          .from(wmsTables.fulfillmentOrderCreationBacklogs)
          .innerJoin(
            wmsTables.salesOrders,
            eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId),
          )
          .where(
            and(
              gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
              eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
            ),
          ),

        this.shipBlockCounts(),

        // 직배 = 입점사 상자(취소·대체 제외)가 있는 판매주문 수(K3 PR4). 상자 둘이어도 주문 하나로 센다
        db
          .select({ cnt: sql<number>`count(distinct ${wmsTables.salesOrders.id})::int` })
          .from(wmsTables.shipments)
          .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
          .innerJoin(
            wmsTables.fulfillmentOrderItems,
            eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
          )
          .innerJoin(
            wmsTables.fulfillmentOrders,
            eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
          )
          .innerJoin(
            wmsTables.salesOrders,
            and(
              eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId),
              gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
            ),
          )
          .where(
            and(
              isNotNull(wmsTables.shipments.supplierId),
              notInArray(wmsTables.shipments.status, ['canceled', 'superseded']),
            ),
          ),

        // 출고완료·부분출고: 진행 중 SO(pending·confirmed·processing, 14일)를 라인 수량으로 접어 센다(R14).
        // 라이브 진행 중 주문은 pending 이다 — 생성이 pending 으로 넣고 confirm 은 관리자 엔드포인트뿐이라 confirmed 만
        // 세면 카드가 0 에 머문다. 셀메이트로 나간 주문(shipped)·취소는 모집단 밖이다.
        // core 출고는 SO.status 로 전이하지 않으므로(ADR-0017) 나간 수량에서 도출한다 — 상자 상태가 아니다.
        // 직배 넘김(forwarded)은 outstanding 이 남고 shipped 가 0 이라 어느 쪽에도 들지 않는다.
        // 날짜는 ISO 문자열 + 캐스트로 넘긴다(raw sql 에 Date 를 그대로 주면 postgres.js 가 TypeError).
        db.execute<{ outboundComplete: number; partialOutbound: number }>(sql`
          select (count(*) filter (where order_fact.required > 0 and order_fact.outstanding = 0))::int as "outboundComplete",
                 (count(*) filter (where order_fact.shipped > 0 and order_fact.outstanding > 0))::int as "partialOutbound"
            from (
              select line_sku.sales_order_id,
                     sum(line_sku.required)::int as required,
                     sum(line_sku.shipped)::int as shipped,
                     sum(line_sku.outstanding)::int as outstanding
                from (${lineSkuQuantitiesSql(sql`
                  select scope_so.id
                    from ${wmsTables.salesOrders} as scope_so
                   where scope_so.order_date >= ${fourteenDaysAgo.toISOString()}::timestamptz
                     and scope_so.status in ('pending', 'confirmed', 'processing')
                `)}) as line_sku
               group by line_sku.sales_order_id
            ) as order_fact
        `),
      ]);

    const [outboundRow] = Array.from(outboundRows);
    const byStatus = (s: string) => Number(statusCounts.find((r) => r.status === s)?.cnt ?? 0);

    return {
      todayCount: Number(todayResult.cnt),
      outboundRequested: byStatus('confirmed'),
      directShip: Number(directShipRow?.cnt ?? 0),
      cannotShip: Number(shipBlockRow?.cannotShip ?? 0),
      partialOutbound: Number(outboundRow?.partialOutbound ?? 0),
      waitingMatching: Number(waitingMatchRow?.cnt ?? 0),
      outboundComplete: Number(outboundRow?.outboundComplete ?? 0),
    };
  }

  /**
   * 출고 불가 = 정체 보드 «예약» 단계에 있는 진행 중 주문 수(스펙 D9) — 보드 칸의 `open` 과 같은 값이다.
   * 14일·`confirmed` 창이 없는 건 보드와 같은 값을 내기 위해서다.
   * (부분출고·출고완료는 보드가 아니라 라인 수량이 정한다 — `getStats` 의 한 쿼리.)
   */
  private async shipBlockCounts() {
    const t = wmsTables.orderProgress;
    const reserveStage: OrderProgressStage = 'reserve';
    return this.db.db
      .select({ cannotShip: sql<number>`count(*)::int` })
      .from(t)
      .where(and(isNull(t.outcome), eq(t.stage, reserveStage)));
  }

  async createFromEvent(payload: OrderCreatedPayload, tx?: DbTx) {
    const dto: CreateSalesOrderDto = {
      channelOrderId: payload.externalOrderId ?? payload.orderId,
      // 채널이 준 고객 주문번호. 안 주는 채널은 undefined → NULL (읽는 쪽이 channelOrderId 로 폴백).
      ...(payload.displayOrderNo ? { displayOrderNo: payload.displayOrderNo } : {}),
      salesChannel: payload.salesChannel,
      customer: {
        // 미링크/비-로그인 주문은 customerId=null → DTO(id?: string)는 undefined로. 하위에서 ?? null 로 nullable 컬럼에 저장.
        id: payload.customerId ?? undefined,
        // customer_name 은 «배송지에 적힌 이름»이다. 회원 이름과 다른 경우가 흔하므로
        // 주문자 신원은 이 값이 아니라 customerId 로 user-service 에서 해석해야 한다.
        name: payload.shippingAddress.recipientName,
        ...(payload.email ? { email: payload.email } : {}),
        phone: payload.shippingAddress.phone,
      },
      shippingAddress: this.convertShippingAddress(payload.shippingAddress),
      ...(payload.entrancePassword ? { entrancePassword: payload.entrancePassword } : {}),
      totalAmount: payload.totalAmount,
      shippingFee: payload.shippingAmount ?? 0,
      orderDate: payload.createdAt,
      lines: this.convertOrderItems(payload.items),
      walletIntentId: payload.walletIntentId,
    };
    return this.create(dto, tx, { paymentConfirmed: payload.status === 'confirmed' });
  }

  /**
   * Task 10's V2 planning gate calls this before a trusted channel order can
   * enter Planned. Expand-phase legacy rows remain readable/storable as null,
   * but an internal ID must never be substituted for missing provider identity.
   */
  assertV2PlanningExternalLineIdentity(salesChannel: string, lines: V2PlanningSalesOrderLineIdentity[]): void {
    if (!ACCEPTED_CONTRACT_CHANNELS.has(salesChannel)) {
      return;
    }

    const missingLineIds = lines
      .filter((line) => {
        const itemId = line.channelOrderItemId?.trim();
        const productId = line.channelProductId?.trim();
        return !itemId || Boolean(productId && itemId === productId);
      })
      .map((line) => line.id);
    if (missingLineIds.length > 0) {
      throw new BadRequestException(
        `V2 planning requires channelOrderItemId; trusted channelOrderItemId is missing for channel lines: ${missingLineIds.join(', ')}`,
      );
    }
  }

  private normalizeCancelArgs(
    optionsOrTx?: CancelSalesOrderOptions | DbTx,
    tx?: DbTx,
  ): { options: CancelSalesOrderOptions; tx?: DbTx } {
    if (this.isDbTx(optionsOrTx)) {
      return { options: {}, tx: optionsOrTx };
    }
    return { options: optionsOrTx ?? {}, tx };
  }

  private isDbTx(value: unknown): value is DbTx {
    return Boolean(value && typeof value === 'object' && 'select' in value && 'insert' in value);
  }

  private hasPartialCancellationLines(options: CancelSalesOrderOptions): options is CancelSalesOrderOptions & {
    lines: PartialCancellationLine[];
  } {
    return Array.isArray(options.lines) && options.lines.length > 0;
  }

  /** 상자 전 전체취소 — 상자 이력이 없는 주문을 통째로 취소한다. 출고 증거가 있으면 거절한다. */
  private async cancelBeforeBoxingFull(
    id: string,
    salesOrder: typeof wmsTables.salesOrders.$inferSelect,
    options: CancelSalesOrderOptions,
    trx: DbTx,
  ) {
    const existingCancellation = await trx
      .select()
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, id),
          eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (existingCancellation) {
      this.logger.warn(`Sales order ${id} already has full cancellation ${existingCancellation.id}`);
      if (salesOrder.status !== 'cancelled') {
        await trx
          .update(wmsTables.salesOrders)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(wmsTables.salesOrders.id, id));
      }
      await this.closeOpenFulfillmentBacklogEffects(id, trx);
      return this.getOne(id, trx);
    }

    const orderCancellationId = randomUUID();
    const originalLines = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));

    // FO와 FO item을 잠근 뒤 출고 증거 확인 (shipped evidence check와 cancel update를 같은 락 범위에서 처리).
    // 잠금·쓰기는 출고 모듈 명령이 한다 — 판정(출고 증거)만 판매주문이 쥔다(K7 PR3)
    await this.unboxedDemand.lockForCancellation(id, trx);

    const fulfillmentOrders = await trx
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, id));

    this.logger.log(`Found ${fulfillmentOrders.length} fulfillment orders for SO ${id}`);

    const hasShippedFulfillment = fulfillmentOrders.some(
      (fo) => fo.status === 'shipped' || fo.status === 'completed' || fo.shippedAt != null,
    );
    if (hasShippedFulfillment) {
      throw new BadRequestException(CANCEL_MSG_SHIPPED_FULFILLMENT);
    }

    if (hasShippedSku(await readLineQuantities(trx, id))) {
      throw new BadRequestException(CANCEL_MSG_SHIPPED_ITEMS);
    }

    const effects: CancellationEffect[] = [];
    // created·ready FO 만 닫힌다 — FOI 에 canceledQty 를 남기고 FO 상태는 투영(D3·D4). 상자 전 FO 엔 예약이 없다(N13)
    const cancelledFulfillmentOrders = await this.unboxedDemand.cancelOrder(id, trx);
    for (const fo of cancelledFulfillmentOrders) {
      effects.push({
        type: 'cancelled_fulfillment_order',
        targetType: 'fulfillment_order',
        targetId: fo.fulfillmentOrderId,
        metadata: { previousStatus: fo.previousStatus },
      });
      this.logger.log(`Cancelled fulfillment order: ${fo.fulfillmentOrderId}`);
    }

    const closedBacklog = await this.closeOpenFulfillmentBacklogEffects(id, trx);
    for (const backlogId of closedBacklog.backlogIds) {
      effects.push({
        type: 'closed_fulfillment_creation_backlog',
        targetType: 'fulfillment_order_creation_backlog',
        targetId: backlogId,
      });
    }
    if (closedBacklog.closedCount > 0 && closedBacklog.backlogIds.length === 0) {
      effects.push({
        type: 'closed_fulfillment_creation_backlog',
        targetType: 'fulfillment_order_creation_backlog',
        targetExternalRef: `sales_order:${id}:fulfillment_creation_backlog`,
        count: closedBacklog.closedCount,
      });
    }

    const digitalRevocation = await this.revokeDigitalOwnershipEffects(id, options.reasonCode ?? null, trx);
    for (const ownershipId of digitalRevocation.ownershipIds) {
      effects.push({
        type: 'revoked_digital_ownership',
        targetType: 'digital_asset_ownership',
        targetId: ownershipId,
      });
    }
    if (digitalRevocation.revokedCount > 0 && digitalRevocation.ownershipIds.length === 0) {
      effects.push({
        type: 'revoked_digital_ownership',
        targetType: 'digital_asset_ownership',
        targetExternalRef: `sales_order:${id}:digital_ownerships`,
        count: digitalRevocation.revokedCount,
      });
    }
    const walletRefundEffect = this.toWalletRefundEffect(options);
    if (walletRefundEffect) {
      effects.push(walletRefundEffect);
    }

    const occurredAt = options.occurredAt ? new Date(options.occurredAt) : new Date();
    const cancellationValues: SalesOrderCancellationInsert = {
      id: orderCancellationId,
      salesOrderId: id,
      cancellationScope: 'full',
      status: 'applied',
      reasonCode: options.reasonCode ?? null,
      reasonDetail: options.reasonDetail ?? null,
      cancelledBy: options.cancelledBy ?? null,
      effects,
      metadata: { ...(options.metadata ?? {}), ...this.commandReplayMetadata(id, options) },
      occurredAt,
    };
    const cancellation = await recordSalesOrderCancellation(trx, cancellationValues, null);

    await trx
      .update(wmsTables.salesOrders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(wmsTables.salesOrders.id, id));

    await this.linkCancellationEffects(id, cancellation.id, 'full', effects, occurredAt, trx);

    const updated = await this.getOne(id, trx);

    await this.coreOrders.enqueue(
      {
        idempotencyKey: `so-cancelled:${cancellation.id}`,
        eventType: 'SalesOrderCancelled',
        aggregateId: id,
        partitionKey: id,
        payload: {
          orderId: id,
          channelOrderId: salesOrder.channelOrderId ?? undefined,
          reason: toCancelReason(options.reasonCode),
          reasonDetail: options.reasonDetail ?? undefined,
          cancelledBy: options.cancelledBy ?? 'system',
          cancelledAt: occurredAt.toISOString(),
          cancellationScope: 'full',
          refundRequired: !!(salesOrder.walletIntentId && (salesOrder.totalAmount ?? 0) > 0),
          refundAmount: options.walletRefund?.amount,
        } satisfies SalesOrderCancelledPayload,
      },
      trx,
    );

    await this.audit?.logResourceChange(
      'ORDER_CANCELLED',
      'cancel',
      'order',
      'salesOrder',
      id,
      `Sales Order ${salesOrder.channelOrderId || id}`,
      { status: salesOrder.status },
      {
        status: 'cancelled',
        orderCancellationId: cancellation.id,
        originalLineCount: originalLines.length,
        effectTypes: effects.map((effect) => effect.type),
      },
      undefined,
      trx,
    );

    this.logger.log(
      `Successfully cancelled sales order ${id} and ${cancelledFulfillmentOrders.length} fulfillment orders`,
    );
    return updated;
  }

  private async cancelBeforeBoxingPartial(
    salesOrderId: string,
    salesOrder: typeof wmsTables.salesOrders.$inferSelect,
    options: CancelSalesOrderOptions & { lines: PartialCancellationLine[] },
    trx: DbTx,
  ) {
    if (salesOrder.status === 'cancelled') {
      throw new BadRequestException(CANCEL_MSG_ALREADY_CANCELLED);
    }

    const [fullCancellation] = await trx
      .select({ id: wmsTables.salesOrderCancellations.id })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
        ),
      )
      .limit(1);
    if (fullCancellation) {
      throw new BadRequestException(CANCEL_MSG_FULL_CANCELLATION_EXISTS);
    }

    const requestedLines = this.normalizePartialCancellationLines(options.lines);
    const originalLines = await trx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    const lineById = new Map(originalLines.map((line) => [line.id, line]));

    const priorCancellationContext = await this.loadPriorCancellationContext(salesOrderId, trx);
    for (const request of requestedLines) {
      const line = lineById.get(request.salesOrderLineId);
      if (!line) {
        throw new BadRequestException(
          `Sales order line ${request.salesOrderLineId} does not belong to ${salesOrderId}`,
        );
      }
      assertNotExchangeLine(line);
      const cancelableQuantity = cancelableOf(priorCancellationContext, line.id);
      if (request.quantity > cancelableQuantity) {
        throw new BadRequestException(cancelQuantityExceedsMessage(request.quantity, cancelableQuantity));
      }
    }

    // FO → FOI(id 순) 잠금·읽기는 출고 모듈 명령이 한다. 판매주문은 «라인 수량 → SKU 수요 감소분»만 정한다(K7 PR3)
    const demandItems = await this.unboxedDemand.lockForCancellation(salesOrderId, trx);
    const openFulfillmentBacklogs = await this.loadOpenFulfillmentBacklogs(salesOrderId, trx);

    // 감소분은 요청 전체를 모아 명령을 한 번 부른다 — 효과 순서를 지키려고 자리표시(reduction)를 끼워 두고 뒤에 채운다
    const plannedEffects: PlannedPartialEffect[] = [];
    for (const request of requestedLines) {
      const line = lineById.get(request.salesOrderLineId)!;
      const remainingLineQuantity = remainingOf(priorCancellationContext, line.id);
      const lineItems = demandItems.filter(
        (item) => item.salesOrderLineId === line.id && item.qty - item.canceledQty > 0,
      );
      const adjustmentEffects = this.adjustFulfillmentForPartialCancellation(
        line.id,
        remainingLineQuantity,
        request.quantity,
        lineItems,
        priorCancellationContext.preservedShippedByFulfillmentItem,
        options.postShipmentHandoff,
      );

      plannedEffects.push(...adjustmentEffects);
      if (adjustmentEffects.length === 0) {
        if (openFulfillmentBacklogs.length > 0) {
          await this.requeueAwaitingMatchingFulfillmentBacklogs(salesOrderId, openFulfillmentBacklogs, trx);
          for (const backlog of openFulfillmentBacklogs) {
            plannedEffects.push({
              type: 'reduced_pending_fulfillment_quantity',
              targetType: 'fulfillment_order_creation_backlog',
              targetId: backlog.id,
              metadata: {
                salesOrderLineId: line.id,
                cancelledQuantity: request.quantity,
                remainingLineQuantity,
                backlogStatus: backlog.status,
                ...(backlog.status === 'awaiting_matching' ? { newBacklogStatus: 'pending' } : {}),
              },
            });
          }
        } else {
          plannedEffects.push({
            type: 'no_physical_fulfillment_adjustment_required',
            targetType: 'sales_order_line',
            targetId: line.id,
            metadata: {
              cancelledQuantity: request.quantity,
              remainingLineQuantity,
            },
          });
        }
      }
    }

    const orderCancellationId = randomUUID();
    const effects = await this.applyUnboxedDemandReductions(salesOrderId, plannedEffects, trx);

    const walletRefundEffect = this.toWalletRefundEffect(options);
    if (walletRefundEffect) {
      effects.push(walletRefundEffect);
    }

    const occurredAt = options.occurredAt ? new Date(options.occurredAt) : new Date();
    const cancelledLines = requestedLines.map((line) => ({
      salesOrderLineId: line.salesOrderLineId,
      quantity: line.quantity,
    }));
    const cancellationValues: SalesOrderCancellationInsert = {
      id: orderCancellationId,
      salesOrderId,
      cancellationScope: 'partial',
      status: 'applied',
      reasonCode: options.reasonCode ?? null,
      reasonDetail: options.reasonDetail ?? null,
      cancelledBy: options.cancelledBy ?? null,
      effects,
      metadata: { ...(options.metadata ?? {}), ...this.commandReplayMetadata(salesOrderId, options) },
      occurredAt,
    };
    const cancellation = await recordSalesOrderCancellation(trx, cancellationValues, cancelledLines);

    await this.linkCancellationEffects(salesOrderId, cancellation.id, 'partial', effects, occurredAt, trx);

    await this.coreOrders.enqueue(
      {
        idempotencyKey: `so-cancelled:${cancellation.id}`,
        eventType: 'SalesOrderCancelled',
        aggregateId: salesOrderId,
        partitionKey: salesOrderId,
        payload: {
          orderId: salesOrderId,
          channelOrderId: salesOrder.channelOrderId ?? undefined,
          reason: toCancelReason(options.reasonCode),
          reasonDetail: options.reasonDetail ?? undefined,
          cancelledBy: options.cancelledBy ?? 'system',
          cancelledAt: occurredAt.toISOString(),
          cancellationScope: 'partial',
          refundRequired: !!(salesOrder.walletIntentId && (salesOrder.totalAmount ?? 0) > 0),
          refundAmount: options.walletRefund?.amount,
          cancelledLines: requestedLines.map((line) => ({
            salesOrderLineId: line.salesOrderLineId,
            quantity: line.quantity,
          })),
        } satisfies SalesOrderCancelledPayload,
      },
      trx,
    );

    await this.audit?.logResourceChange(
      'ORDER_CANCELLED',
      'cancel_partial',
      'order',
      'salesOrder',
      salesOrderId,
      `Sales Order ${salesOrder.channelOrderId || salesOrderId}`,
      { status: salesOrder.status },
      {
        status: salesOrder.status,
        orderCancellationId: cancellation.id,
        cancelledLines,
        effectTypes: effects.map((effect) => effect.type),
      },
      undefined,
      trx,
    );

    return this.getOne(salesOrderId, trx);
  }

  private async hasBoxedFulfillment(salesOrderId: string, tx: DbTx): Promise<boolean> {
    const rows = await tx.execute(sql`
      SELECT s.id
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
       WHERE fo.sales_order_id = ${salesOrderId}
         AND s.opened_for_fulfillment_order_id IS NULL
       LIMIT 1
    `);
    return Array.from(rows as unknown as ArrayLike<unknown>).length > 0;
  }

  /**
   * 부분 취소 요청을 전체 취소 뒤에 받으면 `cancelBeforeBoxingPartial`·`planCancellation` 과 같은 순서·문구로 400 거절한다.
   * 상자 후는 박스 줄 배분 검사가 대부분을 거르지만 상자를 거치지 않는 줄(디지털·외주)은 그 검사를 지나가서,
   * 이 확인이 없으면 쓰기 문 도출(라인 합 > 주문 수량)이 터져 500 이 된다.
   */
  private async assertNoFullCancellation(salesOrderId: string, tx: DbTx): Promise<void> {
    const [salesOrder] = await tx
      .select({ status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .limit(1);
    if (salesOrder?.status === 'cancelled') throw new BadRequestException(CANCEL_MSG_ALREADY_CANCELLED);
    const [fullCancellation] = await tx
      .select({ id: wmsTables.salesOrderCancellations.id })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
        ),
      )
      .limit(1);
    if (fullCancellation) throw new BadRequestException(CANCEL_MSG_FULL_CANCELLATION_EXISTS);
  }

  /**
   * 상자 후 취소의 계획 — 요청 줄 → 박스 줄 배분과 거절 사유. 읽기만 한다(스펙 §5.2). 거절 문구는 옮기기 전과 같다.
   * `cancelAfterBoxing`(적용)과 `planCancellation`(요청 때 판정)이 함께 쓴다.
   */
  private async planAfterBoxing(
    salesOrderId: string,
    options: CancelSalesOrderOptions,
    isFullCancel: boolean,
    tx: DbTx,
  ): Promise<AfterBoxingPlan> {
    if (!isFullCancel) await this.assertNoFullCancellation(salesOrderId, tx);
    const salesOrderLines = await tx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    const fulfillmentItems = await tx
      .select({
        id: wmsTables.fulfillmentOrderItems.id,
        qty: wmsTables.fulfillmentOrderItems.qty,
        shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
        skuId: wmsTables.fulfillmentOrderItems.skuId,
      })
      .from(wmsTables.fulfillmentOrderItems)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    // 비율은 굳힌 라인 구성에서 읽는다(#1063 스펙 §6.5)
    const compositions = await selectFrozenCompositions(
      tx,
      salesOrderLines.map((line) => line.id),
    );
    const lineQuantities = await readLineQuantities(tx, salesOrderId);
    const prior = await this.loadPriorCancellationContext(salesOrderId, tx, lineQuantities);
    // 교환 줄은 취소 대상이 아니다(K8 PR11 N18) — 열리기 전엔 FOI 도 없다
    const channelSalesLines = salesOrderLines.filter((line) => !isExchangeLine(line));
    const requestedSalesLines = isFullCancel
      ? channelSalesLines.flatMap((line) => {
          // 갈래는 FOI 유무로 정한다 — FOI 가 있으면 SKU 층이 반드시 비어 있지 않다. 구성만 있고 FOI 가 없는 물리 줄을
          // SKU 층(0 들)로 판정하면 0 단위로 조용히 빠져 전체 취소가 그 줄의 남은 수량을 놓친다
          if (!fulfillmentItems.some((item) => item.salesOrderLineId === line.id)) {
            // 인쇄(외주) 줄은 창고 항목이 없어도 판매·환불 대상이다. 남은 판매 수량을 넣고 출고 정리만 아래에서 건너뛴다.
            // 빼 버리면 전체 취소가 부분 취소로 바뀔 때 와우프레스는 취소됐는데 인쇄분이 환불되지 않는다
            if (isOutsourcedLine(line)) {
              const remaining = remainingOf(prior, line.id);
              return remaining > 0 ? [{ salesOrderLineId: line.id, quantity: remaining }] : [];
            }
            if (isDigitalFulfillmentLine(line)) return [];
            throw new ConflictException(`Boxed fulfillment item is missing for SalesOrder line ${line.id}`);
          }
          const quantities = lineQuantities.get(line.id);
          if (!quantities) throw new Error(`Line quantities are missing SalesOrder line ${line.id}`);
          return [{ salesOrderLineId: line.id, quantity: cancellableSalesUnits(quantities) }];
        })
      : this.normalizePartialCancellationLines(options.lines ?? []);
    if (requestedSalesLines.every((line) => line.quantity === 0)) {
      throw new BadRequestException(CANCEL_MSG_NOTHING_TO_CANCEL);
    }
    const salesLineById = new Map(salesOrderLines.map((line) => [line.id, line]));
    for (const request of requestedSalesLines) {
      const line = salesLineById.get(request.salesOrderLineId);
      if (!line)
        throw new BadRequestException(
          `Sales order line ${request.salesOrderLineId} does not belong to ${salesOrderId}`,
        );
      assertNotExchangeLine(line);
      // 전체취소에도 돈다 — 물리 줄은 outstanding ≤ cancelable 이라 안전하고, 인쇄(외주) 줄은 배송완료 0 이라 반품이 잡지 못한다
      const cancelable = cancelableOf(prior, line.id);
      if (request.quantity > cancelable) {
        throw new BadRequestException(`Cancellation quantity ${request.quantity} exceeds remaining ${cancelable}`);
      }
    }

    const activeRows = await tx
      .select({
        shipmentId: wmsTables.shipments.id,
        shipmentStatus: wmsTables.shipments.status,
        manifestVersion: wmsTables.shipments.manifestVersion,
        shipmentLineId: wmsTables.shipmentLines.id,
        lineVersion: wmsTables.shipmentLines.lineVersion,
        lineQty: wmsTables.shipmentLines.qty,
        fulfillmentOrderItemId: wmsTables.fulfillmentOrderItems.id,
        fulfillmentOrderItemQty: wmsTables.fulfillmentOrderItems.qty,
        salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          inArray(wmsTables.shipments.status, ['draft', 'planned', 'recovery_required']),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id), asc(wmsTables.shipmentLines.id));

    const cancellationByShipment = new Map<
      string,
      { manifestVersion: number; lines: Array<{ shipmentLineId: string; expectedLineVersion: number; qty: number }> }
    >();
    for (const request of requestedSalesLines.filter((line) => line.quantity > 0)) {
      const salesLine = salesLineById.get(request.salesOrderLineId)!;
      const requestedItems = fulfillmentItems.filter((item) => item.salesOrderLineId === request.salesOrderLineId);
      if (requestedItems.length === 0) {
        if (isDigitalFulfillmentLine(salesLine) || isOutsourcedLine(salesLine)) continue;
        throw new ConflictException(`Boxed fulfillment item is missing for SalesOrder line ${salesLine.id}`);
      }
      for (const { itemId, qty: physicalQty } of physicalCancellationByItem(
        salesLine.id,
        request.quantity,
        requestedItems,
        compositions.get(salesLine.id) ?? [],
      )) {
        let remainingPhysicalQty = physicalQty;
        const rows = activeRows.filter((candidate) => candidate.fulfillmentOrderItemId === itemId);
        const ordered = [...rows].sort((left, right) => {
          const leftRank = left.shipmentStatus === 'draft' ? 0 : 1;
          const rightRank = right.shipmentStatus === 'draft' ? 0 : 1;
          return (
            leftRank - rightRank ||
            left.shipmentId.localeCompare(right.shipmentId) ||
            left.shipmentLineId.localeCompare(right.shipmentLineId)
          );
        });
        for (const row of ordered) {
          if (remainingPhysicalQty === 0) break;
          const qty = Math.min(remainingPhysicalQty, row.lineQty);
          const group = cancellationByShipment.get(row.shipmentId) ?? {
            manifestVersion: row.manifestVersion,
            lines: [],
          };
          group.lines.push({ shipmentLineId: row.shipmentLineId, expectedLineVersion: row.lineVersion, qty });
          cancellationByShipment.set(row.shipmentId, group);
          remainingPhysicalQty -= qty;
        }
        if (remainingPhysicalQty > 0) {
          throw new ConflictException(
            `Boxed outstanding line quantity is short by ${remainingPhysicalQty} for fulfillment item ${itemId}`,
          );
        }
      }
    }
    return { salesOrderLines, salesLineById, fulfillmentItems, prior, requestedSalesLines, cancellationByShipment };
  }

  /**
   * Boxed commercial cancellation seam. SO cancellation remains the commercial
   * coordinator, while ShipmentPlanningService exclusively mutates outstanding
   * physical demand. FOI.qty is never rewritten on this path.
   */
  private async cancelAfterBoxing(
    salesOrderId: string,
    salesOrder: typeof wmsTables.salesOrders.$inferSelect,
    options: CancelSalesOrderOptions,
    isFullCancel: boolean,
    tx: DbTx,
  ) {
    const planning = this.moduleRef?.get(ShipmentPlanningService, { strict: false });
    if (!planning) throw new Error('ShipmentPlanningService is required for boxed sales-order cancellation');

    if (isFullCancel) {
      const [existing] = await tx
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(
          and(
            eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
            eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
          ),
        )
        .limit(1);
      if (existing) return this.getOne(salesOrderId, tx);
    }

    const { fulfillmentItems, requestedSalesLines, salesLineById, cancellationByShipment } = await this.planAfterBoxing(
      salesOrderId,
      options,
      isFullCancel,
      tx,
    );

    // 취소 행 id 를 먼저 정해 출고 명령에 넘긴다 — 넘긴 입점사 상자의 알릴 취소 행이 이 취소를 가리킨다(K3 PR6, ADR-0049 PR5)
    const orderCancellationId = randomUUID();
    const cancellationScope = isFullCancel ? 'full' : 'partial';
    const reason = options.reasonDetail?.trim() || options.reasonCode?.trim() || 'Sales order cancellation';
    const sourceKey =
      options.fulfillmentCommandContext?.idempotencyKey ||
      (typeof options.metadata?.sourceEventId === 'string'
        ? options.metadata.sourceEventId
        : canonicalFulfillmentRequestHash({ salesOrderId, lines: requestedSalesLines, reason }).slice(0, 32));
    const commandActor = options.fulfillmentCommandContext
      ? {
          id: options.fulfillmentCommandContext.actorId,
          roles: options.fulfillmentCommandContext.actorRoles,
        }
      : FULFILLMENT_SYSTEM_ACTOR;
    const operationEffects: CancellationEffect[] = [];
    for (const request of requestedSalesLines) {
      const salesLine = salesLineById.get(request.salesOrderLineId)!;
      if (
        (isDigitalFulfillmentLine(salesLine) || isOutsourcedLine(salesLine)) &&
        !fulfillmentItems.some((item) => item.salesOrderLineId === salesLine.id)
      ) {
        operationEffects.push({
          type: 'no_physical_fulfillment_adjustment_required',
          targetType: 'sales_order_line',
          targetId: salesLine.id,
          metadata: {
            cancelledQuantity: request.quantity,
            fulfillmentKind: isDigitalFulfillmentLine(salesLine) ? 'digital' : 'outsourced',
          },
        });
      }
    }
    for (const [shipmentId, request] of [...cancellationByShipment.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const result = await planning.cancelOutstanding(
        shipmentId,
        {
          expectedManifestVersion: request.manifestVersion,
          lines: request.lines.sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId)),
          reason,
        },
        `sales-order-cancel:${sourceKey}:${shipmentId}`,
        commandActor,
        { orderCancellationId, scope: cancellationScope },
        tx,
      );
      operationEffects.push({
        type: 'shipment_outstanding_cancellation',
        targetType: 'shipment_operation',
        targetId: result.operationId,
        metadata: { shipmentId, operationStatus: result.operationStatus },
      });
    }

    const walletRefundEffect = this.toWalletRefundEffect(options);
    if (walletRefundEffect) operationEffects.push(walletRefundEffect);
    if (isFullCancel) {
      const closed = await this.closeOpenFulfillmentBacklogEffects(salesOrderId, tx);
      operationEffects.push(
        ...closed.backlogIds.map((id) => ({
          type: 'closed_fulfillment_creation_backlog',
          targetType: 'fulfillment_order_creation_backlog',
          targetId: id,
        })),
      );
      const revoked = await this.revokeDigitalOwnershipEffects(salesOrderId, options.reasonCode ?? null, tx);
      operationEffects.push(
        ...revoked.ownershipIds.map((id) => ({
          type: 'revoked_digital_ownership',
          targetType: 'digital_asset_ownership',
          targetId: id,
        })),
      );
    }

    const occurredAt = options.occurredAt ? new Date(options.occurredAt) : new Date();
    const cancellationValues: SalesOrderCancellationInsert = {
      id: orderCancellationId,
      salesOrderId,
      cancellationScope,
      status: 'applied',
      reasonCode: options.reasonCode ?? null,
      reasonDetail: options.reasonDetail ?? null,
      cancelledBy: options.cancelledBy ?? null,
      effects: operationEffects,
      metadata: {
        ...(options.metadata ?? {}),
        fulfillmentCommandSourceKey: this.explicitAfterBoxingSourceKey(options),
        fulfillmentCommandRequestHash: this.afterBoxingRequestHash(salesOrderId, options),
      },
      occurredAt,
    };
    const cancellation = await recordSalesOrderCancellation(tx, cancellationValues, requestedSalesLines);
    if (isFullCancel) {
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
    }
    await this.linkCancellationEffects(
      salesOrderId,
      cancellation.id,
      cancellationScope,
      operationEffects,
      occurredAt,
      tx,
    );
    await this.coreOrders.enqueue(
      {
        idempotencyKey: `so-cancelled:${cancellation.id}`,
        eventType: 'SalesOrderCancelled',
        aggregateId: salesOrderId,
        partitionKey: salesOrderId,
        payload: {
          orderId: salesOrderId,
          channelOrderId: salesOrder.channelOrderId,
          reason: toCancelReason(options.reasonCode),
          reasonDetail: options.reasonDetail,
          cancelledBy: options.cancelledBy ?? 'system',
          cancelledAt: occurredAt.toISOString(),
          cancellationScope,
          refundRequired: Boolean(salesOrder.walletIntentId && (salesOrder.totalAmount ?? 0) > 0),
          cancelledLines: isFullCancel ? undefined : requestedSalesLines,
        } satisfies SalesOrderCancelledPayload,
      },
      tx,
    );
    return this.getOne(salesOrderId, tx);
  }

  /**
   * 명령 키(Idempotency-Key)로 온 상자 전 취소도 키·요청 해시를 남긴다 (K7 PR4). 상자 후 취소와 같은 칸이라 `cancel()` 첫머리의
   * 재전송 판정과 `validateCancellationReplay` 가 상자 유무와 무관하게 같은 키를 알아본다 — 없으면 같은 키의 부분취소가 두 번
   * 적용되고 환불 링크도 둘이 된다. 채널 이벤트 id(`sourceEventId`)는 넣지 않는다 — 채널 경로는 자기 수신 기록으로 중복을 막는다
   */
  private commandReplayMetadata(salesOrderId: string, options: CancelSalesOrderOptions): Record<string, string> {
    const idempotencyKey = options.fulfillmentCommandContext?.idempotencyKey?.trim();
    if (!idempotencyKey) return {};
    return {
      fulfillmentCommandSourceKey: idempotencyKey,
      fulfillmentCommandRequestHash: this.afterBoxingRequestHash(salesOrderId, options),
    };
  }

  private explicitAfterBoxingSourceKey(options: CancelSalesOrderOptions): string | undefined {
    const idempotencyKey = options.fulfillmentCommandContext?.idempotencyKey?.trim();
    if (idempotencyKey) return idempotencyKey;
    return typeof options.metadata?.sourceEventId === 'string' && options.metadata.sourceEventId.trim()
      ? options.metadata.sourceEventId.trim()
      : undefined;
  }

  private afterBoxingRequestHash(salesOrderId: string, options: CancelSalesOrderOptions): string {
    const lines = this.hasPartialCancellationLines(options)
      ? this.normalizePartialCancellationLines(options.lines ?? []).sort((left, right) =>
          left.salesOrderLineId.localeCompare(right.salesOrderLineId),
        )
      : undefined;
    return canonicalFulfillmentRequestHash({
      salesOrderId,
      lines,
      reasonCode: options.reasonCode?.trim() || undefined,
      reasonDetail: options.reasonDetail?.trim() || undefined,
    });
  }

  private async findAfterBoxingReplay(
    salesOrderId: string,
    options: CancelSalesOrderOptions,
    tx: DbTx,
  ): Promise<{ requestHash: string } | undefined> {
    const sourceKey = this.explicitAfterBoxingSourceKey(options);
    if (!sourceKey) return undefined;
    const rows = await tx
      .select({ metadata: wmsTables.salesOrderCancellations.metadata })
      .from(wmsTables.salesOrderCancellations)
      .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
    for (const row of rows) {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      if (metadata.fulfillmentCommandSourceKey !== sourceKey) continue;
      if (typeof metadata.fulfillmentCommandRequestHash === 'string') {
        return { requestHash: metadata.fulfillmentCommandRequestHash };
      }
    }
    return undefined;
  }

  private normalizePartialCancellationLines(lines: PartialCancellationLine[]): PartialCancellationLine[] {
    const byLineId = new Map<string, number>();
    for (const line of lines) {
      if (!line.salesOrderLineId) {
        throw new BadRequestException('Partial cancellation line must include salesOrderLineId');
      }
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new BadRequestException(
          `Partial cancellation quantity for line ${line.salesOrderLineId} must be positive`,
        );
      }
      byLineId.set(line.salesOrderLineId, (byLineId.get(line.salesOrderLineId) ?? 0) + line.quantity);
    }
    return [...byLineId.entries()].map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity }));
  }

  /**
   * 취소 «계획» — 부작용 없이 지금 취소가 받는 범위를 판정한다(#1016 35번, 스펙 §5.2). 채널 주문 취소 요청이
   * 요청 때 이것만 부르고, 적용은 확정 때 `cancel` 이 한다. 거절은 `cancel` 과 같은 예외·같은 문구다.
   * 잠그지 않는다 — 부르는 쪽이 판매주문·박스를 잠근 트랜잭션 안에서 부른다.
   */
  async planCancellation(
    salesOrderId: string,
    lines: PartialCancellationLine[] | undefined,
    tx: DbTx,
  ): Promise<CancellationPlan> {
    const options: CancelSalesOrderOptions = lines ? { lines } : {};
    const isFullCancel = !lines;
    if (Array.isArray(lines) && lines.length === 0) {
      throw new BadRequestException('Partial cancellation lines cannot be empty; omit lines for full cancellation');
    }
    if (await this.hasBoxedFulfillment(salesOrderId, tx)) {
      const plan = await this.planAfterBoxing(salesOrderId, options, isFullCancel, tx);
      const requested = plan.requestedSalesLines.filter((line) => line.quantity > 0);
      const hasShippedQuantity = plan.fulfillmentItems.some((item) => item.shippedQty > 0);
      return {
        lines: requested,
        hasShippedQuantity,
        // 전체 요청은 디지털 줄(계획에서 건너뜀)이 있어도 «나간 것만 빼고 전부»다 — 줄 합산으로 보면 틀린다.
        leavesNothing: isFullCancel
          ? !hasShippedQuantity
          : this.leavesNothing(plan.salesOrderLines, plan.prior, requested),
      };
    }
    const [salesOrder] = await tx
      .select({ status: wmsTables.salesOrders.status })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .limit(1);
    if (!salesOrder) throw new NotFoundException(`Sales order ${salesOrderId} not found`);
    const salesOrderLines = await tx
      .select()
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
    const prior = await this.loadPriorCancellationContext(salesOrderId, tx);
    const [fullCancellation] = await tx
      .select({ id: wmsTables.salesOrderCancellations.id })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          eq(wmsTables.salesOrderCancellations.cancellationScope, 'full'),
        ),
      )
      .limit(1);
    if (!lines) {
      if (salesOrder.status === 'shipped' || salesOrder.status === 'delivered') {
        throw new BadRequestException(
          '이미 출고/배송 완료된 주문은 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.',
        );
      }
      // 전체취소 존재를 «남은 수량»보다 먼저 본다 — 이미 취소된 수량이 전체취소까지 세므로(K6 PR2a),
      // 뒤에 두면 남은 수량 0 거절이 먼저 나서 문구가 바뀐다.
      if (fullCancellation) throw new BadRequestException(CANCEL_MSG_FULL_CANCELLATION_EXISTS);
      const requested = salesOrderLines
        // 교환 줄은 취소 대상이 아니다(K8 PR11 N18)
        .filter((line) => !isExchangeLine(line))
        .map((line) => ({ salesOrderLineId: line.id, quantity: remainingOf(prior, line.id) }))
        .filter((line) => line.quantity > 0);
      if (requested.length === 0) {
        throw new BadRequestException(CANCEL_MSG_NOTHING_TO_CANCEL);
      }
      // `cancel` 의 전체 취소 경로와 같은 출고 증거 거절(박스 이력은 없지만 FO 가 나갔을 수 있다).
      const fulfillmentOrders = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
      if (
        fulfillmentOrders.some((fo) => fo.status === 'shipped' || fo.status === 'completed' || fo.shippedAt != null)
      ) {
        throw new BadRequestException(CANCEL_MSG_SHIPPED_FULFILLMENT);
      }
      if (hasShippedSku(await readLineQuantities(tx, salesOrderId))) {
        throw new BadRequestException(CANCEL_MSG_SHIPPED_ITEMS);
      }
      return { lines: requested, hasShippedQuantity: false, leavesNothing: true };
    }
    // `cancelBeforeBoxingPartial` 과 같은 거절 순서·문구.
    if (salesOrder.status === 'cancelled') throw new BadRequestException(CANCEL_MSG_ALREADY_CANCELLED);
    if (fullCancellation) throw new BadRequestException(CANCEL_MSG_FULL_CANCELLATION_EXISTS);
    const requested = this.normalizePartialCancellationLines(lines);
    const byId = new Map(salesOrderLines.map((line) => [line.id, line]));
    for (const request of requested) {
      const line = byId.get(request.salesOrderLineId);
      if (!line) {
        throw new BadRequestException(
          `Sales order line ${request.salesOrderLineId} does not belong to ${salesOrderId}`,
        );
      }
      assertNotExchangeLine(line);
      const cancelable = cancelableOf(prior, line.id);
      if (request.quantity > cancelable) {
        throw new BadRequestException(cancelQuantityExceedsMessage(request.quantity, cancelable));
      }
    }
    return {
      lines: requested,
      hasShippedQuantity: false,
      leavesNothing: this.leavesNothing(salesOrderLines, prior, requested),
    };
  }

  /** 이 취소 뒤 남는 수량(남은 수량 − 이번 취소)이 모든 줄에서 0 인가. 디지털 줄도 센다. 이번 요청을 빼는 건 판정이다. */
  private leavesNothing(
    salesOrderLines: Array<{ id: string; quantity: number }>,
    prior: PriorCancellationContext,
    requested: PartialCancellationLine[],
  ): boolean {
    const now = new Map(requested.map((line) => [line.salesOrderLineId, line.quantity]));
    return salesOrderLines.every((line) => remainingOf(prior, line.id) - (now.get(line.id) ?? 0) <= 0);
  }

  /**
   * 이 주문의 이전 취소가 남긴 엔진 상태 (K6 PR2a, `remainingByLine` 은 PR2b).
   * `remainingByLine` 은 라인 수량 문의 `remaining`(주문 − 갈래·scope 무관 취소 — 전체취소도 센다)이다.
   * `cancelableByLine` 은 거기서 반품이 잡은 수량(`returnHeld`)을 뺀 요청 검사의 상한이다(K8 PR5).
   * 문을 이미 읽은 호출자(상자 후 재계획)는 `lineQuantities` 를 넘겨 같은 트랜잭션에서 두 번 읽지 않는다.
   * `preservedShippedByFulfillmentItem` 은 «어느 FOI 의 출고분을 이미 보존 처리했나»라는 FOI 단위 상태라
   * 라인 행으로 되살릴 수 없어(세트에서 구성품 하나만 나간 단위도 `after_shipment` 1) effects 에서 읽는다.
   */
  private async loadPriorCancellationContext(
    salesOrderId: string,
    trx: DbTx,
    lineQuantities?: Map<string, LineQuantities>,
  ): Promise<PriorCancellationContext> {
    const quantities = lineQuantities ?? (await readLineQuantities(trx, salesOrderId));
    const remainingByLine = new Map([...quantities.values()].map((line) => [line.salesOrderLineId, line.remaining]));
    const cancelableByLine = new Map(
      [...quantities.values()].map((line) => [line.salesOrderLineId, line.remaining - line.returnHeld]),
    );

    const cancellations = await trx
      .select({ effects: wmsTables.salesOrderCancellations.effects })
      .from(wmsTables.salesOrderCancellations)
      .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
    const preservedShippedByFulfillmentItem = new Map<string, number>();
    for (const cancellation of cancellations) {
      const effects = Array.isArray(cancellation.effects) ? cancellation.effects : [];
      for (const effect of effects) {
        if (!effect || typeof effect !== 'object') continue;
        const effectRecord = effect as Record<string, unknown>;
        if (effectRecord.type !== 'preserved_shipped_fulfillment_order_item') continue;
        const fulfillmentOrderItemId = effectRecord.targetId;
        const effectMetadata =
          effectRecord.metadata && typeof effectRecord.metadata === 'object'
            ? (effectRecord.metadata as Record<string, unknown>)
            : {};
        const affectedShippedQuantity = effectMetadata.affectedShippedQuantity;
        if (typeof fulfillmentOrderItemId === 'string' && typeof affectedShippedQuantity === 'number') {
          preservedShippedByFulfillmentItem.set(
            fulfillmentOrderItemId,
            (preservedShippedByFulfillmentItem.get(fulfillmentOrderItemId) ?? 0) + affectedShippedQuantity,
          );
        }
      }
    }
    return { remainingByLine, cancelableByLine, preservedShippedByFulfillmentItem };
  }

  private async loadOpenFulfillmentBacklogs(salesOrderId: string, trx: DbTx) {
    const backlogs = await trx
      .select()
      .from(wmsTables.fulfillmentOrderCreationBacklogs)
      .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId));

    return backlogs.filter((backlog) => OPEN_FULFILLMENT_BACKLOG_STATUSES.has(backlog.status));
  }

  private async requeueAwaitingMatchingFulfillmentBacklogs(
    salesOrderId: string,
    backlogs: Array<typeof wmsTables.fulfillmentOrderCreationBacklogs.$inferSelect>,
    trx: DbTx,
  ): Promise<void> {
    if (!backlogs.some((backlog) => backlog.status === 'awaiting_matching')) {
      return;
    }

    await trx
      .update(wmsTables.fulfillmentOrderCreationBacklogs)
      .set({
        status: 'pending',
        waitingVariantIds: [],
        failureReason: null,
        failureDetails: null,
        nextAttemptAt: new Date(),
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, salesOrderId),
          eq(wmsTables.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
        ),
      );
  }

  /**
   * 라인 하나의 취소 수량을 SKU 수요 감소분으로 바꾼다 — 쓰지 않는다. 감소는 자리표시로, 출고 뒤 몫은 효과로 돌려준다.
   * 수요는 `qty − canceledQty`(옛 표현은 qty 를 깎고 canceled 0 이라 같은 값이다), 줄일 수 있는 몫은 명령의 `cancellableQty`.
   */
  private adjustFulfillmentForPartialCancellation(
    salesOrderLineId: string,
    remainingLineQuantity: number,
    cancelledLineQuantity: number,
    fulfillmentOrderItems: UnboxedDemandItem[],
    priorPreservedShippedByFulfillmentItem: Map<string, number>,
    postShipmentHandoff: PostShipmentHandoffOptions | undefined,
  ): PlannedPartialEffect[] {
    if (remainingLineQuantity <= 0 || fulfillmentOrderItems.length === 0) {
      return [];
    }

    const itemsBySku = new Map<string, UnboxedDemandItem[]>();
    for (const item of fulfillmentOrderItems) {
      const key = item.skuId;
      const group = itemsBySku.get(key) ?? [];
      group.push(item);
      itemsBySku.set(key, group);
    }

    const effects: PlannedPartialEffect[] = [];
    for (const [skuId, items] of itemsBySku) {
      const totalCurrentQty = items.reduce((sum, item) => sum + item.qty - item.canceledQty, 0);
      const priorPreservedShippedQty = items.reduce(
        (sum, item) => sum + (priorPreservedShippedByFulfillmentItem.get(item.fulfillmentOrderItemId) ?? 0),
        0,
      );
      const totalUncancelledQty = totalCurrentQty - priorPreservedShippedQty;
      if (totalUncancelledQty <= 0) continue;
      if (totalUncancelledQty % remainingLineQuantity !== 0) {
        throw new BadRequestException(
          `Cannot derive SKU ${skuId} fulfillment quantity for line ${salesOrderLineId}; current quantity ${totalUncancelledQty} is not divisible by remaining line quantity ${remainingLineQuantity}`,
        );
      }

      const skuQtyPerLineUnit = totalUncancelledQty / remainingLineQuantity;
      const fulfillmentQtyToCancel = cancelledLineQuantity * skuQtyPerLineUnit;
      let remainingFulfillmentQtyToCancel = fulfillmentQtyToCancel;
      const cancellableUnprocessedQty = items.reduce((sum, item) => sum + item.cancellableQty, 0);
      const shippedEvidenceQty = items.reduce((sum, item) => {
        const priorPreservedQty = priorPreservedShippedByFulfillmentItem.get(item.fulfillmentOrderItemId) ?? 0;
        return sum + Math.max(0, item.shippedQty - priorPreservedQty);
      }, 0);
      const postShipmentQty = Math.max(0, remainingFulfillmentQtyToCancel - cancellableUnprocessedQty);

      if (postShipmentQty > shippedEvidenceQty) {
        throw new BadRequestException(
          `취소하려는 수량 중 일부(${postShipmentQty}개)가 이미 피킹 또는 출고 처리된 상태입니다. 해당 수량은 반품/회수 처리가 필요합니다.`,
        );
      }

      for (const item of items) {
        if (remainingFulfillmentQtyToCancel <= 0) break;
        if (item.cancellableQty <= 0) continue;

        const quantityToReduce = Math.min(item.cancellableQty, remainingFulfillmentQtyToCancel);
        effects.push({ reduction: { item, salesOrderLineId, qty: quantityToReduce } });
        remainingFulfillmentQtyToCancel -= quantityToReduce;
      }

      if (postShipmentQty > 0) {
        effects.push(
          ...this.toPostShipmentCancellationEffects(
            salesOrderLineId,
            skuId,
            fulfillmentQtyToCancel,
            postShipmentQty,
            items,
            priorPreservedShippedByFulfillmentItem,
            postShipmentHandoff,
          ),
        );
      }
    }

    return effects;
  }

  /**
   * 계획한 감소를 FOI id 순으로 모아 명령을 한 번 부르고, 자리표시를 `adjusted_fulfillment_order_item` 효과로 바꾼다.
   * metadata 는 새 표현을 따른다(N15) — qty 는 그대로, canceledQty 의 전후. 예약 키는 없다(상자 전 수요엔 예약이 없다, N13).
   */
  private async applyUnboxedDemandReductions(
    salesOrderId: string,
    planned: PlannedPartialEffect[],
    trx: DbTx,
  ): Promise<CancellationEffect[]> {
    const reductions: UnboxedDemandReduction[] = planned
      .flatMap((entry) => ('reduction' in entry ? [entry.reduction] : []))
      .map(({ item, qty }) => ({ fulfillmentOrderItemId: item.fulfillmentOrderItemId, qty }))
      // uuid 문자열의 코드 단위 비교 = Postgres uuid 정렬(잠금 순서와 같다). localeCompare 는 '-' 를 무시할 수 있어 쓰지 않는다
      // FOI 하나에 감소 하나(FOI 는 라인 하나에 속한다)라 같은 id 는 없다
      .sort((a, b) => (a.fulfillmentOrderItemId < b.fulfillmentOrderItemId ? -1 : 1));
    const reduced = await this.unboxedDemand.reduce(salesOrderId, reductions, trx);
    const reducedById = new Map<string, ReducedDemandItem>(reduced.map((row) => [row.fulfillmentOrderItemId, row]));

    return planned.map((entry) => {
      if (!('reduction' in entry)) return entry;
      const { item, salesOrderLineId, qty } = entry.reduction;
      const row = reducedById.get(item.fulfillmentOrderItemId);
      if (!row) {
        throw new Error(`Unboxed demand reduction for FOI ${item.fulfillmentOrderItemId} was not applied`);
      }
      return {
        type: 'adjusted_fulfillment_order_item',
        targetType: 'fulfillment_order_item',
        targetId: item.fulfillmentOrderItemId,
        metadata: {
          fulfillmentOrderId: row.fulfillmentOrderId,
          salesOrderLineId,
          skuId: row.skuId,
          qty: item.qty,
          previousCanceledQty: row.previousCanceledQty,
          newCanceledQty: row.newCanceledQty,
          quantityDelta: -qty,
          previousStatus: row.previousStatus,
          newStatus: row.newStatus,
        },
      };
    });
  }

  /**
   * 상자 전 엔진의 출고 수량은 FOI `shipped_qty` 하나다(K6 PR2b P7). FO `shipped`·`shipped_at` 으로 FOI 전량을 출고로 보던
   * 대체는 지웠다 — FO 출고 표시를 쓰는 생산자(V2 발송·직배 완료·셀메이트 스크립트)가 모두 `shipped_qty` 도 채운다.
   * `shipped_qty + canceled_qty <= qty` 는 CHECK 가 지키므로 qty 로 자르지 않는다.
   */
  private shippedEvidenceOf(item: UnboxedDemandItem): {
    quantity: number;
    source: 'fulfillment_order_item_shipped_qty' | 'none';
  } {
    return { quantity: item.shippedQty, source: item.shippedQty > 0 ? 'fulfillment_order_item_shipped_qty' : 'none' };
  }

  private toPostShipmentCancellationEffects(
    salesOrderLineId: string,
    skuId: string,
    requestedFulfillmentQuantity: number,
    affectedShippedQuantity: number,
    items: UnboxedDemandItem[],
    priorPreservedShippedByFulfillmentItem: Map<string, number>,
    handoff: PostShipmentHandoffOptions | undefined,
  ): CancellationEffect[] {
    const effects: CancellationEffect[] = [];
    let remaining = affectedShippedQuantity;

    for (const item of items) {
      if (remaining <= 0) break;
      const shippedEvidence = this.shippedEvidenceOf(item);
      const shippedQty = shippedEvidence.quantity;
      const priorPreservedQty = priorPreservedShippedByFulfillmentItem.get(item.fulfillmentOrderItemId) ?? 0;
      const availableShippedQty = Math.max(0, shippedQty - priorPreservedQty);
      if (availableShippedQty <= 0) continue;

      const preservedQty = Math.min(availableShippedQty, remaining);
      effects.push({
        type: 'preserved_shipped_fulfillment_order_item',
        targetType: 'fulfillment_order_item',
        targetId: item.fulfillmentOrderItemId,
        metadata: {
          fulfillmentOrderId: item.fulfillmentOrderId,
          fulfillmentOrderStatus: item.fulfillmentOrderStatus,
          salesOrderLineId,
          skuId,
          requestedFulfillmentQuantity,
          affectedShippedQuantity: preservedQty,
          currentQty: item.qty,
          currentReservedQty: item.reservedQty || 0,
          pickedQty: item.pickedQty || 0,
          shippedQty: item.shippedQty || 0,
          itemShippedQty: item.shippedQty || 0,
          effectiveShippedQuantity: shippedQty,
          shippedEvidenceSource: shippedEvidence.source,
          previouslyPreservedShippedQuantity: priorPreservedQty,
          reason: 'affected_quantity_already_shipped',
          preservationPolicy: 'do_not_reduce_or_rewrite_shipped_fulfillment_evidence',
        },
      });
      remaining -= preservedQty;
    }

    effects.push(this.toPostShipmentHandoffEffect(salesOrderLineId, skuId, affectedShippedQuantity, handoff));
    return effects;
  }

  private toPostShipmentHandoffEffect(
    salesOrderLineId: string,
    skuId: string,
    affectedShippedQuantity: number,
    handoff: PostShipmentHandoffOptions | undefined,
  ): CancellationEffect {
    const handoffType = handoff?.type ?? 'recovery';
    const targetType = this.toPostShipmentHandoffTargetType(handoffType);
    const externalRef =
      handoff?.externalRef ?? `sales_order_line:${salesOrderLineId}:sku:${skuId}:post_shipment_${handoffType}_handoff`;
    const status = handoff?.status ?? this.defaultPostShipmentHandoffStatus(handoffType);
    const statusKey = this.toPostShipmentHandoffStatusKey(handoffType);
    if (handoff?.id && !UUID_PATTERN.test(handoff.id)) {
      throw new BadRequestException('postShipmentHandoff.id must be a UUID; use externalRef for external workflow IDs');
    }

    return {
      type: `linked_post_shipment_${handoffType}_handoff`,
      targetType,
      targetId: handoff?.id,
      targetExternalRef: externalRef,
      metadata: {
        handoffType,
        owner: this.toPostShipmentHandoffOwner(handoffType),
        [statusKey]: status,
        salesOrderLineId,
        skuId,
        affectedShippedQuantity,
        reason: 'cancellation_affects_shipped_quantity',
        ...(handoff?.metadata ?? {}),
      },
    };
  }

  private toPostShipmentHandoffTargetType(type: PostShipmentHandoffType): string {
    if (type === 'return') return 'return_handoff';
    if (type === 'refund') return 'refund_policy_handoff';
    return `${type}_handoff`;
  }

  private toPostShipmentHandoffOwner(type: PostShipmentHandoffType): string {
    if (type === 'return') return 'logistics';
    if (type === 'refund') return 'wallet';
    if (type === 'compensation') return 'fulfillment';
    return 'operations';
  }

  private defaultPostShipmentHandoffStatus(type: PostShipmentHandoffType): string {
    if (type === 'return') return 'requested';
    return 'pending_policy_decision';
  }

  private toPostShipmentHandoffStatusKey(type: PostShipmentHandoffType): string {
    if (type === 'return') return 'returnStatus';
    if (type === 'refund') return 'refundStatus';
    if (type === 'compensation') return 'compensationStatus';
    return 'recoveryStatus';
  }

  private toWalletRefundEffect(options: CancelSalesOrderOptions): CancellationEffect | null {
    const refund = options.walletRefund;
    if (!refund) {
      return null;
    }
    if (!refund.id && !refund.externalRef) {
      throw new BadRequestException('Wallet refund effect must include id or externalRef');
    }
    return {
      type: 'linked_wallet_refund',
      targetType: 'wallet_refund',
      targetId: refund.id,
      targetExternalRef: refund.externalRef,
      metadata: {
        ...(refund.amount !== undefined ? { amount: refund.amount } : {}),
        ...(refund.currency ? { currency: refund.currency } : {}),
        ...(refund.refundStatus ? { refundStatus: refund.refundStatus } : {}),
        ...(refund.metadata ?? {}),
      },
    };
  }

  private async closeOpenFulfillmentBacklogEffects(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<{ closedCount: number; backlogIds: string[] }> {
    const backlogWithDetails = this.fulfillmentBacklog as FulfillmentOrderCreationBacklogService & {
      closeOpenForSalesOrderDetailed?: (
        salesOrderId: string,
        tx?: DbTx,
      ) => Promise<{ closedCount: number; backlogIds: string[] }>;
    };

    if (typeof backlogWithDetails.closeOpenForSalesOrderDetailed === 'function') {
      return backlogWithDetails.closeOpenForSalesOrderDetailed(salesOrderId, trx);
    }

    const closedCount = await this.fulfillmentBacklog.closeOpenForSalesOrder(salesOrderId, trx);
    return { closedCount, backlogIds: [] };
  }

  private async revokeDigitalOwnershipEffects(
    salesOrderId: string,
    reason: string | null,
    trx: DbTx,
  ): Promise<{ revokedCount: number; ownershipIds: string[] }> {
    if (!this.library) {
      return { revokedCount: 0, ownershipIds: [] };
    }

    const libraryWithDetails = this.library as LibraryService & {
      revokeOwnershipsForOrderDetailed?: (
        salesOrderId: string,
        reason: string | null,
        tx?: DbTx,
      ) => Promise<{ revokedCount: number; ownershipIds: string[] }>;
    };

    if (typeof libraryWithDetails.revokeOwnershipsForOrderDetailed === 'function') {
      return libraryWithDetails.revokeOwnershipsForOrderDetailed(salesOrderId, reason, trx);
    }

    const revokedCount = await this.library.revokeOwnershipsForOrder(salesOrderId, reason, trx);
    return { revokedCount, ownershipIds: [] };
  }

  private async linkCancellationEffects(
    salesOrderId: string,
    cancellationId: string,
    cancellationScope: 'full' | 'partial',
    effects: CancellationEffect[],
    occurredAt: Date,
    trx: DbTx,
  ) {
    const links: BusinessLinkInsert[] = [
      {
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: salesOrderId,
        sourceExternalRef: null,
        targetType: ORDER_CANCELLATION_REF_TYPE,
        targetId: cancellationId,
        targetExternalRef: null,
        relationName: 'opened_cancellation',
        metadata: {
          cancellationScope,
          effectTypes: effects.map((effect) => effect.type),
        },
        occurredAt,
      },
    ];

    for (const effect of effects) {
      if (!effect.targetType || (!effect.targetId && !effect.targetExternalRef)) continue;
      links.push({
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: salesOrderId,
        sourceExternalRef: null,
        targetType: effect.targetType,
        targetId: effect.targetId ?? null,
        targetExternalRef: effect.targetExternalRef ?? null,
        relationName: `cancellation_${effect.type}`,
        metadata: {
          orderCancellationId: cancellationId,
          ...effect.metadata,
          ...(effect.count !== undefined ? { count: effect.count } : {}),
        },
        occurredAt,
      });
    }

    await trx.insert(wmsTables.businessLinks).values(links);
  }

  private assertAcceptedContractIsNotPatched(salesOrder: { salesChannel: string }, dto: SalesOrderPatchInput): void {
    if (!ACCEPTED_CONTRACT_CHANNELS.has(salesOrder.salesChannel)) {
      return;
    }

    const attemptedContractFields = CONTRACT_PATCH_FIELDS.filter((field) => dto[field] !== undefined);
    if (attemptedContractFields.length === 0) {
      return;
    }

    throw new BadRequestException(
      `Accepted SalesOrder contract fields are immutable: ${attemptedContractFields.join(
        ', ',
      )}. Use SalesOrderAmendment or OrderCancellation workflows for post-acceptance changes.`,
    );
  }

  private normalizeBusinessLinkRef(ref: BusinessLinkReferenceDto): BusinessLinkReference {
    return {
      type: ref.type,
      id: ref.id ?? null,
      externalRef: ref.externalRef ?? null,
    };
  }

  private hasBusinessLinkRef(ref: BusinessLinkReference): boolean {
    return Boolean(ref.id || ref.externalRef);
  }

  private referencesSalesOrder(ref: BusinessLinkReference, salesOrderId: string): boolean {
    return ref.type === 'sales_order' && ref.id === salesOrderId;
  }

  private async referencesSalesOrderTimeline(ref: BusinessLinkReference, salesOrderId: string, trx: DbTx) {
    if (this.referencesSalesOrder(ref, salesOrderId)) {
      return true;
    }
    if (!ref.id) {
      return false;
    }

    if (ref.type === ORDER_CANCELLATION_REF_TYPE) {
      const [cancellation] = await trx
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(
          and(
            eq(wmsTables.salesOrderCancellations.id, ref.id),
            eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          ),
        )
        .limit(1);
      return Boolean(cancellation);
    }

    if (ref.type === SALES_ORDER_AMENDMENT_REF_TYPE) {
      const [amendment] = await trx
        .select({ id: wmsTables.salesOrderAmendments.id })
        .from(wmsTables.salesOrderAmendments)
        .where(
          and(
            eq(wmsTables.salesOrderAmendments.id, ref.id),
            eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId),
          ),
        )
        .limit(1);
      return Boolean(amendment);
    }

    if (ref.type === CS_CASE_REF_TYPE) {
      const context = await this.loadBusinessTimelineContext(salesOrderId, trx);
      const lifecycleAnchorFilters = [
        and(
          eq(wmsTables.businessLinks.targetType, SALES_ORDER_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, salesOrderId),
        ),
        and(
          eq(wmsTables.businessLinks.sourceType, SALES_ORDER_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, salesOrderId),
        ),
        ...[...context.cancellationIds].flatMap((cancellationId) => [
          and(
            eq(wmsTables.businessLinks.targetType, ORDER_CANCELLATION_REF_TYPE),
            eq(wmsTables.businessLinks.targetId, cancellationId),
          ),
          and(
            eq(wmsTables.businessLinks.sourceType, ORDER_CANCELLATION_REF_TYPE),
            eq(wmsTables.businessLinks.sourceId, cancellationId),
          ),
        ]),
        ...[...context.amendmentIds].flatMap((amendmentId) => [
          and(
            eq(wmsTables.businessLinks.targetType, SALES_ORDER_AMENDMENT_REF_TYPE),
            eq(wmsTables.businessLinks.targetId, amendmentId),
          ),
          and(
            eq(wmsTables.businessLinks.sourceType, SALES_ORDER_AMENDMENT_REF_TYPE),
            eq(wmsTables.businessLinks.sourceId, amendmentId),
          ),
        ]),
      ].filter((filter): filter is SQL => Boolean(filter));
      const linkedSalesOrderRefs = await trx
        .select({ id: wmsTables.businessLinks.id })
        .from(wmsTables.businessLinks)
        .where(
          and(
            or(
              and(
                eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE),
                eq(wmsTables.businessLinks.sourceId, ref.id),
              ),
              and(
                eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE),
                eq(wmsTables.businessLinks.targetId, ref.id),
              ),
            ),
            or(...lifecycleAnchorFilters),
          ),
        )
        .limit(1);
      return linkedSalesOrderRefs.length > 0;
    }

    return false;
  }

  private async loadBusinessTimelineContext(
    salesOrderId: string,
    db: DbTx | WmsDb,
  ): Promise<SalesOrderTimelineContext> {
    const [cancellations, amendments] = await Promise.all([
      db
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId)),
      db
        .select({ id: wmsTables.salesOrderAmendments.id })
        .from(wmsTables.salesOrderAmendments)
        .where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId)),
    ]);

    return {
      salesOrderId,
      cancellationIds: new Set(cancellations.map((row) => row.id)),
      amendmentIds: new Set(amendments.map((row) => row.id)),
      csCaseIds: new Set(),
    };
  }

  private async loadBusinessTimelineLinks(salesOrderId: string, db: DbTx | WmsDb) {
    const context = await this.loadBusinessTimelineContext(salesOrderId, db);
    const anchorFilters: SQL[] = [
      and(
        eq(wmsTables.businessLinks.sourceType, SALES_ORDER_REF_TYPE),
        eq(wmsTables.businessLinks.sourceId, salesOrderId),
      )!,
      and(
        eq(wmsTables.businessLinks.targetType, SALES_ORDER_REF_TYPE),
        eq(wmsTables.businessLinks.targetId, salesOrderId),
      )!,
    ];

    for (const cancellationId of context.cancellationIds) {
      anchorFilters.push(
        and(
          eq(wmsTables.businessLinks.sourceType, ORDER_CANCELLATION_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, cancellationId),
        )!,
        and(
          eq(wmsTables.businessLinks.targetType, ORDER_CANCELLATION_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, cancellationId),
        )!,
      );
    }

    for (const amendmentId of context.amendmentIds) {
      anchorFilters.push(
        and(
          eq(wmsTables.businessLinks.sourceType, SALES_ORDER_AMENDMENT_REF_TYPE),
          eq(wmsTables.businessLinks.sourceId, amendmentId),
        )!,
        and(
          eq(wmsTables.businessLinks.targetType, SALES_ORDER_AMENDMENT_REF_TYPE),
          eq(wmsTables.businessLinks.targetId, amendmentId),
        )!,
      );
    }

    const directLinks = await db
      .select()
      .from(wmsTables.businessLinks)
      .where(or(...anchorFilters));

    for (const link of directLinks) {
      this.collectTimelineCsCaseId(context, link.sourceType, link.sourceId);
      this.collectTimelineCsCaseId(context, link.targetType, link.targetId);
    }

    if (context.csCaseIds.size === 0) {
      return { links: directLinks, context };
    }

    const csCaseFilters: SQL[] = [];
    for (const csCaseId of context.csCaseIds) {
      csCaseFilters.push(
        and(eq(wmsTables.businessLinks.sourceType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.sourceId, csCaseId))!,
        and(eq(wmsTables.businessLinks.targetType, CS_CASE_REF_TYPE), eq(wmsTables.businessLinks.targetId, csCaseId))!,
      );
    }
    const csCaseLinks = await db
      .select()
      .from(wmsTables.businessLinks)
      .where(or(...csCaseFilters));

    const linksById = new Map<string, BusinessLinkRow>();
    for (const link of [...directLinks, ...csCaseLinks]) {
      linksById.set(link.id, link);
    }

    return { links: [...linksById.values()], context };
  }

  private collectTimelineCsCaseId(context: SalesOrderTimelineContext, type: string, id: string | null) {
    if (type === CS_CASE_REF_TYPE && id) {
      context.csCaseIds.add(id);
    }
  }

  private toBusinessTimeline(context: SalesOrderTimelineContext, links: BusinessLinkRow[]) {
    return links
      .map((link) => this.toBusinessTimelineItem(context, link))
      .sort((a, b) => {
        const occurred = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (occurred !== 0) return occurred;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
  }

  private toBusinessTimelineItem(context: SalesOrderTimelineContext, link: BusinessLinkRow) {
    const source = this.toBusinessLinkRef(link.sourceType, link.sourceId, link.sourceExternalRef);
    const target = this.toBusinessLinkRef(link.targetType, link.targetId, link.targetExternalRef);
    const direction =
      this.referencesSalesOrder(source, context.salesOrderId) ||
      (!this.referencesSalesOrder(target, context.salesOrderId) && this.isTimelineAnchorRef(source, context))
        ? 'outbound'
        : 'inbound';
    const linkedEntity = direction === 'outbound' ? target : source;

    return {
      id: link.id,
      relationName: link.relationName,
      direction,
      source,
      target,
      linkedEntity,
      metadata: (link.metadata ?? {}) as Record<string, unknown>,
      effectStatus: this.toTimelineEffectStatus(linkedEntity, (link.metadata ?? {}) as Record<string, unknown>),
      occurredAt: link.occurredAt,
      createdAt: link.createdAt,
    };
  }

  private isTimelineAnchorRef(ref: BusinessLinkReference, context: SalesOrderTimelineContext): boolean {
    if (this.referencesSalesOrder(ref, context.salesOrderId)) {
      return true;
    }
    if (!ref.id) {
      return false;
    }
    if (ref.type === ORDER_CANCELLATION_REF_TYPE) {
      return context.cancellationIds.has(ref.id);
    }
    if (ref.type === SALES_ORDER_AMENDMENT_REF_TYPE) {
      return context.amendmentIds.has(ref.id);
    }
    if (ref.type === CS_CASE_REF_TYPE) {
      return context.csCaseIds.has(ref.id);
    }
    return false;
  }

  private toTimelineEffectStatus(
    linkedEntity: BusinessLinkReference,
    metadata: Record<string, unknown>,
  ): TimelineEffectStatus | null {
    if (WALLET_EFFECT_REF_TYPES.has(linkedEntity.type)) {
      const value = metadata.walletStatus ?? metadata.refundStatus ?? metadata.paymentStatus ?? metadata.status;
      return typeof value === 'string' && value.length > 0 ? { owner: 'wallet', value } : null;
    }

    if (LOGISTICS_EFFECT_REF_TYPES.has(linkedEntity.type)) {
      const value = metadata.logisticsStatus ?? metadata.returnStatus ?? metadata.status;
      return typeof value === 'string' && value.length > 0 ? { owner: 'logistics', value } : null;
    }

    if (OPERATIONS_EFFECT_REF_TYPES.has(linkedEntity.type)) {
      const value = metadata.recoveryStatus ?? metadata.refundStatus ?? metadata.compensationStatus ?? metadata.status;
      const owner = typeof metadata.owner === 'string' && metadata.owner.length > 0 ? metadata.owner : 'operations';
      return typeof value === 'string' && value.length > 0 ? { owner, value } : null;
    }

    return null;
  }

  private toBusinessLinkRef(type: string, id: string | null, externalRef: string | null): BusinessLinkReference {
    return { type, id, externalRef };
  }

  private convertShippingAddress(address: ShippingAddress): AddressDto {
    return {
      recipientName: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      roadAddress: address.roadAddress,
      detailAddress: address.detailAddress,
      deliveryNote: address.deliveryNote,
      personalCustomsCode: address.personalCustomsCode,
    };
  }

  private convertOrderItems(items: OrderItem[]) {
    return items.map((item) => ({
      channelOrderItemId: item.orderItemId,
      channelProductId: item.channelProductId,
      variantId: item.variantId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      fulfillmentKind: item.fulfillmentKind,
      requiresShipping: item.requiresShipping,
      almondDesignId: item.almondDesignId,
    }));
  }

  private assertUniqueTrustedChannelOrderItemIds(
    salesChannel: string,
    lines: Array<{ channelOrderItemId?: string }>,
  ): void {
    if (!ACCEPTED_CONTRACT_CHANNELS.has(salesChannel)) {
      return;
    }

    const seen = new Set<string>();
    for (const line of lines) {
      const orderItemId = line.channelOrderItemId?.trim();
      if (!orderItemId) {
        continue;
      }
      if (seen.has(orderItemId)) {
        throw new BadRequestException(`Duplicate channel order item ID in ${salesChannel} order: ${orderItemId}`);
      }
      seen.add(orderItemId);
    }
  }
}
