import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
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
import { CreatePaymentIntentDto, ConfirmPaymentIntentDto } from './dto';
import { calculatePricing } from './intent-pricing';
import { ConfirmService } from './confirm.service';
import { CaptureService } from './capture.service';

const DEFAULT_INTENT_EXPIRY_MINUTES = 30;

@Injectable()
export class PaymentIntentsService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly stateTransitionService: StateTransitionService,
    private readonly confirmService: ConfirmService,
    private readonly captureService: CaptureService,
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
    const expiresAt = new Date(
      Date.now() + DEFAULT_INTENT_EXPIRY_MINUTES * 60 * 1000,
    );
    const now = new Date().toISOString();

    return this.dbService.db.transaction(async (tx) => {
      const insertedIntents = await tx
        .insert(paymentIntents)
        .values({
          payableAmount,
          currency: dto.currency.toUpperCase(),
          status: 'CREATED',
          userId: dto.userId,
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
            userId: intent.userId,
            status: 'CREATED',
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
          }),
        }),
      );

      return intent;
    });
  }

  async findById(id: string): Promise<typeof paymentIntents.$inferSelect | null> {
    const rows = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, id))
      .limit(1);
    return rows[0] ?? null;
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

  async confirm(intentId: string, dto: ConfirmPaymentIntentDto): Promise<void> {
    await this.findByIdOrThrow(intentId);
    const correlationId = `confirm:${intentId}:${Date.now()}`;
    await this.confirmService.confirm(intentId, dto.paymentMethodId, correlationId);
  }

  async capture(intentId: string): Promise<void> {
    await this.findByIdOrThrow(intentId);
    const correlationId = `capture:${intentId}:${Date.now()}`;
    await this.captureService.capture(intentId, correlationId);
  }

  async cancel(intentId: string): Promise<void> {
    const intent = await this.findByIdOrThrow(intentId);

    const cancelableStatuses = ['CREATED', 'PROCESSING', 'REQUIRES_ACTION'];
    if (!cancelableStatuses.includes(intent.status)) {
      throw new BadRequestException({
        error: 'INTENT_NOT_CANCELABLE',
        message: `Intent cannot be canceled in status: ${intent.status}`,
      });
    }

    const now = new Date().toISOString();

    await this.stateTransitionService.transitionIntent(
      intentId,
      'CANCELED',
      {
        correlationId: `cancel:${intentId}:${Date.now()}`,
        triggeredByType: 'USER',
        reasonCode: 'USER_CANCELED',
        outboxEvent: {
          eventType: GatewayEventType.INTENT_CANCELED,
          aggregateType: GATEWAY_AGGREGATE_TYPE,
          aggregateId: intentId,
          payload: buildPaymentIntentEventPayload({
            intentId,
            userId: intent.userId,
            status: 'CANCELED',
            payableAmount: intent.payableAmount,
            currency: intent.currency,
            occurredAt: now,
          }),
        },
      },
    );
  }
}
