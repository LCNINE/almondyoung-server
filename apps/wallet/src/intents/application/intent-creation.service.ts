import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { ConfigureLegsDto } from '../dto/configure-legs.dto';
import { CreateIntentDto } from '../dto/create-intent.dto';
import {
  HmacVerificationError,
  verifyHmacIntegrity,
} from '../../domain/hmac/hmac-integrity';
import {
  PaymentIntentStatus,
  PaymentIntentItemDiscountKind,
  PaymentIntentOrderDiscountKind,
  PaymentLegStatus,
  PaymentReferenceType,
  WalletSchema,
  outboxEvents,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
} from '../../schema';
import { DbTx, PaymentIntent, PaymentLeg } from '../../types';
import { ProviderRegistry } from '../../providers/provider.registry';
import { buildOutboxInsertValues } from '../../messaging/outbox-event.util';
import { buildPaymentIntentEventPayload } from '../../messaging/payments-event.builder';
import {
  IntentPricingResult,
  IntentSnapshotValidationError,
  calculateIntentPricing,
  parseIntentSnapshotPayload,
} from './intent-pricing';

interface OutboxEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey?: string;
  payload: Record<string, unknown>;
}

interface PaymentIntentEventSource {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  userId: string;
  payableAmount: number;
  currency: string;
}

