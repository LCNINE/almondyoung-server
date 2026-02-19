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
} from '@packages/event-contracts';
import { DomainCommand } from '@packages/event-contracts/types';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';
import { IntentsService } from '../intents/intents.service';
import { ReconcileService } from '../reconcile/reconcile.service';

const COMMANDS_TOPIC = PAYMENTS_COMMANDS_V1_STREAM.topic.topic;

@Controller()
@Public()
@UseInterceptors(EventTypeGuard)
export class PaymentsCommandConsumer {
  private readonly logger = new Logger(PaymentsCommandConsumer.name);

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
    if (this.shouldSkip(envelope, commandType)) {
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
        this.resolveErrorResponseBody(error),
      );
      throw error;
    }
  }

  private shouldSkip(envelope: DomainCommand<unknown>, commandType: string): boolean {
    if (envelope.messageKind !== 'command') {
      this.logger.warn(
        `Ignoring non-command message on command handler: type=${commandType}, kind=${envelope.messageKind}`,
      );
      return true;
    }

    if (!envelope.expiresAt) {
      return false;
    }

    const expiresAtMs = Date.parse(envelope.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      this.logger.warn(
        `Ignoring command with invalid expiresAt: type=${commandType}, expiresAt=${envelope.expiresAt}`,
      );
      return true;
    }

    if (expiresAtMs < Date.now()) {
      this.logger.warn(
        `Ignoring expired command: type=${commandType}, expiresAt=${envelope.expiresAt}`,
      );
      return true;
    }

    return false;
  }

  private resolveErrorStatusCode(error: unknown): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }
    return 500;
  }

  private resolveErrorResponseBody(error: unknown): unknown {
    if (error instanceof HttpException) {
      return error.getResponse();
    }

    if (error instanceof Error) {
      return {
        error: 'COMMAND_PROCESS_FAILED',
        message: error.message,
      };
    }

    return {
      error: 'COMMAND_PROCESS_FAILED',
      message: 'Unhandled command processing error',
    };
  }
}
