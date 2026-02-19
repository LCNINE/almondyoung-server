import { Controller, HttpException, Logger, UseInterceptors } from '@nestjs/common';
import { EventEnvelope, OnEvent } from '@app/events';
import { Public } from '@app/authorization';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  CancelPaymentIntentCommandPayload,
  CreatePaymentIntentCommandPayload,
  ExpirePaymentIntentCommandPayload,
  PAYMENTS_COMMANDS_V1_STREAM,
  RequestRefundCommandPayload,
  RetryReconcileCommandPayload,
  StartPaymentLegCommandPayload,
  SupersedePaymentIntentCommandPayload,
} from '@packages/event-contracts/streams/payments-v1.stream';
import { DomainCommand } from '@packages/event-contracts/types';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';
import { IntentsService } from '../intents/intents.service';
import { ReconcileService } from '../reconcile/reconcile.service';

const COMMANDS_TOPIC = PAYMENTS_COMMANDS_V1_STREAM.topic.topic;
const SUPPORTED_REFERENCE_TYPES = new Set([
  'STORE_ORDER',
  'SUBSCRIPTION_BILLING',
]);

type CommandSkipReason = 'NON_COMMAND' | 'INVALID_EXPIRES_AT' | 'EXPIRED';

@Controller()
@Public()
@UseInterceptors(EventTypeGuard)
export class PaymentsCommandConsumer {
  private readonly logger = new Logger(PaymentsCommandConsumer.name);
  private readonly skippedCommandCounters: Record<CommandSkipReason, number> = {
    NON_COMMAND: 0,
    INVALID_EXPIRES_AT: 0,
    EXPIRED: 0,
  };

