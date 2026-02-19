import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  PaymentAttemptStatus,
  paymentAttempts,
  paymentStateTransitions,
} from '../../schema';
import { DbTx, PaymentAttempt } from '../../types';
import {
  ProviderOperation,
  ProviderOperationResult,
} from '../../providers/payment-provider.types';

const ACTIVE_ATTEMPT_STATUSES: PaymentAttemptStatus[] = [
  'CREATED',
  'SENT',
  'PENDING_PROVIDER',
  'REQUIRES_ACTION',
  'CANCEL_REQUESTED',
  'REFUND_REQUESTED',
];

@Injectable()
export class AttemptService {
  async createAttempt(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      operation: ProviderOperation;
      correlationId: string;
      triggeredById: string;
    },
  ): Promise<PaymentAttempt> {
    const maxAttemptRows = await tx
      .select({
        maxAttemptNo: sql<number>`coalesce(max(${paymentAttempts.attemptNo}), 0)`,
      })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.legId, input.legId));

    const nextAttemptNo = Number(maxAttemptRows[0]?.maxAttemptNo ?? 0) + 1;
    const providerIdempotencyKey = this.buildProviderIdempotencyKey(
      input.legId,
      input.operation,
      nextAttemptNo,
    );

    let attempt: PaymentAttempt;
    try {
      const [createdAttempt] = await tx
        .insert(paymentAttempts)
        .values({
          intentId: input.intentId,
          legId: input.legId,
          attemptNo: nextAttemptNo,
          operation: input.operation,
          status: 'CREATED',
          providerIdempotencyKey,
          requestPayload: {
            operation: input.operation,
          },
        })
        .returning();
      attempt = createdAttempt;
    } catch (error) {
      if (!isActiveAttemptUniqueViolation(error)) {
        throw error;
      }

      const activeRows = await tx
        .select({
          id: paymentAttempts.id,
          status: paymentAttempts.status,
        })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.legId, input.legId),
            eq(paymentAttempts.operation, input.operation),
            inArray(paymentAttempts.status, ACTIVE_ATTEMPT_STATUSES),
          ),
        )
        .limit(1);

      const activeAttempt = activeRows[0];
      throw new ConflictException({
        error: 'ACTIVE_ATTEMPT_ALREADY_EXISTS',
        message: `Active ${input.operation} attempt already exists for leg=${input.legId}`,
        legId: input.legId,
        operation: input.operation,
        attemptId: activeAttempt?.id ?? null,
        attemptStatus: activeAttempt?.status ?? null,
      });
    }

    await tx.insert(paymentStateTransitions).values({
      entityType: 'ATTEMPT',
      entityId: attempt.id,
      previousStatus: null,
      newStatus: 'CREATED',
      reasonCode: `${input.operation}_ATTEMPT_CREATED`,
      reasonMessage: `${input.operation} attempt created`,
      triggeredByType: 'SYSTEM',
      triggeredById: input.triggeredById,
      correlationId: input.correlationId,
      causationId: null,
      occurredAt: new Date(),
      payload: {
        operation: input.operation,
        attemptNo: nextAttemptNo,
      },
    });

    return attempt;
  }

  async persistProviderAttemptResult(
    tx: DbTx,
    attemptId: string,
    providerResult: ProviderOperationResult,
  ): Promise<void> {
    await tx
      .update(paymentAttempts)
      .set({
        providerTransactionId: providerResult.providerTransactionId,
        providerRequestId: providerResult.providerRequestId,
        responsePayload: providerResult.raw ?? null,
        updatedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(paymentAttempts.id, attemptId));
  }

  async persistProviderAttemptFailure(
    tx: DbTx,
    attemptId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await tx
      .update(paymentAttempts)
      .set({
        errorCode,
        errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attemptId));
  }

  private buildProviderIdempotencyKey(
    legId: string,
    operation: ProviderOperation,
    attemptNo: number,
  ): string {
    return `wallet:attempt:${legId}:${operation}:${attemptNo}`;
  }
}

function isActiveAttemptUniqueViolation(error: unknown): boolean {
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
    current.constraint === 'uq_payment_attempts_active_leg_operation'
  ) {
    return true;
  }

  if ((current.message ?? '').includes('uq_payment_attempts_active_leg_operation')) {
    return true;
  }

  if (current.cause) {
    return isActiveAttemptUniqueViolation(current.cause);
  }

  if (current.originalError) {
    return isActiveAttemptUniqueViolation(current.originalError);
  }

  return false;
}