@Injectable()
export class IntentCreationService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  async createIntent(
    dto: CreateIntentDto,
    correlationId?: string,
  ): Promise<PaymentIntent> {
    const sharedSecret = process.env.WALLET_HMAC_SHARED_SECRET ?? '';
    const normalizedSnapshotPayload = normalizeSnapshotPayload(dto.snapshotPayload);
    let payloadHash = '';
    let pricingResult: IntentPricingResult;

    try {
      const verifyResult = verifyHmacIntegrity(
        {
          snapshotPayload: normalizedSnapshotPayload,
          signature: dto.signature,
          signatureVersion: dto.signatureVersion,
          signedAt: dto.signedAt,
        },
        {
          sharedSecret,
        },
      );
      payloadHash = verifyResult.payloadHash;
    } catch (error) {
      if (error instanceof HmacVerificationError) {
        throw new BadRequestException({
          error: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    try {
      const parsedSnapshot = parseIntentSnapshotPayload(normalizedSnapshotPayload);
      pricingResult = calculateIntentPricing(parsedSnapshot);
    } catch (error) {
      if (error instanceof IntentSnapshotValidationError) {
        throw new BadRequestException({
          error: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    if (pricingResult.intentPayable !== dto.payableAmount) {
      throw new BadRequestException({
        error: 'PAYABLE_AMOUNT_MISMATCH',
        message: `Declared payableAmount does not match calculated amount: declared=${dto.payableAmount}, calculated=${pricingResult.intentPayable}`,
      });
    }

    const initialStatus: PaymentIntentStatus =
      pricingResult.intentPayable === 0 ? 'SUCCEEDED' : 'PENDING';
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    try {
      return await this.dbService.db.transaction(async (tx) => {
        await this.lockIntentCreationReference(
          tx,
          dto.referenceType,
          dto.referenceId,
        );

        const existingSucceeded = await tx
          .select({ id: paymentIntents.id })
          .from(paymentIntents)
          .where(
            and(
              eq(paymentIntents.referenceType, dto.referenceType),
              eq(paymentIntents.referenceId, dto.referenceId),
              eq(paymentIntents.status, 'SUCCEEDED'),
            ),
          )
          .limit(1);

        if (existingSucceeded.length > 0) {
          throw new ConflictException({
            error: 'REFERENCE_ALREADY_PAID',
            message: 'The same reference is already paid',
          });
        }

        const [createdIntent] = await tx
          .insert(paymentIntents)
          .values({
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            userId: dto.userId,
            currency: dto.currency.toUpperCase(),
            payableAmount: pricingResult.intentPayable,
            status: initialStatus,
            expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            metadata: {
              ...(dto.metadata ?? {}),
              snapshotPayload: normalizedSnapshotPayload,
              signatureVersion: dto.signatureVersion,
              signedAt: dto.signedAt,
              payloadHash,
            },
          })
          .returning();

        await this.persistIntentPricingSnapshot(
          tx,
          createdIntent.id,
          pricingResult,
        );

        await tx.insert(paymentStateTransitions).values({
          entityType: 'INTENT',
          entityId: createdIntent.id,
          previousStatus: null,
          newStatus: initialStatus,
          reasonCode: 'INTENT_CREATED',
          reasonMessage:
            initialStatus === 'SUCCEEDED'
              ? 'Intent created with zero amount fast path'
              : 'Intent created',
          triggeredByType: 'USER',
          triggeredById: dto.userId,
          correlationId: requestCorrelationId,
          occurredAt: new Date(),
          payload: {
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            payableAmount: pricingResult.intentPayable,
          },
        });

        if (initialStatus === 'SUCCEEDED') {
          const outboxEvent = this.buildPaymentIntentOutboxEvent(
            createdIntent,
            'PaymentIntentSucceeded',
            'SUCCEEDED',
          );
          await tx.insert(outboxEvents).values(buildOutboxInsertValues(outboxEvent));
        }

        return createdIntent;
      });
    } catch (error) {
      if (isReferenceBlockingUniqueViolation(error)) {
        throw new ConflictException({
          error: 'REFERENCE_BLOCKING_CONFLICT',
          message: 'Another active intent already exists for the same reference',
        });
      }
      throw error;
    }
  }

  private async persistIntentPricingSnapshot(
    tx: DbTx,
    intentId: string,
    pricing: IntentPricingResult,
  ): Promise<void> {
    const itemRows = pricing.items.map((item) => ({
      intentId,
      lineId: item.lineId,
      name: item.name,
      itemType: item.type ?? null,
      itemRefId: item.id ?? null,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      baseAmount: item.baseAmount,
      itemDiscountPerUnitTotal: item.itemDiscountPerUnitTotal,
      itemDiscountFlatTotal: item.itemDiscountFlatTotal,
      payableAmount: item.payableAmount,
      metadata: {},
    }));

    const insertedItems = await tx
      .insert(paymentIntentItems)
      .values(itemRows)
      .returning({
        id: paymentIntentItems.id,
        lineId: paymentIntentItems.lineId,
      });

    const itemIdByLineId = new Map(
      insertedItems.map((row) => [row.lineId, row.id]),
    );

    const itemDiscountRows = pricing.items.flatMap((item) =>
      item.discounts.map((discount) => {
        const itemId = itemIdByLineId.get(item.lineId);
        if (!itemId) {
          throw new BadRequestException({
            error: 'INVALID_ITEMS',
            message: `Unable to map discount item lineId: ${item.lineId}`,
          });
        }
        return {
          intentId,
          itemId,
          discountId: discount.discountId ?? null,
          kind: discount.kind as PaymentIntentItemDiscountKind,
          amount: discount.amount,
          metadata: {},
        };
      }),
    );

    if (itemDiscountRows.length > 0) {
      await tx.insert(paymentIntentItemDiscounts).values(itemDiscountRows);
    }

    const orderDiscountRows = pricing.orderDiscounts.map((discount) => ({
      intentId,
      discountId: discount.discountId ?? null,
      kind: discount.kind as PaymentIntentOrderDiscountKind,
      amount: discount.amount,
      metadata: {},
    }));

    if (orderDiscountRows.length > 0) {
      await tx.insert(paymentIntentOrderDiscounts).values(orderDiscountRows);
    }
  }

  async getIntent(intentId: string): Promise<PaymentIntent> {
    const rows = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);

    const intent = rows[0];
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }

    return intent;
  }

  async configureLegs(
    intentId: string,
    dto: ConfigureLegsDto,
    correlationId?: string,
  ): Promise<PaymentLeg[]> {
    const intent = await this.getIntent(intentId);
    this.assertIntentCanConfigureLegs(intent.status, intent.payableAmount);

    const sequenceSet = new Set<number>();
    let totalAmount = 0;

    for (const leg of dto.legs) {
      if (sequenceSet.has(leg.sequenceNo)) {
        throw new BadRequestException({
          error: 'LEG_SEQUENCE_DUPLICATED',
          message: `Duplicated leg sequenceNo: ${leg.sequenceNo}`,
        });
      }
      sequenceSet.add(leg.sequenceNo);
      totalAmount += leg.amount;

      const providerType = leg.providerType.trim().toUpperCase();
      const provider = this.providerRegistry.assertCapability(
        providerType,
        'AUTHORIZE',
        { intentId },
      );

      await provider.validateLeg({
        intentId,
        userId: intent.userId,
        amount: leg.amount,
        currency: intent.currency,
        sequenceNo: leg.sequenceNo,
        isRequired: leg.isRequired ?? true,
        metadata: leg.metadata,
      });
    }

    if (totalAmount !== intent.payableAmount) {
      throw new BadRequestException({
        error: 'LEG_AMOUNT_SUM_MISMATCH',
        message: `sum(legs.amount) must equal payableAmount: expected=${intent.payableAmount}, actual=${totalAmount}`,
      });
    }

    const requestCorrelationId = correlationId?.trim() || randomUUID();

    return this.dbService.db.transaction(async (tx) => {
      await tx.delete(paymentLegs).where(eq(paymentLegs.intentId, intentId));

      const createdLegs: PaymentLeg[] = [];

      for (const leg of dto.legs) {
        const providerType = leg.providerType.trim().toUpperCase();
        const [createdLeg] = await tx
          .insert(paymentLegs)
          .values({
            intentId,
            providerType,
            amount: leg.amount,
            status: 'READY' satisfies PaymentLegStatus,
            isRequired: leg.isRequired ?? true,
            sequenceNo: leg.sequenceNo,
            metadata: leg.metadata ?? {},
          })
          .returning();

        createdLegs.push(createdLeg);

        await tx.insert(paymentStateTransitions).values({
          entityType: 'LEG',
          entityId: createdLeg.id,
          previousStatus: null,
          newStatus: 'READY',
          reasonCode: 'LEG_CONFIGURED',
          reasonMessage: 'Leg configured and validated',
          triggeredByType: 'USER',
          triggeredById: intent.userId,
          correlationId: requestCorrelationId,
          occurredAt: new Date(),
          payload: {
            providerType,
            sequenceNo: leg.sequenceNo,
            amount: leg.amount,
            isRequired: leg.isRequired ?? true,
          },
        });
      }

      return createdLegs.sort((left, right) => left.sequenceNo - right.sequenceNo);
    });
  }

  private async lockIntentCreationReference(
    tx: DbTx,
    referenceType: PaymentReferenceType,
    referenceId: string,
  ): Promise<void> {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtext(${referenceType}),
        hashtext(${referenceId})
      )
    `);
  }

  private buildPaymentIntentOutboxEvent(
    intent: PaymentIntentEventSource,
    eventType:
      | 'PaymentIntentSucceeded'
      | 'PaymentIntentFailed'
      | 'PaymentIntentExpired'
      | 'PaymentIntentCancelled'
      | 'PaymentIntentSuperseded'
      | 'PaymentReconcileRequired',
    status: PaymentIntentStatus,
    extraPayload: Record<string, unknown> = {},
  ): OutboxEventInput {
    return {
      eventType,
      aggregateType: 'PaymentIntent',
      aggregateId: intent.id,
      partitionKey: intent.id,
      payload: buildPaymentIntentEventPayload({
        intentId: intent.id,
        referenceType: intent.referenceType,
        referenceId: intent.referenceId,
        userId: intent.userId,
        status,
        payableAmount: intent.payableAmount,
        currency: intent.currency,
        occurredAt:
          typeof extraPayload.occurredAt === 'string' ? extraPayload.occurredAt : undefined,
        extra: extraPayload,
      }),
    };
  }

  private assertIntentCanConfigureLegs(
    status: PaymentIntentStatus,
    payableAmount: number,
  ): void {
    if (payableAmount === 0) {
      throw new ConflictException({
        error: 'ZERO_AMOUNT_INTENT_DOES_NOT_ACCEPT_LEGS',
        message: 'Zero-amount fast path intent cannot configure legs',
      });
    }

    if (status !== 'PENDING') {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_LEG_CONFIGURATION',
        message: `Intent status ${status} cannot configure legs`,
      });
    }
  }
}

function isReferenceBlockingUniqueViolation(error: unknown): boolean {
  const current = error as
    | {
        code?: string;
        constraint?: string;
        message?: string;
        cause?: unknown;
        originalError?: unknown;
      }
    | undefined;

  if (!current) {
    return false;
  }

  if (
    current.code === '23505' &&
    current.constraint === 'uq_payment_intents_reference_blocking'
  ) {
    return true;
  }

  if ((current.message ?? '').includes('uq_payment_intents_reference_blocking')) {
    return true;
  }

  if (current.cause) {
    return isReferenceBlockingUniqueViolation(current.cause);
  }

  if (current.originalError) {
    return isReferenceBlockingUniqueViolation(current.originalError);
  }

  return false;
}

function normalizeSnapshotPayload(
  snapshotPayload: unknown,
): Record<string, unknown> {
  try {
    // ValidationPipe transform may turn nested JSON into class instances.
    // HMAC canonicalization expects plain JSON object graph.
    const serialized = JSON.stringify(snapshotPayload);
    if (serialized === undefined) {
      throw new Error('snapshotPayload serialization returned undefined');
    }

    const parsed = JSON.parse(serialized) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('snapshotPayload must be a JSON object');
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new BadRequestException({
      error: 'INVALID_SNAPSHOT_SCHEMA',
      message: 'snapshotPayload must be a JSON object',
    });
  }
}