  constructor(
    private readonly intentsService: IntentsService,
    private readonly reconcileService: ReconcileService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @OnEvent(COMMANDS_TOPIC, 'CreatePaymentIntent')
  async onCreatePaymentIntent(
    @EventEnvelope()
    envelope: DomainCommand<CreatePaymentIntentCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'CreatePaymentIntent', async () => {
      this.validateCreatePaymentIntentPayload(envelope.payload);
      await this.intentsService.createIntent(
        {
          referenceType: envelope.payload.referenceType,
          referenceId: envelope.payload.referenceId,
          customerId: envelope.payload.customerId,
          currency: envelope.payload.currency,
          payableAmount: envelope.payload.payableAmount,
          snapshotPayload: envelope.payload.snapshotPayload,
          signature: envelope.payload.signature,
          signatureVersion: envelope.payload.signatureVersion,
          signedAt: envelope.payload.signedAt,
          metadata: envelope.payload.metadata,
        },
        envelope.correlationId,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'StartPaymentLeg')
  async onStartPaymentLeg(
    @EventEnvelope()
    envelope: DomainCommand<StartPaymentLegCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'StartPaymentLeg', async () => {
      this.validateStartPaymentLegPayload(envelope.payload);
      if (envelope.payload.operation === 'CAPTURE') {
        await this.intentsService.captureLeg(
          envelope.payload.intentId,
          envelope.payload.legId,
          envelope.correlationId,
        );
        return;
      }

      await this.intentsService.authorizeLeg(
        envelope.payload.intentId,
        envelope.payload.legId,
        envelope.correlationId,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'CancelPaymentIntent')
  async onCancelPaymentIntent(
    @EventEnvelope()
    envelope: DomainCommand<CancelPaymentIntentCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'CancelPaymentIntent', async () => {
      this.validateIntentOnlyCommandPayload(envelope.payload);
      await this.intentsService.cancelIntent(
        envelope.payload.intentId,
        envelope.correlationId,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'ExpirePaymentIntent')
  async onExpirePaymentIntent(
    @EventEnvelope()
    envelope: DomainCommand<ExpirePaymentIntentCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'ExpirePaymentIntent', async () => {
      this.validateIntentOnlyCommandPayload(envelope.payload);
      await this.intentsService.expireIntent(
        envelope.payload.intentId,
        envelope.correlationId,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'SupersedePaymentIntent')
  async onSupersedePaymentIntent(
    @EventEnvelope()
    envelope: DomainCommand<SupersedePaymentIntentCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'SupersedePaymentIntent', async () => {
      this.validateIntentOnlyCommandPayload(envelope.payload);
      await this.intentsService.supersedeIntent(
        envelope.payload.intentId,
        envelope.correlationId,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'RequestRefund')
  async onRequestRefund(
    @EventEnvelope()
    envelope: DomainCommand<RequestRefundCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'RequestRefund', async () => {
      this.validateRequestRefundPayload(envelope.payload);
      await this.intentsService.createRefundRequest(
        envelope.payload.intentId,
        {
          refundAmount: envelope.payload.refundAmount,
          allocation: envelope.payload.allocation,
          reasonCode: envelope.payload.reasonCode,
          reasonMessage: envelope.payload.reasonMessage,
        },
        envelope.correlationId,
        envelope.payload.requestedBy,
      );
    });
  }

  @OnEvent(COMMANDS_TOPIC, 'RetryReconcile')
  async onRetryReconcile(
    @EventEnvelope()
    envelope: DomainCommand<RetryReconcileCommandPayload>,
  ): Promise<void> {
    await this.handleCommand(envelope, 'RetryReconcile', async () => {
      this.validateRetryReconcilePayload(envelope.payload);
      const retryInput = {
        reasonCode: envelope.payload.reasonCode,
        reasonMessage: envelope.payload.reasonMessage,
        actorId: envelope.payload.requestedBy,
        correlationId: envelope.correlationId,
      };

      if (envelope.payload.legId) {
        await this.reconcileService.retryLeg(envelope.payload.legId, retryInput);
        return;
      }

      if (!envelope.payload.intentId) {
        throw new Error('RetryReconcile requires intentId or legId');
      }

      await this.reconcileService.retryIntent(
        envelope.payload.intentId,
        retryInput,
      );
    });
  }

  private async handleCommand(
    envelope: DomainCommand<{
      idempotencyKey: string;
    }>,
    commandType: string,
    execute: () => Promise<void>,
  ): Promise<void> {
    const skipReason = this.resolveSkipReason(envelope);
    if (skipReason) {
      this.recordSkippedCommand(skipReason, commandType, envelope);
      return;
    }

    const idempotencyKey = envelope.payload.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new Error(`Missing idempotencyKey for command=${commandType}`);
    }

    const decision = await this.idempotencyService.beginCommandRequest({
      idempotencyKey,
      operation: commandType,
      requestBody: envelope.payload,
    });

    if (decision.kind === 'REPLAY') {
      this.logger.debug(
        `Skipping duplicate command: type=${commandType}, correlationId=${envelope.correlationId}`,
      );
      return;
    }

    try {
      await execute();
      await this.idempotencyService.completeSuccess(decision.recordId, 200, {
        commandType,
        status: 'PROCESSED',
      });
    } catch (error) {
      await this.idempotencyService.completeFailure(
        decision.recordId,
        this.resolveErrorStatusCode(error),
        this.resolveErrorResponseBody(error, commandType, envelope.correlationId),
      );
      throw error;
    }
  }

  private resolveSkipReason(
    envelope: DomainCommand<unknown>,
  ): CommandSkipReason | null {
    if (envelope.messageKind !== 'command') {
      return 'NON_COMMAND';
    }

    if (!envelope.expiresAt) {
      return null;
    }

    const expiresAtMs = Date.parse(envelope.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return 'INVALID_EXPIRES_AT';
    }

    if (expiresAtMs < Date.now()) {
      return 'EXPIRED';
    }

    return null;
  }

  private recordSkippedCommand(
    reason: CommandSkipReason,
    commandType: string,
    envelope: DomainCommand<unknown>,
  ): void {
    this.skippedCommandCounters[reason] += 1;

    this.logger.warn(
      `Skipping command: reason=${reason}, type=${commandType}, messageId=${envelope.messageId}, correlationId=${envelope.correlationId}, expiresAt=${envelope.expiresAt ?? 'none'}, skipCount=${this.skippedCommandCounters[reason]}`,
    );
  }

  private resolveErrorStatusCode(error: unknown): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }
    return 500;
  }

  private resolveErrorResponseBody(
    error: unknown,
    commandType: string,
    correlationId: string,
  ): unknown {
    const fallback = {
      error: 'COMMAND_PROCESS_FAILED',
      message: 'Unhandled command processing error',
      commandType,
      correlationId,
    };

    if (error instanceof HttpException) {
      const response = error.getResponse();
      const body =
        typeof response === 'string'
          ? { message: response }
          : ((response ?? {}) as Record<string, unknown>);

      const errorCode =
        typeof body.error === 'string' && body.error.trim().length > 0
          ? body.error
          : 'COMMAND_PROCESS_FAILED';
      const message =
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? body.message.join(', ')
            : error.message;

      return {
        error: errorCode,
        message,
        commandType,
        correlationId,
      };
    }

    if (error instanceof Error) {
      const [prefixedError] = error.message.split(':');
      const errorCode = prefixedError.startsWith('COMMAND_')
        ? prefixedError
        : 'COMMAND_PROCESS_FAILED';

      return {
        error: errorCode,
        message: error.message,
        commandType,
        correlationId,
      };
    }

    return fallback;
  }

  private validateCreatePaymentIntentPayload(
    payload: CreatePaymentIntentCommandPayload,
  ): void {
    this.assertRequiredCommonFields(payload);
    this.assertNonEmptyString('referenceId', payload.referenceId);
    this.assertNonEmptyString('customerId', payload.customerId);
    this.assertNonEmptyString('currency', payload.currency);
    this.assertNonEmptyString('signature', payload.signature);
    this.assertNonEmptyString('signatureVersion', payload.signatureVersion);
    this.assertNonEmptyString('signedAt', payload.signedAt);
    this.assertIntegerAmount('payableAmount', payload.payableAmount, {
      allowZero: true,
    });

    if (!SUPPORTED_REFERENCE_TYPES.has(payload.referenceType)) {
      throw new Error(
        `COMMAND_PAYLOAD_INVALID: unsupported referenceType=${payload.referenceType}`,
      );
    }

    if (!payload.snapshotPayload || typeof payload.snapshotPayload !== 'object') {
      throw new Error('COMMAND_PAYLOAD_INVALID: snapshotPayload must be an object');
    }
  }

  private validateStartPaymentLegPayload(
    payload: StartPaymentLegCommandPayload,
  ): void {
    this.assertRequiredCommonFields(payload);
    this.assertNonEmptyString('intentId', payload.intentId);
    this.assertNonEmptyString('legId', payload.legId);
    this.assertNonEmptyString('providerType', payload.providerType);
    this.assertIntegerAmount('amount', payload.amount, {
      allowZero: false,
    });

    if (payload.operation && payload.operation !== 'AUTHORIZE' && payload.operation !== 'CAPTURE') {
      throw new Error(`COMMAND_PAYLOAD_INVALID: unsupported operation=${payload.operation}`);
    }
  }

  private validateIntentOnlyCommandPayload(payload: {
    requestedBy: string;
    requestSource: string;
    idempotencyKey: string;
    intentId: string;
  }): void {
    this.assertRequiredCommonFields(payload);
    this.assertNonEmptyString('intentId', payload.intentId);
  }

  private validateRequestRefundPayload(payload: RequestRefundCommandPayload): void {
    this.assertRequiredCommonFields(payload);
    this.assertNonEmptyString('intentId', payload.intentId);
    this.assertNonEmptyString('reasonCode', payload.reasonCode);
    this.assertIntegerAmount('refundAmount', payload.refundAmount, {
      allowZero: false,
    });

    if (!Array.isArray(payload.allocation) || payload.allocation.length === 0) {
      throw new Error(
        'COMMAND_PAYLOAD_INVALID: allocation must contain at least one item',
      );
    }

    for (const item of payload.allocation) {
      this.assertNonEmptyString('allocation.legId', item.legId);
      this.assertIntegerAmount('allocation.amount', item.amount, {
        allowZero: false,
      });
    }
  }

  private validateRetryReconcilePayload(payload: RetryReconcileCommandPayload): void {
    this.assertRequiredCommonFields(payload);
    this.assertNonEmptyString('reasonCode', payload.reasonCode);

    const hasIntentId =
      typeof payload.intentId === 'string' && payload.intentId.trim().length > 0;
    const hasLegId = typeof payload.legId === 'string' && payload.legId.trim().length > 0;

    if (!hasIntentId && !hasLegId) {
      throw new Error('COMMAND_PAYLOAD_INVALID: RetryReconcile requires intentId or legId');
    }
  }

  private assertRequiredCommonFields(payload: {
    requestedBy: string;
    requestSource: string;
    idempotencyKey: string;
  }): void {
    this.assertNonEmptyString('requestedBy', payload.requestedBy);
    this.assertNonEmptyString('requestSource', payload.requestSource);
    this.assertNonEmptyString('idempotencyKey', payload.idempotencyKey);
  }

  private assertNonEmptyString(field: string, value: unknown): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`COMMAND_PAYLOAD_INVALID: ${field} must be a non-empty string`);
    }
  }

  private assertIntegerAmount(
    field: string,
    value: unknown,
    options: {
      allowZero: boolean;
    },
  ): void {
    if (!Number.isInteger(value)) {
      throw new Error(`COMMAND_PAYLOAD_INVALID: ${field} must be an integer`);
    }

    if (options.allowZero) {
      if ((value as number) < 0) {
        throw new Error(`COMMAND_PAYLOAD_INVALID: ${field} must be >= 0`);
      }
      return;
    }

    if ((value as number) <= 0) {
      throw new Error(`COMMAND_PAYLOAD_INVALID: ${field} must be > 0`);
    }
  }
}
