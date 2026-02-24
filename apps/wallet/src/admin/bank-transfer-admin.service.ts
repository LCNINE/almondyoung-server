import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq } from 'drizzle-orm';
import { WalletSchema, charges, paymentIntents, paymentMethods } from '../schema';
import { ChargesService } from '../charges/charges.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';

@Injectable()
export class BankTransferAdminService {
  private readonly logger = new Logger(BankTransferAdminService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async getPendingTransfers(): Promise<Array<typeof paymentIntents.$inferSelect>> {
    return this.dbService.db
      .select({
        id: paymentIntents.id,
        payableAmount: paymentIntents.payableAmount,
        currency: paymentIntents.currency,
        status: paymentIntents.status,
        userId: paymentIntents.userId,
        paymentMethodId: paymentIntents.paymentMethodId,
        clientSecret: paymentIntents.clientSecret,
        returnUrl: paymentIntents.returnUrl,
        metadata: paymentIntents.metadata,
        expiresAt: paymentIntents.expiresAt,
        version: paymentIntents.version,
        createdAt: paymentIntents.createdAt,
        updatedAt: paymentIntents.updatedAt,
      })
      .from(paymentIntents)
      .innerJoin(paymentMethods, eq(paymentIntents.paymentMethodId, paymentMethods.id))
      .where(
        and(
          eq(paymentIntents.status, 'REQUIRES_ACTION'),
          eq(paymentMethods.type, 'BANK_TRANSFER'),
        ),
      )
      .orderBy(desc(paymentIntents.createdAt));
  }

  async confirmDeposit(intentId: string, depositorNote?: string): Promise<void> {
    this.logger.log(`confirmDeposit called: intentId=${intentId} depositorNote=${depositorNote}`);

    // 1. Find the REQUIRES_ACTION AUTHORIZE charge
    const charge = await this.chargesService.findActiveByIntentAndOperation(
      intentId,
      'AUTHORIZE',
    );
    this.logger.log(`charge found: ${JSON.stringify({ id: charge?.id, status: charge?.status })}`);
    if (!charge || charge.status !== 'REQUIRES_ACTION') {
      throw new UnprocessableEntityException({
        error: 'NO_REQUIRES_ACTION_CHARGE',
        message: 'No pending bank transfer action found for this intent',
      });
    }

    // 2. Load intent for outbox event payload
    const intent = await this.dbService.db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.id, intentId))
      .limit(1)
      .then((r) => r[0]);

    if (!intent) {
      throw new NotFoundException({ error: 'INTENT_NOT_FOUND' });
    }

    const correlationId = `bank-transfer-confirm:${intentId}:${Date.now()}`;
    const now = new Date().toISOString();

    // 3. Transaction: charge → SUCCEEDED, intent → SUCCEEDED + outbox event
    await this.dbService.db.transaction(async (tx) => {
      await this.chargesService.updateStatus(
        charge.id,
        'SUCCEEDED',
        {
          providerTransactionId: depositorNote ?? 'BANK_TRANSFER_CONFIRMED',
        },
        tx,
      );

      await this.stateTransitionService.transitionIntent(
        intentId,
        'SUCCEEDED',
        {
          correlationId,
          triggeredByType: 'ADMIN',
          reasonCode: 'BANK_TRANSFER_CONFIRMED',
          outboxEvent: {
            eventType: GatewayEventType.INTENT_SUCCEEDED,
            aggregateType: GATEWAY_AGGREGATE_TYPE,
            aggregateId: intent.id,
            payload: buildPaymentIntentEventPayload({
              intentId: intent.id,
              userId: intent.userId,
              status: 'SUCCEEDED',
              payableAmount: intent.payableAmount,
              currency: intent.currency,
              occurredAt: now,
            }),
          },
        },
        undefined,
        tx,
      );
    });

    this.logger.log(`confirmDeposit succeeded: intentId=${intentId}`);
  }
}
