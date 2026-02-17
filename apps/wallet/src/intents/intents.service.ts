import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { CreateIntentDto } from './dto/create-intent.dto';
import { ConfigureLegsDto } from './dto/configure-legs.dto';
import {
  HmacVerificationError,
  verifyHmacIntegrity,
} from '../domain/hmac/hmac-integrity';
import {
  PaymentIntentStatus,
  PaymentLegStatus,
  WalletSchema,
  paymentAttempts,
  paymentIntents,
  paymentLegs,
  paymentStateTransitions,
} from '../schema';
import { DbTx, PaymentAttempt, PaymentIntent, PaymentLeg } from '../types';
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

interface LockedIntent {
  id: string;
  customerId: string;
  currency: string;
  payableAmount: number;
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

  private async lockIntentOrThrow(intentId: string, tx: DbTx): Promise<LockedIntent> {
    const rows = (await tx.execute(sql`
      select
        id,
        customer_id as "customerId",
        currency,
        payable_amount as "payableAmount",
        status,
        version
      from payment_intents
      where id = ${intentId}
      for update
    `)) as unknown as LockedIntent[];

    const intent = rows[0];
    if (!intent) {
      throw new NotFoundException({
        error: 'INTENT_NOT_FOUND',
        message: `Payment intent not found: ${intentId}`,
      });
    }

    return intent;
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
