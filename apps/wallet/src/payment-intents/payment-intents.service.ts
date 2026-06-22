import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import {
  WalletSchema,
  paymentIntents,
  paymentIntentItems,
  paymentIntentItemDiscounts,
  paymentIntentOrderDiscounts,
} from '../schema';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { buildOutboxInsertValues } from '../messaging/outbox-event.util';
import { outboxEvents } from '../schema';
import { CreatePaymentIntentDto, ConfirmPaymentIntentDto, TossApproveDto } from './dto';
import { calculatePricing } from './intent-pricing';
import { ConfirmService } from './confirm.service';
import { CaptureService } from './capture.service';
import { CancelService } from './cancel.service';
import { AbandonService } from './abandon.service';
import { TossApproveService } from './toss-approve.service';

const DEFAULT_INTENT_EXPIRY_MINUTES = 60 * 24; // 24 hours

export const CANCELABLE_INTENT_STATUSES = [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
  'AUTHORIZED',
  'SUCCEEDED',
] as const;

@Injectable()
export class PaymentIntentsService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly stateTransitionService: StateTransitionService,
    private readonly confirmService: ConfirmService,
    private readonly captureService: CaptureService,
    private readonly cancelService: CancelService,
    private readonly abandonService: AbandonService,
    private readonly tossApproveService: TossApproveService,
  ) {}

  async create(dto: CreatePaymentIntentDto): Promise<typeof paymentIntents.$inferSelect> {
    // Resolve payable_amount
    let payableAmount: number;
    let pricing: ReturnType<typeof calculatePricing> | null = null;

    if (dto.items && dto.items.length > 0) {
      pricing = calculatePricing(dto.items, dto.orderDiscounts ?? []);
      payableAmount = pricing.payableAmount;

      if (dto.amount !== undefined && dto.amount !== payableAmount) {
        throw new BadRequestException({
          error: 'AMOUNT_MISMATCH',
          message: `Provided amount (${dto.amount}) does not match calculated payable amount (${payableAmount})`,
        });
      }
    } else {
      if (dto.amount === undefined) {
        throw new BadRequestException({
          error: 'AMOUNT_REQUIRED',
          message: 'Either amount or items must be provided',
        });
      }
      payableAmount = dto.amount;
    }

    const clientSecret = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + DEFAULT_INTENT_EXPIRY_MINUTES * 60 * 1000);
    const now = new Date().toISOString();

    return this.dbService.db.transaction(async (tx) => {
      const insertedIntents = await tx
        .insert(paymentIntents)
        .values({
          payableAmount,
          currency: dto.currency.toUpperCase(),
          status: 'CREATED',
          userId: dto.userId ?? null,
          clientSecret,
          returnUrl: dto.returnUrl ?? null,
          metadata: dto.metadata ?? {},
          expiresAt,
          version: 0,
        })
        .returning();

      const intent = insertedIntents[0];
      if (!intent) throw new Error('PAYMENT_INTENT_INSERT_FAILED');

      // Insert items and discounts if provided
      if (pricing) {
        for (const item of pricing.items) {
          const insertedItems = await tx
            .insert(paymentIntentItems)
            .values({
              intentId: intent.id,
              lineId: item.lineId,
              name: item.name,
              itemType: item.itemType ?? null,
              itemRefId: item.itemRefId ?? null,
              unitPrice: item.unitPrice,
              quantity: item.quantity,
              baseAmount: item.baseAmount,
              itemDiscountPerUnitTotal: item.itemDiscountPerUnitTotal,
              itemDiscountFlatTotal: item.itemDiscountFlatTotal,
              payableAmount: item.payableAmount,
              metadata: {},
            })
            .returning();

          const intentItem = insertedItems[0];
          if (!intentItem) continue;

          for (const discount of item.discounts) {
            await tx.insert(paymentIntentItemDiscounts).values({
              intentId: intent.id,
              itemId: intentItem.id,
              discountRefId: discount.discountRefId ?? null,
              kind: discount.kind,
              amount: discount.amount,
              name: discount.name ?? null,
              metadata: {},
            });
          }
        }

        if (dto.orderDiscounts) {
          for (const discount of dto.orderDiscounts) {
            await tx.insert(paymentIntentOrderDiscounts).values({
              intentId: intent.id,
              discountRefId: discount.discountRefId ?? null,
              kind: 'ORDER',
              amount: discount.amount,
              name: discount.name ?? null,
              metadata: {},
            });
          }
        }
      }

      // Write outbox event
      await tx.insert(outboxEvents).values(
        buildOutboxInsertValues({
          eventType: GatewayEventType.INTENT_CREATED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intent.id,
          payload: buildPaymentIntentEventPayload({
            intentId: intent.id,
            userId: intent.userId ?? '',
            status: 'CREATED',
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
            extra: {
              medusa_session_id: intent.metadata?.medusa_session_id,
            },
          }),
        }),
      );

      return intent;
    });
  }

  // userId가 null인 intent를 jwtUserId로 원자적으로 claim한다.
  // 다른 요청이 먼저 claim했으면 null 반환 — 호출자가 다시 읽어서 소유권 체크.
  async claimIntent(id: string, userId: string): Promise<typeof paymentIntents.$inferSelect | null> {
    const rows = await this.dbService.db
      .update(paymentIntents)
      .set({ userId, updatedAt: new Date() })
      .where(and(eq(paymentIntents.id, id), isNull(paymentIntents.userId)))
      .returning();
    return rows[0] ?? null;
  }

  async findById(id: string) {
    const rows = await this.dbService.db.select().from(paymentIntents).where(eq(paymentIntents.id, id)).limit(1);
    const intent = rows[0] ?? null;
    if (!intent) return null;

    const [items, itemDiscounts, orderDiscounts] = await Promise.all([
      this.dbService.db.select().from(paymentIntentItems).where(eq(paymentIntentItems.intentId, id)),
      this.dbService.db.select().from(paymentIntentItemDiscounts).where(eq(paymentIntentItemDiscounts.intentId, id)),
      this.dbService.db.select().from(paymentIntentOrderDiscounts).where(eq(paymentIntentOrderDiscounts.intentId, id)),
    ]);

    const discountsByItemId = new Map<string, (typeof paymentIntentItemDiscounts.$inferSelect)[]>();
    for (const d of itemDiscounts) {
      const list = discountsByItemId.get(d.itemId) ?? [];
      list.push(d);
      discountsByItemId.set(d.itemId, list);
    }

    return {
      ...intent,
      items: items.map((item) => ({
        ...item,
        discounts: discountsByItemId.get(item.id) ?? [],
      })),
      orderDiscounts,
    };
  }

  async findByIdOrThrow(id: string): Promise<typeof paymentIntents.$inferSelect> {
    const intent = await this.findById(id);
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${id}`,
      });
    }
    return intent;
  }

  async confirm(intentId: string, dto: ConfirmPaymentIntentDto): Promise<{ nextAction?: Record<string, unknown> }> {
    await this.findByIdOrThrow(intentId);
    const correlationId = `confirm:${intentId}:${Date.now()}`;
    return this.confirmService.confirm(
      intentId,
      { paymentMethodId: dto.paymentMethodId, pointsToApply: dto.pointsToApply },
      correlationId,
    );
  }

  async tossApprove(intentId: string, dto: TossApproveDto): Promise<void> {
    await this.findByIdOrThrow(intentId);
    const correlationId = `toss-approve:${intentId}:${Date.now()}`;
    await this.tossApproveService.approve(intentId, dto.paymentKey, dto.orderId, dto.amount, correlationId);
  }

  async capture(intentId: string): Promise<void> {
    const intent = await this.findByIdOrThrow(intentId);

    // 이미 캡처된 경우 멱등적 처리 (no-op)
    // wallet auto-capture와 Medusa cart.complete()의 capturePaymentWorkflow가 동시에 실행될 수 있음
    if (intent.status === 'CAPTURED') {
      return;
    }

    if (!['AUTHORIZED', 'SUCCEEDED'].includes(intent.status)) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CAPTURABLE',
        message: `Intent cannot be captured in status: ${intent.status}`,
      });
    }
    const correlationId = `capture:${intentId}:${Date.now()}`;
    await this.captureService.capture(intentId, correlationId);
  }

  async cancel(intentId: string): Promise<void> {
    const intent = await this.findByIdOrThrow(intentId);

    // 이미 취소된 경우 멱등적 처리 (no-op)
    if (intent.status === 'CANCELED') {
      return;
    }

    if (!(CANCELABLE_INTENT_STATUSES as readonly string[]).includes(intent.status)) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CANCELABLE',
        message: `Intent cannot be canceled in status: ${intent.status}`,
      });
    }

    const correlationId = `cancel:${intentId}:${Date.now()}`;
    await this.cancelService.cancel(intent, correlationId);
  }

  /**
   * Soft-resets an abandoned in-flight checkout action (closed/failed Toss
   * checkout, expired payment screen). Releases provider-side holds and returns
   * the intent to CREATED so Medusa can reuse it. No-op once finalised.
   */
  async abandon(intentId: string): Promise<{ status: string }> {
    await this.findByIdOrThrow(intentId);
    const correlationId = `abandon:${intentId}:${Date.now()}`;
    return this.abandonService.abandon(intentId, correlationId);
  }
}
