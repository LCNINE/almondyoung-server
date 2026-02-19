import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import { CreateRefundRequestDto } from './dto/create-refund-request.dto';
import {
  HmacVerificationError,
  verifyHmacIntegrity,
} from '../domain/hmac/hmac-integrity';
import {
  ManualCancelQueueStatus,
  PaymentReferenceType,
  PaymentIntentStatus,
  PaymentLegStatus,
  RefundRequestStatus,
  WalletSchema,
  manualCancelQueueItems,
  outboxEvents,
  refundAllocations,
  refundRequests,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
} from '../schema';
import {
  DbTx,
  PaymentAttempt,
  PaymentIntent,
  PaymentLeg,
  RefundAllocation,
  RefundRequest,
} from '../types';
import { ProviderRegistry } from '../providers/provider.registry';
import {
  ProviderOperation,
  ProviderOperationResult,
} from '../providers/payment-provider.types';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';

interface LegOperationResult {
  intent: PaymentIntent;
  leg: PaymentLeg;
  attempt: PaymentAttempt;
}

interface IntentTerminationResult {
  intentId: string;
  status: PaymentIntentStatus;
}

interface ExpireIntentsBatchResult {
  scanned: number;
  expired: number;
  reconcileRequired: number;
  skipped: number;
  failed: number;
}

interface RefundRequestDetailResult {
  refundRequest: RefundRequest;
  allocations: RefundAllocation[];
}

interface CompensationExecutionResult {
  hasFailure: boolean;
  manualQueueItemIds: string[];
}

interface CompensationLegResult {
  failed: boolean;
  manualQueueItemId?: string;
}

type TerminationReason = 'CANCEL' | 'SUPERSEDE' | 'EXPIRE';

interface LockedIntent {
  id: string;
  referenceType: PaymentReferenceType;
  referenceId: string;
  customerId: string;
  currency: string;
  payableAmount: number;
  expiresAt: Date;
  status: PaymentIntentStatus;
  version: number;
}

interface LockedLeg {
  id: string;
  intentId: string;
  providerType: string;
  amount: number;
  status: PaymentLegStatus;
  version: number;
  metadata: Record<string, unknown>;
}

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
  customerId: string;
  payableAmount: number;
  currency: string;
}

const OPEN_MANUAL_QUEUE_STATUSES: ManualCancelQueueStatus[] = [
  'QUEUED',
  'ASSIGNED',
  'PROCESSING',
  'FAILED_RETRYABLE',
];

const REFUND_LIMIT_BLOCKING_STATUSES: RefundRequestStatus[] = [
  'REQUESTED',
  'VALIDATED',
  'PROCESSING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'RECONCILE_REQUIRED',
];

@Injectable()
export class IntentsService {
  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

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

    const initialStatus: PaymentIntentStatus =
      dto.payableAmount === 0 ? 'SUCCEEDED' : 'PENDING';
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

