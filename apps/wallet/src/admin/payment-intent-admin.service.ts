import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import {
  PaymentIntentStatus,
  WalletSchema,
  charges,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentMethods,
  paymentStateTransitions,
  refunds,
} from '../schema';
import {
  AdminPaymentIntentListQueryDto,
  AdminPaymentIntentListItemDto,
  AdminPaymentIntentDetailResponseDto,
  AdminChargeResponseDto,
  AdminPaymentMethodSummaryDto,
} from './dto/admin-payment-intent.dto';
import { AdminRefundListQueryDto } from './dto/admin-refund.dto';
import { StateTransitionResponseDto } from './dto/state-transition.dto';
import { RefundResponseDto } from '../refunds/dto';
import {
  PaymentIntentItemResponseDto,
  ItemDiscountResponseDto,
  OrderDiscountResponseDto,
} from '../payment-intents/dto';

@Injectable()
export class PaymentIntentAdminService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async listPaymentIntents(
    query: AdminPaymentIntentListQueryDto,
  ): Promise<PaginatedResponseDto<AdminPaymentIntentListItemDto>> {
    const db = this.dbService.db;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = this.buildIntentConditions(query);

    const countQuery = db.select({ value: count() }).from(paymentIntents);

    if (query.paymentMethodType) {
      countQuery.leftJoin(paymentMethods, eq(paymentMethods.id, paymentIntents.paymentMethodId));
    }

    const [countResult] = await countQuery.where(and(...conditions));

    const total = countResult?.value ?? 0;

    const sortColumn = query.sort === 'payableAmount' ? paymentIntents.payableAmount : paymentIntents.createdAt;
    const orderFn = query.order === 'asc' ? asc : desc;

    const rows = await db
      .select({
        id: paymentIntents.id,
        payableAmount: paymentIntents.payableAmount,
        currency: paymentIntents.currency,
        status: paymentIntents.status,
        userId: paymentIntents.userId,
        createdAt: paymentIntents.createdAt,
        paymentMethodType: paymentMethods.type,
      })
      .from(paymentIntents)
      .leftJoin(paymentMethods, eq(paymentMethods.id, paymentIntents.paymentMethodId))
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);

    const data: AdminPaymentIntentListItemDto[] = rows.map((r) => ({
      id: r.id,
      payableAmount: r.payableAmount,
      currency: r.currency,
      status: r.status,
      userId: r.userId,
      paymentMethodType: r.paymentMethodType ?? null,
      createdAt: r.createdAt,
    }));

    return { data, total, page, limit };
  }

  async getPaymentIntentDetail(id: string): Promise<AdminPaymentIntentDetailResponseDto> {
    const db = this.dbService.db;

    const [intent] = await db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).limit(1);

    if (!intent) {
      throw new Error('Payment intent not found');
    }

    // Items + item discounts
    const itemRows = await db
      .select()
      .from(paymentIntentItems)
      .where(eq(paymentIntentItems.intentId, id))
      .orderBy(asc(paymentIntentItems.createdAt));

    const itemDiscountRows = await db
      .select()
      .from(paymentIntentItemDiscounts)
      .where(eq(paymentIntentItemDiscounts.intentId, id));

    const discountsByItem = new Map<string, ItemDiscountResponseDto[]>();
    for (const d of itemDiscountRows) {
      const list = discountsByItem.get(d.itemId) ?? [];
      list.push({
        id: d.id,
        kind: d.kind,
        amount: d.amount,
        name: d.name ?? null,
        discountRefId: d.discountRefId ?? null,
      });
      discountsByItem.set(d.itemId, list);
    }

    const items: PaymentIntentItemResponseDto[] = itemRows.map((item) => ({
      id: item.id,
      lineId: item.lineId,
      name: item.name,
      itemType: item.itemType ?? null,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      baseAmount: item.baseAmount,
      itemDiscountPerUnitTotal: item.itemDiscountPerUnitTotal,
      itemDiscountFlatTotal: item.itemDiscountFlatTotal,
      payableAmount: item.payableAmount,
      discounts: discountsByItem.get(item.id) ?? [],
    }));

    // Order discounts
    const orderDiscountRows = await db
      .select()
      .from(paymentIntentOrderDiscounts)
      .where(eq(paymentIntentOrderDiscounts.intentId, id));

    const orderDiscounts: OrderDiscountResponseDto[] = orderDiscountRows.map((d) => ({
      id: d.id,
      kind: d.kind,
      amount: d.amount,
      name: d.name ?? null,
      discountRefId: d.discountRefId ?? null,
    }));

    // Charges
    const chargeRows = await db.select().from(charges).where(eq(charges.intentId, id)).orderBy(asc(charges.createdAt));

    const chargeData: AdminChargeResponseDto[] = chargeRows.map((c) => ({
      id: c.id,
      intentId: c.intentId,
      paymentMethodId: c.paymentMethodId,
      amount: c.amount,
      currency: c.currency,
      operation: c.operation,
      status: c.status,
      providerTransactionId: c.providerTransactionId ?? null,
      errorCode: c.errorCode ?? null,
      errorMessage: c.errorMessage ?? null,
      createdAt: c.createdAt,
    }));

    // Refunds (charge → payment_method join으로 manualConfirmable 계산)
    const refundRows = await db
      .select({
        id: refunds.id,
        chargeId: refunds.chargeId,
        intentId: refunds.intentId,
        status: refunds.status,
        amount: refunds.amount,
        currency: refunds.currency,
        reasonCode: refunds.reasonCode,
        reasonMessage: refunds.reasonMessage,
        createdAt: refunds.createdAt,
        paymentMethodType: paymentMethods.type,
      })
      .from(refunds)
      .leftJoin(charges, eq(refunds.chargeId, charges.id))
      .leftJoin(paymentMethods, eq(charges.paymentMethodId, paymentMethods.id))
      .where(eq(refunds.intentId, id))
      .orderBy(asc(refunds.createdAt));

    const refundData: RefundResponseDto[] = refundRows.map((r) => ({
      id: r.id,
      chargeId: r.chargeId,
      intentId: r.intentId,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      reasonCode: r.reasonCode ?? null,
      reasonMessage: r.reasonMessage ?? null,
      createdAt: r.createdAt,
      manualConfirmable: r.status === 'PENDING' && r.paymentMethodType === 'BANK_TRANSFER',
    }));

    // Payment method
    let paymentMethod: AdminPaymentMethodSummaryDto | null = null;
    if (intent.paymentMethodId) {
      const [pm] = await db
        .select({
          id: paymentMethods.id,
          userId: paymentMethods.userId,
          type: paymentMethods.type,
          displayName: paymentMethods.displayName,
          createdAt: paymentMethods.createdAt,
        })
        .from(paymentMethods)
        .where(eq(paymentMethods.id, intent.paymentMethodId))
        .limit(1);

      if (pm) {
        paymentMethod = {
          id: pm.id,
          userId: pm.userId,
          type: pm.type,
          displayName: pm.displayName ?? null,
          createdAt: pm.createdAt,
        };
      }
    }

    return {
      id: intent.id,
      payableAmount: intent.payableAmount,
      currency: intent.currency,
      status: intent.status,
      userId: intent.userId,
      paymentMethodId: intent.paymentMethodId,
      clientSecret: intent.clientSecret,
      returnUrl: intent.returnUrl,
      metadata: intent.metadata,
      expiresAt: intent.expiresAt,
      createdAt: intent.createdAt,
      updatedAt: intent.updatedAt,
      items,
      orderDiscounts,
      charges: chargeData,
      refunds: refundData,
      paymentMethod,
    };
  }

  async listRefunds(query: AdminRefundListQueryDto): Promise<PaginatedResponseDto<RefundResponseDto>> {
    const db = this.dbService.db;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions = this.buildRefundConditions(query);

    const [countResult] = await db
      .select({ value: count() })
      .from(refunds)
      .where(and(...conditions));

    const total = countResult?.value ?? 0;

    const rows = await db
      .select()
      .from(refunds)
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt))
      .limit(limit)
      .offset(offset);

    const data: RefundResponseDto[] = rows.map((r) => ({
      id: r.id,
      chargeId: r.chargeId,
      intentId: r.intentId,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      reasonCode: r.reasonCode ?? null,
      reasonMessage: r.reasonMessage ?? null,
      createdAt: r.createdAt,
      manualConfirmable: false, // 목록 조회는 charge join 없이 조회 — 상세에서만 정확한 값 제공
    }));

    return { data, total, page, limit };
  }

  async getStateTransitions(intentId: string): Promise<StateTransitionResponseDto[]> {
    const db = this.dbService.db;

    // Verify intent exists
    const [intent] = await db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    if (!intent) {
      throw new Error('Payment intent not found');
    }

    // Get charge IDs and refund IDs for this intent
    const chargeRows = await db.select({ id: charges.id }).from(charges).where(eq(charges.intentId, intentId));

    const refundRows = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.intentId, intentId));

    const chargeIds = chargeRows.map((c) => c.id);
    const refundIds = refundRows.map((r) => r.id);

    // Build entity conditions for state transitions
    const entityConditions = [
      and(eq(paymentStateTransitions.entityType, 'INTENT'), eq(paymentStateTransitions.entityId, intentId)),
    ];

    if (chargeIds.length > 0) {
      entityConditions.push(
        and(eq(paymentStateTransitions.entityType, 'CHARGE'), inArray(paymentStateTransitions.entityId, chargeIds)),
      );
    }

    if (refundIds.length > 0) {
      entityConditions.push(
        and(eq(paymentStateTransitions.entityType, 'REFUND'), inArray(paymentStateTransitions.entityId, refundIds)),
      );
    }

    const rows = await db
      .select({
        id: paymentStateTransitions.id,
        entityType: paymentStateTransitions.entityType,
        entityId: paymentStateTransitions.entityId,
        previousStatus: paymentStateTransitions.previousStatus,
        newStatus: paymentStateTransitions.newStatus,
        triggeredByType: paymentStateTransitions.triggeredByType,
        triggeredById: paymentStateTransitions.triggeredById,
        correlationId: paymentStateTransitions.correlationId,
        occurredAt: paymentStateTransitions.occurredAt,
      })
      .from(paymentStateTransitions)
      .where(
        sql`(${sql.join(
          entityConditions.map((c) => sql`(${c})`),
          sql` OR `,
        )})`,
      )
      .orderBy(asc(paymentStateTransitions.occurredAt));

    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      previousStatus: r.previousStatus,
      newStatus: r.newStatus,
      triggeredByType: r.triggeredByType,
      triggeredById: r.triggeredById ?? null,
      correlationId: r.correlationId,
      occurredAt: r.occurredAt,
    }));
  }

  async resolvePartiallyCapture(
    intentId: string,
    action: 'CAPTURED' | 'CANCELED',
    reason?: string,
  ): Promise<void> {
    const db = this.dbService.db;

    const [intent] = await db
      .select({ id: paymentIntents.id, status: paymentIntents.status, userId: paymentIntents.userId, payableAmount: paymentIntents.payableAmount, currency: paymentIntents.currency })
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    if (!intent) {
      throw new Error('Payment intent not found');
    }

    if (intent.status !== 'PARTIALLY_CAPTURED') {
      throw new Error(`Invalid status: intent must be PARTIALLY_CAPTURED, got ${intent.status}`);
    }

    const correlationId = `admin:resolve:${intentId}:${Date.now()}`;
    const now = new Date().toISOString();

    const eventType = action === 'CAPTURED' ? GatewayEventType.INTENT_CAPTURED : GatewayEventType.INTENT_CANCELED;

    await this.stateTransitionService.transitionIntent(
      intentId,
      action,
      {
        correlationId,
        reasonCode: action === 'CAPTURED' ? 'ADMIN_MANUAL_CAPTURE' : 'ADMIN_MANUAL_CANCEL',
        reasonMessage: reason ?? `Admin manual resolution: ${action}`,
        triggeredByType: 'ADMIN',
        outboxEvent: {
          eventType,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId: intent.userId ?? '',
            status: action,
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
          }),
        },
      },
      'PARTIALLY_CAPTURED',
    );
  }

  private buildIntentConditions(query: AdminPaymentIntentListQueryDto) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (query.status && query.status.length > 0) {
      conditions.push(inArray(paymentIntents.status, query.status as PaymentIntentStatus[]));
    }

    if (query.userId) {
      conditions.push(eq(paymentIntents.userId, query.userId));
    }

    if (query.paymentMethodType) {
      conditions.push(eq(paymentMethods.type, query.paymentMethodType as any));
    }

    if (query.dateFrom) {
      conditions.push(gte(paymentIntents.createdAt, new Date(query.dateFrom)));
    }

    if (query.dateTo) {
      conditions.push(lte(paymentIntents.createdAt, new Date(query.dateTo)));
    }

    return conditions;
  }

  private buildRefundConditions(query: AdminRefundListQueryDto) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (query.status) {
      conditions.push(eq(refunds.status, query.status as any));
    }

    if (query.intentId) {
      conditions.push(eq(refunds.intentId, query.intentId));
    }

    if (query.dateFrom) {
      conditions.push(gte(refunds.createdAt, new Date(query.dateFrom)));
    }

    if (query.dateTo) {
      conditions.push(lte(refunds.createdAt, new Date(query.dateTo)));
    }

    return conditions;
  }
}
