import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import { CreateIntentDto } from './dto/create-intent.dto';
import {
  HmacVerificationError,
  verifyHmacIntegrity,
} from '../domain/hmac/hmac-integrity';
import {
  PaymentIntentStatus,
  WalletSchema,
  paymentIntents,
  paymentStateTransitions,
} from '../schema';
import { PaymentIntent } from '../types';

@Injectable()
export class IntentsService {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async createIntent(
    dto: CreateIntentDto,
    correlationId?: string,
  ): Promise<PaymentIntent> {
    const sharedSecret = process.env.WALLET_HMAC_SHARED_SECRET ?? '';
    let payloadHash = '';

    try {
      const verifyResult = verifyHmacIntegrity(
        {
          snapshotPayload: dto.snapshotPayload,
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

    const existingSucceeded = await this.dbService.db
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

    const initialStatus: PaymentIntentStatus =
      dto.payableAmount === 0 ? 'SUCCEEDED' : 'PENDING';
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    try {
      return await this.dbService.db.transaction(async (tx) => {
        const [createdIntent] = await tx
          .insert(paymentIntents)
          .values({
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            customerId: dto.customerId,
            currency: dto.currency.toUpperCase(),
            payableAmount: dto.payableAmount,
            status: initialStatus,
            expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
            metadata: {
              ...(dto.metadata ?? {}),
              snapshotPayload: dto.snapshotPayload,
              signatureVersion: dto.signatureVersion,
              signedAt: dto.signedAt,
              payloadHash,
            },
          })
          .returning();

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
          triggeredById: dto.customerId,
          correlationId: requestCorrelationId,
          occurredAt: new Date(),
          payload: {
            referenceType: dto.referenceType,
            referenceId: dto.referenceId,
            payableAmount: dto.payableAmount,
          },
        });

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
