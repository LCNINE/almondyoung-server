import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { WalletSchema, charges, paymentIntents, paymentMethods } from '../schema';
import { ChargesService } from '../charges/charges.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import {
  GATEWAY_AGGREGATE_TYPE,
  GatewayEventType,
  buildPaymentIntentEventPayload,
} from '../messaging/gateway-event.builder';
import { PendingBankTransferResponseDto } from './dto/pending-bank-transfer.dto';

@Injectable()
export class BankTransferAdminService {
  private readonly logger = new Logger(BankTransferAdminService.name);

  constructor(
    private readonly dbService: DbService<WalletSchema>,
    private readonly chargesService: ChargesService,
    private readonly stateTransitionService: StateTransitionService,
  ) {}

  async getPendingTransfers(
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponseDto<PendingBankTransferResponseDto>> {
    const db = this.dbService.db;
    const offset = (page - 1) * limit;

    const condition = and(
      eq(paymentIntents.status, 'REQUIRES_ACTION'),
      eq(paymentMethods.type, 'BANK_TRANSFER'),
    );

    const [countResult] = await db
      .select({ value: count() })
      .from(paymentIntents)
      .innerJoin(paymentMethods, eq(paymentIntents.paymentMethodId, paymentMethods.id))
      .where(condition);

    const total = countResult?.value ?? 0;

    const rows = await db
      .select({
        id: paymentIntents.id,
        payableAmount: paymentIntents.payableAmount,
        currency: paymentIntents.currency,
        status: paymentIntents.status,
        userId: paymentIntents.userId,
        paymentMethodId: paymentIntents.paymentMethodId,
        expiresAt: paymentIntents.expiresAt,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .innerJoin(paymentMethods, eq(paymentIntents.paymentMethodId, paymentMethods.id))
      .where(condition)
      .orderBy(desc(paymentIntents.createdAt))
      .limit(limit)
      .offset(offset);

    const data: PendingBankTransferResponseDto[] = rows.map((r) => ({
      id: r.id,
      payableAmount: r.payableAmount,
      currency: r.currency,
      status: r.status,
      userId: r.userId,
      paymentMethodId: r.paymentMethodId,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));

    return { data, total, page, limit };
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
              userId: intent.userId ?? '',
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