        if (initialStatus === 'SUCCEEDED') {
          const outboxEvent = this.buildPaymentIntentOutboxEvent(
            createdIntent,
            'PaymentIntentSucceeded',
            'SUCCEEDED',
          );
          await tx.insert(outboxEvents).values(this.toOutboxInsertValues(outboxEvent));
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
        customerId: intent.customerId,
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
          triggeredById: intent.customerId,
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

  async authorizeLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExecuteLeg(intent.status);

      const leg = await this.lockLegOrThrow(intentId, legId, tx);
      this.assertLegStatus(leg.status, 'READY', legId, 'authorize');

      this.providerRegistry.assertCapability(leg.providerType, 'AUTHORIZE', {
        intentId,
        legId,
      });

      const attempt = await this.createAttempt(tx, {
        intentId,
        legId,
        operation: 'AUTHORIZE',
        correlationId: requestCorrelationId,
        triggeredById: intent.customerId,
      });

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'IN_PROGRESS',
          {
            correlationId: requestCorrelationId,
            causationId: attempt.id,
            reasonCode: 'LEG_AUTHORIZE_STARTED',
            reasonMessage: `Leg authorize started for leg=${legId}`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              legId,
              operation: 'AUTHORIZE',
            },
          },
          'PENDING',
          tx,
        );
      }

      await this.stateTransitionService.transitionLeg(
        legId,
        'PROCESSING',
        {
          correlationId: requestCorrelationId,
          causationId: attempt.id,
          reasonCode: 'LEG_AUTHORIZE_STARTED',
          reasonMessage: 'Leg moved to PROCESSING before provider authorize',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'AUTHORIZE',
          },
        },
        'READY',
        tx,
      );

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'SENT',
        {
          correlationId: requestCorrelationId,
          causationId: legId,
          reasonCode: 'PROVIDER_AUTHORIZE_REQUEST_SENT',
          reasonMessage: 'Provider authorize request sent',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            providerType: leg.providerType,
            operation: 'AUTHORIZE',
          },
        },
        'CREATED',
        tx,
      );

      return { intent, leg, attempt };
    });

    const provider = this.providerRegistry.assertCapability(
      prepared.leg.providerType,
      'AUTHORIZE',
      {
        intentId,
        legId,
      },
    );

    try {
      const providerResult = await provider.authorize({
        intentId,
        legId,
        attemptId: prepared.attempt.id,
        amount: prepared.leg.amount,
        currency: prepared.intent.currency,
        customerId: prepared.intent.customerId,
        correlationId: requestCorrelationId,
        metadata: prepared.leg.metadata,
      });

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, prepared.attempt.id, providerResult);
        await this.applyAuthorizeResult(
          tx,
          {
            intentId,
            legId,
            attemptId: prepared.attempt.id,
            customerId: prepared.intent.customerId,
          },
          providerResult,
          requestCorrelationId,
        );
        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider authorize call failed';

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptFailure(
          tx,
          prepared.attempt.id,
          'PROVIDER_AUTHORIZE_FAILED',
          errorMessage,
        );
        await this.stateTransitionService.transitionAttempt(
          prepared.attempt.id,
          'FAILED_RETRYABLE',
          {
            correlationId: requestCorrelationId,
            causationId: legId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );
        await this.stateTransitionService.transitionLeg(
          legId,
          'FAILED',
          {
            correlationId: requestCorrelationId,
            causationId: prepared.attempt.id,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    }
  }

  async captureLeg(
    intentId: string,
    legId: string,
    correlationId?: string,
  ): Promise<LegOperationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    const prepared = await this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExecuteLeg(intent.status);

      const leg = await this.lockLegOrThrow(intentId, legId, tx);
      this.assertLegStatus(leg.status, 'AUTHORIZED', legId, 'capture');

      this.providerRegistry.assertCapability(leg.providerType, 'CAPTURE', {
        intentId,
        legId,
      });

      const attempt = await this.createAttempt(tx, {
        intentId,
        legId,
        operation: 'CAPTURE',
        correlationId: requestCorrelationId,
        triggeredById: intent.customerId,
      });

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'SENT',
        {
          correlationId: requestCorrelationId,
          causationId: legId,
          reasonCode: 'PROVIDER_CAPTURE_REQUEST_SENT',
          reasonMessage: 'Provider capture request sent',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            providerType: leg.providerType,
            operation: 'CAPTURE',
          },
        },
        'CREATED',
        tx,
      );

      return { intent, leg, attempt };
    });

    const provider = this.providerRegistry.assertCapability(
      prepared.leg.providerType,
      'CAPTURE',
      {
        intentId,
        legId,
      },
    );

    try {
      const providerResult = await provider.capture({
        intentId,
        legId,
        attemptId: prepared.attempt.id,
        amount: prepared.leg.amount,
        currency: prepared.intent.currency,
        customerId: prepared.intent.customerId,
        correlationId: requestCorrelationId,
        metadata: prepared.leg.metadata,
      });

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptResult(tx, prepared.attempt.id, providerResult);

        if (providerResult.resultStatus === 'CAPTURED') {
          await this.stateTransitionService.transitionAttempt(
            prepared.attempt.id,
            'CAPTURED',
            {
              correlationId: requestCorrelationId,
              causationId: legId,
              reasonCode: 'PROVIDER_CAPTURE_SUCCEEDED',
              reasonMessage: 'Provider capture succeeded',
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
              },
            },
            'SENT',
            tx,
          );

          await this.stateTransitionService.transitionLeg(
            legId,
            'CAPTURED',
            {
              correlationId: requestCorrelationId,
              causationId: prepared.attempt.id,
              reasonCode: 'LEG_CAPTURED',
              reasonMessage: 'Leg capture completed',
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
              },
            },
            'AUTHORIZED',
            tx,
          );

          await this.reconcileIntentAfterCapture(
            intentId,
            requestCorrelationId,
            prepared.attempt.id,
            tx,
          );
        } else {
          await this.persistProviderAttemptFailure(
            tx,
            prepared.attempt.id,
            'PROVIDER_CAPTURE_FAILED',
            `Unexpected provider capture result: ${providerResult.resultStatus}`,
          );
          await this.stateTransitionService.transitionAttempt(
            prepared.attempt.id,
            'FAILED_FINAL',
            {
              correlationId: requestCorrelationId,
              causationId: legId,
              reasonCode: 'PROVIDER_CAPTURE_FAILED',
              reasonMessage: `Unexpected provider capture result: ${providerResult.resultStatus}`,
              triggeredByType: 'SYSTEM',
              triggeredById: prepared.intent.customerId,
              payload: {
                operation: 'CAPTURE',
                providerResultStatus: providerResult.resultStatus,
              },
            },
            'SENT',
            tx,
          );
        }

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider capture call failed';

      return this.dbService.db.transaction(async (tx) => {
        await this.persistProviderAttemptFailure(
          tx,
          prepared.attempt.id,
          'PROVIDER_CAPTURE_FAILED',
          errorMessage,
        );
        await this.stateTransitionService.transitionAttempt(
          prepared.attempt.id,
          'FAILED_RETRYABLE',
          {
            correlationId: requestCorrelationId,
            causationId: legId,
            reasonCode: 'PROVIDER_CAPTURE_FAILED',
            reasonMessage: errorMessage,
            triggeredByType: 'SYSTEM',
            triggeredById: prepared.intent.customerId,
            payload: {
              operation: 'CAPTURE',
            },
          },
          'SENT',
          tx,
        );

        return this.readLegOperationResult(tx, intentId, legId, prepared.attempt.id);
      });
    }
  }

  async cancelIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    return this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanCancel(intent.status);

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'CANCELLED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'INTENT_CANCELLED',
            reasonMessage: 'Intent cancelled before payment processing',
            triggeredByType: 'USER',
            triggeredById: intent.customerId,
            payload: {
              operation: 'CANCEL',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentCancelled',
              'CANCELLED',
              {
                reasonCode: 'INTENT_CANCELLED',
                reasonMessage: 'Intent cancelled before payment processing',
              },
            ),
          },
          'PENDING',
          tx,
        );

        return {
          intentId,
          status: 'CANCELLED',
        };
      }

      await this.stateTransitionService.transitionIntent(
        intentId,
        'RECONCILING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_CANCEL_RECONCILING',
          reasonMessage: 'Intent cancel started with compensation',
          triggeredByType: 'USER',
          triggeredById: intent.customerId,
          payload: {
            operation: 'CANCEL',
          },
        },
        intent.status,
        tx,
      );

      const compensationResult = await this.compensateIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'CANCEL',
      );
      const compensationFailed = compensationResult.hasFailure;
      const finalStatus: PaymentIntentStatus = compensationFailed
        ? 'RECONCILE_REQUIRED'
        : 'CANCELLED';

      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_CANCEL_RECONCILE_REQUIRED'
            : 'INTENT_CANCELLED',
          reasonMessage: compensationFailed
            ? 'Intent cancellation requires manual reconcile'
            : 'Intent cancellation completed',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'CANCEL',
            compensationFailed,
            manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
            manualQueueItemIds: compensationResult.manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_CANCEL_RECONCILE_REQUIRED',
                  reasonMessage: 'Intent cancellation requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
                  manualQueueItemIds: compensationResult.manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentIntentCancelled',
                finalStatus,
                {
                  reasonCode: 'INTENT_CANCELLED',
                  reasonMessage: 'Intent cancellation completed',
                },
              ),
        },
        'RECONCILING',
        tx,
      );

      return {
        intentId,
        status: finalStatus,
      };
    });
  }

  async supersedeIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    return this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanSupersede(intent.status);

      await this.stateTransitionService.transitionIntent(
        intentId,
        'SUSPENDED',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_SUPERSEDE_STARTED',
          reasonMessage: 'Intent supersede started',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'SUPERSEDE',
          },
        },
        intent.status,
        tx,
      );

      const compensationResult = await this.compensateIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'SUPERSEDE',
      );
      const compensationFailed = compensationResult.hasFailure;
      const finalStatus: PaymentIntentStatus = compensationFailed
        ? 'SUPERSEDED_RECONCILE_REQUIRED'
        : 'SUPERSEDED';

      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_SUPERSEDE_RECONCILE_REQUIRED'
            : 'INTENT_SUPERSEDED',
          reasonMessage: compensationFailed
            ? 'Supersede compensation requires manual reconcile'
            : 'Supersede completed',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation: 'SUPERSEDE',
            compensationFailed,
            manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
            manualQueueItemIds: compensationResult.manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_SUPERSEDE_RECONCILE_REQUIRED',
                  reasonMessage: 'Supersede compensation requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
                  manualQueueItemIds: compensationResult.manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentIntentSuperseded',
                finalStatus,
                {
                  reasonCode: 'INTENT_SUPERSEDED',
                  reasonMessage: 'Supersede completed',
                },
              ),
        },
        'SUSPENDED',
        tx,
      );

      return {
        intentId,
        status: finalStatus,
      };
    });
  }

  async expireIntent(
    intentId: string,
    correlationId?: string,
  ): Promise<IntentTerminationResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();

    return this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentOrThrow(intentId, tx);
      this.assertIntentCanExpire(intent.status);

      const expiresAtMs = intent.expiresAt.getTime();
      if (Number.isNaN(expiresAtMs)) {
        throw new Error(`INTENT_EXPIRES_AT_INVALID: ${intentId}`);
      }

      if (expiresAtMs > Date.now()) {
        throw new ConflictException({
          error: 'INTENT_NOT_EXPIRED',
          message: `Intent ${intentId} is not expired yet`,
        });
      }

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'EXPIRED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'INTENT_EXPIRED',
            reasonMessage: 'Intent expired before payment processing',
            triggeredByType: 'SYSTEM',
            triggeredById: 'system',
            payload: {
              operation: 'EXPIRE',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentExpired',
              'EXPIRED',
              {
                reasonCode: 'INTENT_EXPIRED',
                reasonMessage: 'Intent expired before payment processing',
              },
            ),
          },
          'PENDING',
          tx,
        );

        return {
          intentId,
          status: 'EXPIRED',
        };
      }

      await this.stateTransitionService.transitionIntent(
        intentId,
        'RECONCILING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'INTENT_EXPIRE_RECONCILING',
          reasonMessage: 'Intent expiration started with compensation',
          triggeredByType: 'SYSTEM',
          triggeredById: 'system',
          payload: {
            operation: 'EXPIRE',
          },
        },
        intent.status,
        tx,
      );

      const compensationResult = await this.compensateIntentLegs(
        tx,
        intent,
        requestCorrelationId,
        'EXPIRE',
      );
      const compensationFailed = compensationResult.hasFailure;
      const finalStatus: PaymentIntentStatus = compensationFailed
        ? 'RECONCILE_REQUIRED'
        : 'EXPIRED';

      await this.stateTransitionService.transitionIntent(
        intentId,
        finalStatus,
        {
          correlationId: requestCorrelationId,
          reasonCode: compensationFailed
            ? 'INTENT_EXPIRE_RECONCILE_REQUIRED'
            : 'INTENT_EXPIRED',
          reasonMessage: compensationFailed
            ? 'Intent expiration requires manual reconcile'
            : 'Intent expiration completed',
          triggeredByType: 'SYSTEM',
          triggeredById: 'system',
          payload: {
            operation: 'EXPIRE',
            compensationFailed,
            manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
            manualQueueItemIds: compensationResult.manualQueueItemIds,
          },
          outboxEvent: compensationFailed
            ? this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentReconcileRequired',
                finalStatus,
                {
                  reasonCode: 'INTENT_EXPIRE_RECONCILE_REQUIRED',
                  reasonMessage: 'Intent expiration requires manual reconcile',
                  requiresManualAction: true,
                  manualQueueItemId: compensationResult.manualQueueItemIds[0] ?? null,
                  manualQueueItemIds: compensationResult.manualQueueItemIds,
                },
              )
            : this.buildPaymentIntentOutboxEvent(
                intent,
                'PaymentIntentExpired',
                finalStatus,
                {
                  reasonCode: 'INTENT_EXPIRED',
                  reasonMessage: 'Intent expiration completed',
                },
              ),
        },
        'RECONCILING',
        tx,
      );

      return {
        intentId,
        status: finalStatus,
      };
    });
  }

  async expireDueIntents(
    limit?: number,
    correlationId?: string,
  ): Promise<ExpireIntentsBatchResult> {
    const batchSize = this.resolveExpirationBatchSize(limit);
    const now = new Date();
    const batchCorrelationId = correlationId?.trim() || randomUUID();
    const result: ExpireIntentsBatchResult = {
      scanned: 0,
      expired: 0,
      reconcileRequired: 0,
      skipped: 0,
      failed: 0,
    };

    const dueIntents = await this.dbService.db
      .select({ id: paymentIntents.id })
      .from(paymentIntents)
      .where(
        and(
          inArray(paymentIntents.status, [
            'PENDING',
            'IN_PROGRESS',
            'PARTIALLY_CAPTURED',
          ]),
          lte(paymentIntents.expiresAt, now),
        ),
      )
      .orderBy(asc(paymentIntents.expiresAt))
      .limit(batchSize);

    result.scanned = dueIntents.length;

    for (const intent of dueIntents) {
      const intentCorrelationId = `${batchCorrelationId}:expire:${intent.id}`;
      try {
        const expired = await this.expireIntent(intent.id, intentCorrelationId);
        if (expired.status === 'EXPIRED') {
          result.expired += 1;
          continue;
        }
        if (expired.status === 'RECONCILE_REQUIRED') {
          result.reconcileRequired += 1;
          continue;
        }
        result.skipped += 1;
      } catch (error) {
        if (this.isExpirationSkippableConflict(error)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
      }
    }

    return result;
  }

  async createRefundRequest(
    intentId: string,
    dto: CreateRefundRequestDto,
    correlationId?: string,
    actorId?: string,
  ): Promise<RefundRequestDetailResult> {
    const requestCorrelationId = correlationId?.trim() || randomUUID();
    const requestedBy = actorId?.trim() || 'system';
    const totalAllocationAmount = dto.allocation.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    if (totalAllocationAmount !== dto.refundAmount) {
      throw new BadRequestException({
        error: 'ALLOCATION_INVALID',
        message: `sum(allocation.amount) must equal refundAmount: expected=${dto.refundAmount}, actual=${totalAllocationAmount}`,
      });
    }

    const allocationLegIds = dto.allocation.map((item) => item.legId);
    if (new Set(allocationLegIds).size !== allocationLegIds.length) {
      throw new BadRequestException({
        error: 'ALLOCATION_INVALID',
        message: 'allocation must not contain duplicate legId',
      });
    }

    return this.dbService.db.transaction(async (tx) => {
      const intent = await this.lockIntentForRefundOrThrow(intentId, tx);
      const lockedLegs = await this.lockLegsForRefund(intentId, allocationLegIds, tx);

      if (lockedLegs.length !== allocationLegIds.length) {
        throw new NotFoundException({
          error: 'LEG_NOT_FOUND',
          message: 'Some allocation legs were not found for this intent',
        });
      }

      const refundedByLegId = await this.readRefundedAmountByLegId(
        intentId,
        allocationLegIds,
        tx,
      );
      const legsById = new Map(lockedLegs.map((leg) => [leg.id, leg]));

      for (const allocation of dto.allocation) {
        const leg = legsById.get(allocation.legId);
        if (!leg) {
          throw new NotFoundException({
            error: 'LEG_NOT_FOUND',
            message: `Payment leg not found: ${allocation.legId}`,
          });
        }

        if (leg.status !== 'CAPTURED') {
          throw new BadRequestException({
            error: 'ALLOCATION_INVALID',
            message: `Allocation target leg must be CAPTURED: legId=${allocation.legId}, status=${leg.status}`,
          });
        }

        const alreadyRefunded = refundedByLegId.get(leg.id) ?? 0;
        if (alreadyRefunded + allocation.amount > leg.amount) {
          throw new BadRequestException({
            error: 'REFUND_LIMIT_EXCEEDED',
            message: `Refund limit exceeded for leg=${leg.id}: captured=${leg.amount}, refunded=${alreadyRefunded}, requested=${allocation.amount}`,
          });
        }
      }

      const [createdRefundRequest] = await tx
        .insert(refundRequests)
        .values({
          intentId,
          referenceType: intent.referenceType,
          referenceId: intent.referenceId,
          status: 'REQUESTED',
          refundAmount: dto.refundAmount,
          currency: intent.currency,
          reasonCode: dto.reasonCode,
          reasonMessage: dto.reasonMessage,
          requestedBy,
          metadata: {},
        })
        .returning();

      const createdAllocations = await tx
        .insert(refundAllocations)
        .values(
          dto.allocation.map((item) => ({
            refundRequestId: createdRefundRequest.id,
            intentId,
            legId: item.legId,
            amount: item.amount,
          })),
        )
        .returning();

      await tx.insert(paymentStateTransitions).values({
        entityType: 'REFUND_REQUEST',
        entityId: createdRefundRequest.id,
        previousStatus: null,
        newStatus: 'REQUESTED',
        reasonCode: 'REFUND_REQUEST_CREATED',
        reasonMessage: 'Refund request created',
        triggeredByType: 'USER',
        triggeredById: requestedBy,
        correlationId: requestCorrelationId,
        occurredAt: new Date(),
        payload: {
          intentId,
          refundAmount: dto.refundAmount,
          allocation: dto.allocation,
        },
      });

      await this.stateTransitionService.transitionRefundRequest(
        createdRefundRequest.id,
        'VALIDATED',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'REFUND_REQUEST_VALIDATED',
          reasonMessage: 'Refund allocation validated',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            intentId,
            allocationCount: dto.allocation.length,
          },
        },
        'REQUESTED',
        tx,
      );

      await this.stateTransitionService.transitionRefundRequest(
        createdRefundRequest.id,
        'PROCESSING',
        {
          correlationId: requestCorrelationId,
          reasonCode: 'REFUND_REQUEST_PROCESSING_STARTED',
          reasonMessage: 'Refund processing started',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            intentId,
          },
          outboxEvent: {
            eventType: 'RefundRequested',
            aggregateType: 'RefundRequest',
            aggregateId: createdRefundRequest.id,
            partitionKey: intentId,
            payload: {
              refundId: createdRefundRequest.id,
              intentId,
              referenceType: intent.referenceType,
              referenceId: intent.referenceId,
              customerId: intent.customerId,
              refundAmount: dto.refundAmount,
              currency: intent.currency,
              allocation: dto.allocation,
              occurredAt: new Date().toISOString(),
            },
          },
        },
        'VALIDATED',
        tx,
      );

      let hasFailure = false;
      let successCount = 0;
      const manualQueueItemIds: string[] = [];

      for (const allocation of dto.allocation) {
        const leg = legsById.get(allocation.legId)!;
        const alreadyRefunded = refundedByLegId.get(leg.id) ?? 0;
        const shouldFullyRefundLeg = alreadyRefunded + allocation.amount >= leg.amount;

        const result = await this.executeRefundAllocation(tx, {
          intent,
          leg,
          allocationAmount: allocation.amount,
          shouldFullyRefundLeg,
          correlationId: requestCorrelationId,
          requestedBy,
          reasonCode: dto.reasonCode,
          reasonMessage: dto.reasonMessage,
        });

        if (result.failed) {
          hasFailure = true;
          if (result.manualQueueItemId) {
            manualQueueItemIds.push(result.manualQueueItemId);
          }
        } else {
          successCount += 1;
          refundedByLegId.set(leg.id, alreadyRefunded + allocation.amount);
        }
      }

      if (!hasFailure) {
        await this.stateTransitionService.transitionRefundRequest(
          createdRefundRequest.id,
          'COMPLETED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'REFUND_REQUEST_COMPLETED',
            reasonMessage: 'Refund request completed',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              intentId,
              successfulAllocationCount: successCount,
            },
            outboxEvent: {
              eventType: 'RefundCompleted',
              aggregateType: 'RefundRequest',
              aggregateId: createdRefundRequest.id,
              partitionKey: intentId,
              payload: {
                refundId: createdRefundRequest.id,
                intentId,
                referenceType: intent.referenceType,
                referenceId: intent.referenceId,
                customerId: intent.customerId,
                refundAmount: dto.refundAmount,
                currency: intent.currency,
                allocation: dto.allocation,
                occurredAt: new Date().toISOString(),
              },
            },
          },
          'PROCESSING',
          tx,
        );
      } else {
        let currentRefundStatus: RefundRequestStatus = 'PROCESSING';

        if (successCount > 0) {
          await this.stateTransitionService.transitionRefundRequest(
            createdRefundRequest.id,
            'PARTIALLY_COMPLETED',
            {
              correlationId: requestCorrelationId,
              reasonCode: 'REFUND_REQUEST_PARTIALLY_COMPLETED',
              reasonMessage: 'Some allocations were refunded before failure',
              triggeredByType: 'SYSTEM',
              triggeredById: requestedBy,
              payload: {
                intentId,
                successfulAllocationCount: successCount,
              },
            },
            'PROCESSING',
            tx,
          );
          currentRefundStatus = 'PARTIALLY_COMPLETED';
        }

        await this.stateTransitionService.transitionRefundRequest(
          createdRefundRequest.id,
          'RECONCILE_REQUIRED',
          {
            correlationId: requestCorrelationId,
            reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
            reasonMessage: 'Refund request requires manual reconcile',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              intentId,
              successfulAllocationCount: successCount,
              failedAllocationCount: dto.allocation.length - successCount,
              manualQueueItemIds,
            },
            outboxEvent: {
              eventType: 'RefundFailed',
              aggregateType: 'RefundRequest',
              aggregateId: createdRefundRequest.id,
              partitionKey: intentId,
              payload: {
                refundId: createdRefundRequest.id,
                intentId,
                referenceType: intent.referenceType,
                referenceId: intent.referenceId,
                customerId: intent.customerId,
                refundAmount: dto.refundAmount,
                currency: intent.currency,
                allocation: dto.allocation,
                reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
                reasonMessage: 'Refund request requires manual reconcile',
                requiresManualAction: true,
                manualQueueItemId: manualQueueItemIds[0] ?? null,
                manualQueueItemIds,
                occurredAt: new Date().toISOString(),
              },
            },
          },
          currentRefundStatus,
          tx,
        );

        await tx.insert(outboxEvents).values(
          this.toOutboxInsertValues(
            this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentReconcileRequired',
              'RECONCILE_REQUIRED',
              {
                reasonCode: 'REFUND_REQUEST_RECONCILE_REQUIRED',
                reasonMessage: 'Refund request requires manual reconcile',
                requiresManualAction: true,
                manualQueueItemId: manualQueueItemIds[0] ?? null,
                manualQueueItemIds,
              },
            ),
          ),
        );
      }

      const refreshedRows = await tx
        .select()
        .from(refundRequests)
        .where(eq(refundRequests.id, createdRefundRequest.id))
        .limit(1);
      const refreshedRefundRequest = refreshedRows[0];

      if (!refreshedRefundRequest) {
        throw new Error(`REFUND_REQUEST_NOT_FOUND: ${createdRefundRequest.id}`);
      }

      return {
        refundRequest: refreshedRefundRequest,
        allocations: createdAllocations,
      };
    });
  }

  async getRefundRequest(refundId: string): Promise<RefundRequestDetailResult> {
    const rows = await this.dbService.db
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, refundId))
      .limit(1);
    const refundRequest = rows[0];

    if (!refundRequest) {
      throw new NotFoundException({
        error: 'REFUND_REQUEST_NOT_FOUND',
        message: `Refund request not found: ${refundId}`,
      });
    }

    const allocations = await this.dbService.db
      .select()
      .from(refundAllocations)
      .where(eq(refundAllocations.refundRequestId, refundId));

    return {
      refundRequest,
      allocations,
    };
  }

  private async compensateIntentLegs(
    tx: DbTx,
    intent: LockedIntent,
    correlationId: string,
    reason: TerminationReason,
  ): Promise<CompensationExecutionResult> {
    const legs = await tx
      .select()
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intent.id));

    let hasFailure = false;
    const manualQueueItemIds = new Set<string>();

    const cancelTargets = legs.filter((leg) => leg.status === 'AUTHORIZED');
    const refundTargets = legs
      .filter((leg) => leg.status === 'CAPTURED')
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const nonMonetaryTargets = legs.filter(
      (leg) => leg.status !== 'AUTHORIZED' && leg.status !== 'CAPTURED',
    );

    for (const leg of cancelTargets) {
      const result = await this.compensateLegWithProvider(
        tx,
        intent,
        leg,
        'CANCEL',
        correlationId,
        reason,
      );
      hasFailure = hasFailure || result.failed;
      if (result.manualQueueItemId) {
        manualQueueItemIds.add(result.manualQueueItemId);
      }
    }

    for (const leg of refundTargets) {
      const result = await this.compensateLegWithProvider(
        tx,
        intent,
        leg,
        'REFUND',
        correlationId,
        reason,
      );
      hasFailure = hasFailure || result.failed;
      if (result.manualQueueItemId) {
        manualQueueItemIds.add(result.manualQueueItemId);
      }
    }

    for (const leg of nonMonetaryTargets) {
      switch (leg.status) {
        case 'READY':
        case 'PROCESSING':
        case 'REQUIRES_CUSTOMER_ACTION':
        case 'REQUIRES_ADMIN_CONFIRMATION': {
          const preCaptureReasonCode =
            reason === 'CANCEL'
              ? 'LEG_CANCELLED_BEFORE_CAPTURE'
              : reason === 'SUPERSEDE'
                ? 'LEG_SUPERSEDED_BEFORE_CAPTURE'
                : 'LEG_EXPIRED_BEFORE_CAPTURE';
          const preCaptureReasonMessage =
            reason === 'CANCEL'
              ? 'Leg expired due to intent cancellation before capture'
              : reason === 'SUPERSEDE'
                ? 'Leg expired due to intent supersede before capture'
                : 'Leg expired due to intent expiration before capture';

          await this.stateTransitionService.transitionLeg(
            leg.id,
            'EXPIRED',
            {
              correlationId,
              reasonCode: preCaptureReasonCode,
              reasonMessage: preCaptureReasonMessage,
              triggeredByType: 'SYSTEM',
              triggeredById: intent.customerId,
              payload: {
                operation: reason,
              },
            },
            leg.status,
            tx,
          );
          break;
        }
        case 'CANCELING':
        case 'REFUNDING': {
          hasFailure = true;
          const queueItemId = await this.upsertManualQueueItem(tx, {
            intentId: intent.id,
            legId: leg.id,
            actionType: leg.status === 'REFUNDING' ? 'REFUND' : 'CANCEL',
            correlationId,
            requestedBy: intent.customerId,
            reasonCode: 'LEG_RECONCILE_REQUIRED',
            reasonMessage: `Leg remained ${leg.status} during ${reason} compensation`,
          });
          manualQueueItemIds.add(queueItemId);
          break;
        }
        case 'RECONCILE_REQUIRED': {
          hasFailure = true;
          break;
        }
        default:
          break;
      }
    }

    return {
      hasFailure,
      manualQueueItemIds: [...manualQueueItemIds],
    };
  }

  private async compensateLegWithProvider(
    tx: DbTx,
    intent: LockedIntent,
    leg: PaymentLeg,
    operation: 'CANCEL' | 'REFUND',
    correlationId: string,
    reason: TerminationReason,
  ): Promise<CompensationLegResult> {
    const attempt = await this.createAttempt(tx, {
      intentId: intent.id,
      legId: leg.id,
      operation,
      correlationId,
      triggeredById: intent.customerId,
    });

    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      'SENT',
      {
        correlationId,
        causationId: leg.id,
        reasonCode: `PROVIDER_${operation}_REQUEST_SENT`,
        reasonMessage: `Provider ${operation} request sent`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      'CREATED',
      tx,
    );

    const requestedStatus = operation === 'CANCEL' ? 'CANCEL_REQUESTED' : 'REFUND_REQUESTED';
    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      requestedStatus,
      {
        correlationId,
        causationId: leg.id,
        reasonCode: `PROVIDER_${operation}_REQUEST_ACCEPTED`,
        reasonMessage: `${operation} request accepted for provider call`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      'SENT',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      leg.id,
      'CANCELING',
      {
        correlationId,
        reasonCode:
          reason === 'CANCEL'
            ? `LEG_${operation}_STARTED`
            : reason === 'SUPERSEDE'
              ? `LEG_SUPERSEDE_${operation}`
              : `LEG_EXPIRE_${operation}`,
        reasonMessage:
          reason === 'CANCEL'
            ? `${operation} compensation started`
            : reason === 'SUPERSEDE'
              ? `${operation} compensation started for supersede`
              : `${operation} compensation started for expiration`,
        triggeredByType: 'SYSTEM',
        triggeredById: intent.customerId,
        payload: {
          operation,
          terminationReason: reason,
        },
      },
      leg.status,
      tx,
    );

    try {
      const provider = this.providerRegistry.assertCapability(leg.providerType, operation, {
        intentId: intent.id,
        legId: leg.id,
      });

      const providerResult =
        operation === 'CANCEL'
          ? await provider.cancel({
              intentId: intent.id,
              legId: leg.id,
              attemptId: attempt.id,
              amount: leg.amount,
              currency: intent.currency,
              customerId: intent.customerId,
              correlationId,
              metadata: leg.metadata,
            })
          : await provider.refund({
              intentId: intent.id,
              legId: leg.id,
              attemptId: attempt.id,
              amount: leg.amount,
              currency: intent.currency,
              customerId: intent.customerId,
              correlationId,
              metadata: leg.metadata,
            });

      await this.persistProviderAttemptResult(tx, attempt.id, providerResult);

      const successStatus =
        operation === 'CANCEL' ? ('CANCELLED' as const) : ('REFUNDED' as const);
      const isSuccess = providerResult.resultStatus === successStatus;

      if (!isSuccess) {
        await this.persistProviderAttemptFailure(
          tx,
          attempt.id,
          `PROVIDER_${operation}_FAILED`,
          `${operation} returned unexpected status ${providerResult.resultStatus}`,
        );
        await this.stateTransitionService.transitionAttempt(
          attempt.id,
          'FAILED_FINAL',
          {
            correlationId,
            causationId: leg.id,
            reasonCode: `PROVIDER_${operation}_FAILED`,
            reasonMessage: `${operation} returned unexpected status ${providerResult.resultStatus}`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation,
              providerResultStatus: providerResult.resultStatus,
              terminationReason: reason,
            },
          },
          requestedStatus,
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          leg.id,
          'RECONCILE_REQUIRED',
          {
            correlationId,
            reasonCode: `LEG_${operation}_FAILED`,
            reasonMessage: `${operation} returned unexpected status ${providerResult.resultStatus}`,
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              operation,
              providerResultStatus: providerResult.resultStatus,
              terminationReason: reason,
            },
          },
          'CANCELING',
          tx,
        );
        const queueItemId = await this.upsertManualQueueItem(tx, {
          intentId: intent.id,
          legId: leg.id,
          actionType: operation,
          correlationId,
          requestedBy: intent.customerId,
          reasonCode: `LEG_${operation}_FAILED`,
          reasonMessage: `${operation} returned unexpected status ${providerResult.resultStatus}`,
        });
        return { failed: true, manualQueueItemId: queueItemId };
      }

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        successStatus,
        {
          correlationId,
          causationId: leg.id,
          reasonCode: `PROVIDER_${operation}_SUCCEEDED`,
          reasonMessage: `${operation} compensation succeeded`,
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation,
            providerTransactionId: providerResult.providerTransactionId,
            terminationReason: reason,
          },
        },
        requestedStatus,
        tx,
      );

      await this.stateTransitionService.transitionLeg(
        leg.id,
        successStatus,
        {
          correlationId,
          reasonCode: `LEG_${operation}_SUCCEEDED`,
          reasonMessage: `${operation} compensation succeeded`,
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation,
            providerTransactionId: providerResult.providerTransactionId,
            terminationReason: reason,
          },
        },
        'CANCELING',
        tx,
      );

      return { failed: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : `${operation} provider call failed`;
      await this.persistProviderAttemptFailure(
        tx,
        attempt.id,
        `PROVIDER_${operation}_FAILED`,
        errorMessage,
      );
      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'FAILED_RETRYABLE',
        {
          correlationId,
          causationId: leg.id,
          reasonCode: `PROVIDER_${operation}_FAILED`,
          reasonMessage: errorMessage,
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation,
            terminationReason: reason,
          },
        },
        requestedStatus,
        tx,
      );

      await this.stateTransitionService.transitionLeg(
        leg.id,
        'RECONCILE_REQUIRED',
        {
          correlationId,
          reasonCode: `LEG_${operation}_FAILED`,
          reasonMessage: errorMessage,
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            operation,
            terminationReason: reason,
          },
        },
        'CANCELING',
        tx,
      );

      const queueItemId = await this.upsertManualQueueItem(tx, {
        intentId: intent.id,
        legId: leg.id,
        actionType: operation,
        correlationId,
        requestedBy: intent.customerId,
        reasonCode: `LEG_${operation}_FAILED`,
        reasonMessage: errorMessage,
      });

      return { failed: true, manualQueueItemId: queueItemId };
    }
  }

  private async executeRefundAllocation(
    tx: DbTx,
    input: {
      intent: {
        id: string;
        customerId: string;
        currency: string;
      };
      leg: LockedLeg;
      allocationAmount: number;
      shouldFullyRefundLeg: boolean;
      correlationId: string;
      requestedBy: string;
      reasonCode: string;
      reasonMessage?: string;
    },
  ): Promise<{ failed: boolean; manualQueueItemId?: string }> {
    const {
      intent,
      leg,
      allocationAmount,
      shouldFullyRefundLeg,
      correlationId,
      requestedBy,
      reasonCode,
      reasonMessage,
    } = input;

    const attempt = await this.createAttempt(tx, {
      intentId: intent.id,
      legId: leg.id,
      operation: 'REFUND',
      correlationId,
      triggeredById: requestedBy,
    });

    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      'SENT',
      {
        correlationId,
        causationId: leg.id,
        reasonCode: 'PROVIDER_REFUND_REQUEST_SENT',
        reasonMessage: 'Provider refund request sent',
        triggeredByType: 'SYSTEM',
        triggeredById: requestedBy,
        payload: {
          operation: 'REFUND',
          amount: allocationAmount,
        },
      },
      'CREATED',
      tx,
    );

    await this.stateTransitionService.transitionAttempt(
      attempt.id,
      'REFUND_REQUESTED',
      {
        correlationId,
        causationId: leg.id,
        reasonCode: 'PROVIDER_REFUND_REQUEST_ACCEPTED',
        reasonMessage: 'Provider refund request accepted',
        triggeredByType: 'SYSTEM',
        triggeredById: requestedBy,
        payload: {
          operation: 'REFUND',
          amount: allocationAmount,
        },
      },
      'SENT',
      tx,
    );

    try {
      const provider = this.providerRegistry.assertCapability(leg.providerType, 'REFUND', {
        intentId: intent.id,
        legId: leg.id,
      });

      const providerResult = await provider.refund({
        intentId: intent.id,
        legId: leg.id,
        attemptId: attempt.id,
        amount: allocationAmount,
        currency: intent.currency,
        customerId: intent.customerId,
        correlationId,
        metadata: leg.metadata,
      });

      await this.persistProviderAttemptResult(tx, attempt.id, providerResult);

      if (providerResult.resultStatus !== 'REFUNDED') {
        const queueItemId = await this.markRefundFailureForLeg(tx, {
          intentId: intent.id,
          legId: leg.id,
          attemptId: attempt.id,
          correlationId,
          requestedBy,
          reasonCode: 'PROVIDER_REFUND_FAILED',
          reasonMessage: `Unexpected provider refund status: ${providerResult.resultStatus}`,
        });
        return { failed: true, manualQueueItemId: queueItemId };
      }

      await this.stateTransitionService.transitionAttempt(
        attempt.id,
        'REFUNDED',
        {
          correlationId,
          causationId: leg.id,
          reasonCode: 'PROVIDER_REFUND_SUCCEEDED',
          reasonMessage: 'Provider refund succeeded',
          triggeredByType: 'SYSTEM',
          triggeredById: requestedBy,
          payload: {
            operation: 'REFUND',
            amount: allocationAmount,
            providerTransactionId: providerResult.providerTransactionId,
          },
        },
        'REFUND_REQUESTED',
        tx,
      );

      if (shouldFullyRefundLeg) {
        await this.stateTransitionService.transitionLeg(
          leg.id,
          'REFUNDING',
          {
            correlationId,
            reasonCode: 'LEG_REFUNDING_STARTED',
            reasonMessage: 'Leg refunding started',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              operation: 'REFUND',
              amount: allocationAmount,
            },
          },
          'CAPTURED',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          leg.id,
          'REFUNDED',
          {
            correlationId,
            reasonCode: 'LEG_REFUNDED',
            reasonMessage: 'Leg refunded',
            triggeredByType: 'SYSTEM',
            triggeredById: requestedBy,
            payload: {
              operation: 'REFUND',
              amount: allocationAmount,
              reasonCode,
              reasonMessage: reasonMessage ?? null,
            },
          },
          'REFUNDING',
          tx,
        );
      }

      return { failed: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Provider refund call failed';
      const queueItemId = await this.markRefundFailureForLeg(tx, {
        intentId: intent.id,
        legId: leg.id,
        attemptId: attempt.id,
        correlationId,
        requestedBy,
        reasonCode: 'PROVIDER_REFUND_FAILED',
        reasonMessage: errorMessage,
      });
      return { failed: true, manualQueueItemId: queueItemId };
    }
  }

  private async markRefundFailureForLeg(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      attemptId: string;
      correlationId: string;
      requestedBy: string;
      reasonCode: string;
      reasonMessage: string;
    },
  ): Promise<string> {
    await this.persistProviderAttemptFailure(
      tx,
      input.attemptId,
      input.reasonCode,
      input.reasonMessage,
    );

    await this.stateTransitionService.transitionAttempt(
      input.attemptId,
      'FAILED_RETRYABLE',
      {
        correlationId: input.correlationId,
        causationId: input.legId,
        reasonCode: input.reasonCode,
        reasonMessage: input.reasonMessage,
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
        },
      },
      'REFUND_REQUESTED',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      input.legId,
      'REFUNDING',
      {
        correlationId: input.correlationId,
        reasonCode: 'LEG_REFUNDING_STARTED',
        reasonMessage: 'Leg refunding started',
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
        },
      },
      'CAPTURED',
      tx,
    );

    await this.stateTransitionService.transitionLeg(
      input.legId,
      'RECONCILE_REQUIRED',
      {
        correlationId: input.correlationId,
        reasonCode: 'LEG_REFUND_FAILED',
        reasonMessage: input.reasonMessage,
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        payload: {
          operation: 'REFUND',
          reasonCode: input.reasonCode,
        },
      },
      'REFUNDING',
      tx,
    );

    return this.upsertManualQueueItem(tx, {
      intentId: input.intentId,
      legId: input.legId,
      actionType: 'REFUND',
      correlationId: input.correlationId,
      requestedBy: input.requestedBy,
      reasonCode: input.reasonCode,
      reasonMessage: input.reasonMessage,
    });
  }

  private async upsertManualQueueItem(
    tx: DbTx,
    input: {
      intentId: string;
      legId: string;
      actionType: 'CANCEL' | 'REFUND' | 'MANUAL_CONFIRM';
      correlationId: string;
      requestedBy: string;
      reasonCode: string;
      reasonMessage: string;
    },
  ): Promise<string> {
    const existingOpenItems = await tx
      .select({
        id: manualCancelQueueItems.id,
      })
      .from(manualCancelQueueItems)
      .where(
        and(
          eq(manualCancelQueueItems.intentId, input.intentId),
          eq(manualCancelQueueItems.legId, input.legId),
          inArray(manualCancelQueueItems.status, OPEN_MANUAL_QUEUE_STATUSES),
        ),
      )
      .limit(1);

    const existing = existingOpenItems[0];
    if (existing) {
      await tx
        .update(manualCancelQueueItems)
        .set({
          actionType: input.actionType,
          reasonCode: input.reasonCode,
          reasonMessage: input.reasonMessage,
          lastErrorCode: input.reasonCode,
          lastErrorMessage: input.reasonMessage,
          retryCount: sql`${manualCancelQueueItems.retryCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(manualCancelQueueItems.id, existing.id));
      return existing.id;
    }

    try {
      const insertedItems = await tx
        .insert(manualCancelQueueItems)
        .values({
          intentId: input.intentId,
          legId: input.legId,
          actionType: input.actionType,
          status: 'QUEUED',
          reasonCode: input.reasonCode,
          reasonMessage: input.reasonMessage,
          priority: 'normal',
          retryCount: 0,
          lastErrorCode: input.reasonCode,
          lastErrorMessage: input.reasonMessage,
        })
        .returning({
          id: manualCancelQueueItems.id,
        });

      const inserted = insertedItems[0];
      if (!inserted) {
        throw new Error('MANUAL_QUEUE_INSERT_FAILED');
      }

      await tx.insert(paymentStateTransitions).values({
        entityType: 'MANUAL_CANCEL_QUEUE_ITEM',
        entityId: inserted.id,
        previousStatus: null,
        newStatus: 'QUEUED',
        reasonCode: 'MANUAL_QUEUE_ITEM_CREATED',
        reasonMessage: 'Manual queue item created for reconcile',
        triggeredByType: 'SYSTEM',
        triggeredById: input.requestedBy,
        correlationId: input.correlationId,
        occurredAt: new Date(),
        payload: {
          intentId: input.intentId,
          legId: input.legId,
          actionType: input.actionType,
        },
      });

      return inserted.id;
    } catch (error) {
      if (!isOpenManualQueueUniqueViolation(error)) {
        throw error;
      }

      const conflictOpenItems = await tx
        .select({
          id: manualCancelQueueItems.id,
        })
        .from(manualCancelQueueItems)
        .where(
          and(
            eq(manualCancelQueueItems.intentId, input.intentId),
            eq(manualCancelQueueItems.legId, input.legId),
            inArray(manualCancelQueueItems.status, OPEN_MANUAL_QUEUE_STATUSES),
          ),
        )
        .limit(1);

      const conflictItem = conflictOpenItems[0];
      if (!conflictItem) {
        throw error;
      }

      await tx
        .update(manualCancelQueueItems)
        .set({
          actionType: input.actionType,
          reasonCode: input.reasonCode,
          reasonMessage: input.reasonMessage,
          lastErrorCode: input.reasonCode,
          lastErrorMessage: input.reasonMessage,
          retryCount: sql`${manualCancelQueueItems.retryCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(manualCancelQueueItems.id, conflictItem.id));

      return conflictItem.id;
    }
  }

  private async applyAuthorizeResult(
    tx: DbTx,
    context: {
      intentId: string;
      legId: string;
      attemptId: string;
      customerId: string;
    },
    providerResult: ProviderOperationResult,
    correlationId: string,
  ): Promise<void> {
    switch (providerResult.resultStatus) {
      case 'AUTHORIZED': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_SUCCEEDED',
            reasonMessage: 'Provider authorize succeeded',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_AUTHORIZED',
            reasonMessage: 'Leg authorize completed',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'CAPTURED': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'CAPTURED',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_CAPTURED',
            reasonMessage: 'Provider authorize returned captured',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'AUTHORIZED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_AUTHORIZED',
            reasonMessage: 'Authorize step completed before auto-capture',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'CAPTURED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_CAPTURED',
            reasonMessage: 'Authorize path auto-captured leg',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              autoCaptured: true,
            },
          },
          'AUTHORIZED',
          tx,
        );

        await this.reconcileIntentAfterCapture(
          context.intentId,
          correlationId,
          context.attemptId,
          tx,
        );
        return;
      }
      case 'REQUIRES_CUSTOMER_ACTION': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'REQUIRES_ACTION',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_REQUIRES_ACTION',
            reasonMessage: 'Provider authorize requires customer action',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              nextAction: providerResult.nextAction ?? null,
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'REQUIRES_CUSTOMER_ACTION',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_REQUIRES_CUSTOMER_ACTION',
            reasonMessage: 'Leg requires customer action',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              nextAction: providerResult.nextAction ?? null,
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'REQUIRES_ADMIN_CONFIRMATION': {
        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'REQUIRES_ACTION',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_REQUIRES_ADMIN_CONFIRMATION',
            reasonMessage: 'Provider authorize requires admin confirmation',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'REQUIRES_ADMIN_CONFIRMATION',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'LEG_REQUIRES_ADMIN_CONFIRMATION',
            reasonMessage: 'Leg requires admin confirmation',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
        return;
      }
      case 'FAILED':
      default: {
        await this.persistProviderAttemptFailure(
          tx,
          context.attemptId,
          'PROVIDER_AUTHORIZE_FAILED',
          `Provider authorize returned failed status: ${providerResult.resultStatus}`,
        );

        await this.stateTransitionService.transitionAttempt(
          context.attemptId,
          'FAILED_FINAL',
          {
            correlationId,
            causationId: context.legId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: `Provider authorize returned failed status: ${providerResult.resultStatus}`,
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
              providerResultStatus: providerResult.resultStatus,
            },
          },
          'SENT',
          tx,
        );

        await this.stateTransitionService.transitionLeg(
          context.legId,
          'FAILED',
          {
            correlationId,
            causationId: context.attemptId,
            reasonCode: 'PROVIDER_AUTHORIZE_FAILED',
            reasonMessage: 'Leg authorize failed',
            triggeredByType: 'SYSTEM',
            triggeredById: context.customerId,
            payload: {
              operation: 'AUTHORIZE',
            },
          },
          'PROCESSING',
          tx,
        );
      }
    }
  }

  private async reconcileIntentAfterCapture(
    intentId: string,
    correlationId: string,
    causationId: string,
    tx: DbTx,
  ): Promise<void> {
    const intent = await this.lockIntentOrThrow(intentId, tx);
    const legRows = await tx
      .select({
        status: paymentLegs.status,
        isRequired: paymentLegs.isRequired,
      })
      .from(paymentLegs)
      .where(eq(paymentLegs.intentId, intentId));

    const requiredLegs = legRows.filter((row) => row.isRequired);
    const hasCapturedLeg = legRows.some((row) => row.status === 'CAPTURED');

    if (!hasCapturedLeg) {
      return;
    }

    const allRequiredCaptured =
      requiredLegs.length > 0 &&
      requiredLegs.every((row) => row.status === 'CAPTURED');

    if (allRequiredCaptured) {
      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'IN_PROGRESS',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_PROGRESS',
            reasonMessage: 'Intent moved to IN_PROGRESS before success',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'capture',
            },
          },
          'PENDING',
          tx,
        );
      }

      if (intent.status === 'IN_PROGRESS' || intent.status === 'PARTIALLY_CAPTURED') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'SUCCEEDED',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_SUCCEEDED',
            reasonMessage: 'All required legs captured',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'all_required_legs_captured',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentSucceeded',
              'SUCCEEDED',
            ),
          },
          intent.status,
          tx,
        );
      }

      if (intent.status === 'PENDING') {
        await this.stateTransitionService.transitionIntent(
          intentId,
          'SUCCEEDED',
          {
            correlationId,
            causationId,
            reasonCode: 'INTENT_CAPTURE_SUCCEEDED',
            reasonMessage: 'All required legs captured',
            triggeredByType: 'SYSTEM',
            triggeredById: intent.customerId,
            payload: {
              reason: 'all_required_legs_captured',
            },
            outboxEvent: this.buildPaymentIntentOutboxEvent(
              intent,
              'PaymentIntentSucceeded',
              'SUCCEEDED',
            ),
          },
          'IN_PROGRESS',
          tx,
        );
      }

      return;
    }

    if (intent.status === 'PENDING') {
      await this.stateTransitionService.transitionIntent(
        intentId,
        'IN_PROGRESS',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_CAPTURE_PROGRESS',
          reasonMessage: 'Intent moved to IN_PROGRESS before partial capture',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'capture',
          },
        },
        'PENDING',
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        intentId,
        'PARTIALLY_CAPTURED',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_PARTIALLY_CAPTURED',
          reasonMessage: 'Some required legs captured',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'partial_capture',
          },
        },
        'IN_PROGRESS',
        tx,
      );
      return;
    }

    if (intent.status === 'IN_PROGRESS') {
      await this.stateTransitionService.transitionIntent(
        intentId,
        'PARTIALLY_CAPTURED',
        {
          correlationId,
          causationId,
          reasonCode: 'INTENT_PARTIALLY_CAPTURED',
          reasonMessage: 'Some required legs captured',
          triggeredByType: 'SYSTEM',
          triggeredById: intent.customerId,
          payload: {
            reason: 'partial_capture',
          },
        },
        'IN_PROGRESS',
        tx,
      );
    }
  }

  private async createAttempt(
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

    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        intentId: input.intentId,
        legId: input.legId,
        attemptNo: nextAttemptNo,
        status: 'CREATED',
        requestPayload: {
          operation: input.operation,
        },
      })
      .returning();

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

  private async persistProviderAttemptResult(
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

  private async persistProviderAttemptFailure(
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

  private async readLegOperationResult(
    tx: DbTx,
    intentId: string,
    legId: string,
    attemptId: string,
  ): Promise<LegOperationResult> {
    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1);
    const [leg] = await tx
      .select()
      .from(paymentLegs)
      .where(and(eq(paymentLegs.id, legId), eq(paymentLegs.intentId, intentId)))
      .limit(1);
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId))
      .limit(1);

    if (!intent) {
      throw new Error(`INTENT_NOT_FOUND: ${intentId}`);
    }
    if (!leg) {
      throw new Error(`LEG_NOT_FOUND: ${legId}`);
    }
    if (!attempt) {
      throw new Error(`ATTEMPT_NOT_FOUND: ${attemptId}`);
    }

    return { intent, leg, attempt };
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
      payload: {
        intentId: intent.id,
        referenceType: intent.referenceType,
        referenceId: intent.referenceId,
        customerId: intent.customerId,
        status,
        payableAmount: intent.payableAmount,
        currency: intent.currency,
        ...extraPayload,
        occurredAt:
          typeof extraPayload.occurredAt === 'string'
            ? extraPayload.occurredAt
            : new Date().toISOString(),
      },
    };
  }

  private toOutboxInsertValues(event: OutboxEventInput): typeof outboxEvents.$inferInsert {
    const now = new Date();
    return {
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      partitionKey: event.partitionKey ?? event.aggregateId,
      payload: event.payload,
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async lockIntentOrThrow(intentId: string, tx: DbTx): Promise<LockedIntent> {
    const rows = (await tx.execute(sql`
      select
        id,
        reference_type as "referenceType",
        reference_id as "referenceId",
        customer_id as "customerId",
        currency,
        payable_amount as "payableAmount",
        expires_at as "expiresAt",
        status,
        version
      from payment_intents
      where id = ${intentId}
      for update
    `)) as unknown as Array<
      Omit<LockedIntent, 'expiresAt'> & {
        expiresAt: Date | string | number | null;
      }
    >;

    const intent = rows[0];
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }

    const expiresAt = new Date(intent.expiresAt ?? Number.NaN);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error(`INTENT_EXPIRES_AT_INVALID: ${intentId}`);
    }

    return {
      ...intent,
      expiresAt,
    };
  }

  private async lockLegOrThrow(
    intentId: string,
    legId: string,
    tx: DbTx,
  ): Promise<LockedLeg> {
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        provider_type as "providerType",
        amount,
        status,
        version,
        metadata
      from payment_legs
      where intent_id = ${intentId}
        and id = ${legId}
      for update
    `)) as unknown as LockedLeg[];

    const leg = rows[0];
    if (!leg) {
      throw new NotFoundException({
        error: 'LEG_NOT_FOUND',
        message: `Payment leg not found: ${legId}`,
      });
    }

    return leg;
  }

  private async lockIntentForRefundOrThrow(
    intentId: string,
    tx: DbTx,
  ): Promise<LockedIntent> {
    const intent = await this.lockIntentOrThrow(intentId, tx);

    if (intent.status !== 'PARTIALLY_CAPTURED' && intent.status !== 'SUCCEEDED') {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_REFUND',
        message: `Intent status ${intent.status} cannot request refund`,
      });
    }

    return intent;
  }

  private async lockLegsForRefund(
    intentId: string,
    legIds: string[],
    tx: DbTx,
  ): Promise<LockedLeg[]> {
    if (legIds.length === 0) {
      return [];
    }

    const legIdBindings = legIds.map((id) => sql`${id}`);
    const rows = (await tx.execute(sql`
      select
        id,
        intent_id as "intentId",
        provider_type as "providerType",
        amount,
        status,
        version,
        metadata
      from payment_legs
      where intent_id = ${intentId}
        and id in (${sql.join(legIdBindings, sql`, `)})
      for update
    `)) as unknown as LockedLeg[];

    return rows;
  }

  private async readRefundedAmountByLegId(
    intentId: string,
    legIds: string[],
    tx: DbTx,
  ): Promise<Map<string, number>> {
    if (legIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await tx
      .select({
        legId: refundAllocations.legId,
        refundedAmount: sql<number>`coalesce(sum(${refundAllocations.amount}), 0)`,
      })
      .from(refundAllocations)
      .innerJoin(
        refundRequests,
        eq(refundAllocations.refundRequestId, refundRequests.id),
      )
      .where(
        and(
          eq(refundAllocations.intentId, intentId),
          inArray(refundAllocations.legId, legIds),
          inArray(refundRequests.status, REFUND_LIMIT_BLOCKING_STATUSES),
        ),
      )
      .groupBy(refundAllocations.legId);

    const refundedByLegId = new Map<string, number>();
    for (const row of rows) {
      refundedByLegId.set(row.legId, Number(row.refundedAmount ?? 0));
    }

    return refundedByLegId;
  }

  private resolveExpirationBatchSize(limit?: number): number {
    const parsed =
      limit ?? Number(process.env.WALLET_EXPIRATION_BATCH_SIZE ?? '50');

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 50;
    }

    return Math.floor(parsed);
  }

  private isExpirationSkippableConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) {
      return false;
    }

    const response = error.getResponse();
    const errorCode =
      typeof response === 'object' && response && 'error' in response
        ? (response as { error?: string }).error
        : undefined;

    return (
      errorCode === 'INTENT_STATE_INVALID_FOR_EXPIRE' ||
      errorCode === 'INTENT_NOT_EXPIRED'
    );
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

  private assertIntentCanExecuteLeg(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_NOT_ACTIVE',
        message: `Intent status ${status} is not checkout-active`,
      });
    }
  }

  private assertIntentCanCancel(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_CANCEL',
        message: `Intent status ${status} cannot be cancelled`,
      });
    }
  }

  private assertIntentCanSupersede(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_SUPERSEDE',
        message: `Intent status ${status} cannot be superseded`,
      });
    }
  }

  private assertIntentCanExpire(status: PaymentIntentStatus): void {
    if (
      status !== 'PENDING' &&
      status !== 'IN_PROGRESS' &&
      status !== 'PARTIALLY_CAPTURED'
    ) {
      throw new ConflictException({
        error: 'INTENT_STATE_INVALID_FOR_EXPIRE',
        message: `Intent status ${status} cannot be expired`,
      });
    }
  }

  private assertLegStatus(
    currentStatus: PaymentLegStatus,
    expectedStatus: PaymentLegStatus,
    legId: string,
    operation: string,
  ): void {
    if (currentStatus !== expectedStatus) {
      throw new ConflictException({
        error: 'LEG_STATE_INVALID',
        message: `Leg ${legId} is not ${expectedStatus} for ${operation}: current=${currentStatus}`,
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

function isOpenManualQueueUniqueViolation(error: unknown): boolean {
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
    current.constraint === 'uq_manual_cancel_queue_open_intent_leg'
  ) {
    return true;
  }

  if ((current.message ?? '').includes('uq_manual_cancel_queue_open_intent_leg')) {
    return true;
  }

  if (current.cause) {
    return isOpenManualQueueUniqueViolation(current.cause);
  }

  if (current.originalError) {
    return isOpenManualQueueUniqueViolation(current.originalError);
  }

  return false;
}
