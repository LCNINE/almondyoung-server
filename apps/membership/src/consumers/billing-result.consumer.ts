import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { membershipSchema } from '../shared/schemas/entities/schema';
import * as schema from '../shared/schemas/entities/schema';
import { eq, count } from 'drizzle-orm';
import { MessageEnvelope } from '@packages/event-contracts/types';

interface IntentEventPayload {
  intentId: string;
  payableAmount?: number;
  subscriberRef?: string;
  subscriberType?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Controller()
@UseInterceptors(EventTypeGuard)
export class BillingResultConsumer {
  private readonly logger = new Logger(BillingResultConsumer.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
  ) {}

  @OnEvent('payments.events.v1', 'payment.intent.authorized')
  async onIntentAuthorized(
    @EventPayload() payload: IntentEventPayload,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_SUCCESS: contractId=${contractId}, intentId=${payload.intentId}`);

    const attemptNo = await this.getNextAttemptNo(contractId);
    await this.dbService.db.insert(schema.billingEvents).values({
      contractId,
      eventType: 'CHARGE_SUCCESS',
      attemptNo,
      amount: payload.payableAmount ?? null,
    });
  }

  @OnEvent('payments.events.v1', 'payment.intent.failed')
  async onIntentFailed(
    @EventPayload() payload: IntentEventPayload,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_FAIL: contractId=${contractId}, errorCode=${payload.errorCode}`);

    const attemptNo = await this.getNextAttemptNo(contractId);
    await this.dbService.db.insert(schema.billingEvents).values({
      contractId,
      eventType: 'CHARGE_FAIL',
      attemptNo,
      amount: payload.payableAmount ?? null,
      errorCode: payload.errorCode ?? null,
      errorMessage: payload.errorMessage ?? null,
    });
  }

  private async getNextAttemptNo(contractId: string): Promise<number> {
    const [row] = await this.dbService.db
      .select({ count: count() })
      .from(schema.billingEvents)
      .where(eq(schema.billingEvents.contractId, contractId));
    return (Number(row?.count ?? 0)) + 1;
  }
}
