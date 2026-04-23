import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { WALLET_COMMAND_STREAM, type WalletCommandEvents, type BillingChargePayload } from '@packages/event-contracts/streams/wallet-command.stream';
import { randomUUID } from 'node:crypto';

@Injectable()
export class WalletCommandPublisher {
  private readonly logger = new Logger(WalletCommandPublisher.name);

  constructor(
    @InjectStreamPublisher(WALLET_COMMAND_STREAM.topic.topic)
    private readonly publisher: StreamPublisher<WalletCommandEvents>,
  ) {}

  async publishBillingCharge(payload: Omit<BillingChargePayload, 'idempotencyKey' | 'requestedAt'> & { idempotencyKey?: string }): Promise<void> {
    const event: BillingChargePayload = {
      ...payload,
      idempotencyKey: payload.idempotencyKey ?? randomUUID(),
      requestedAt: new Date().toISOString(),
    };

    await this.publisher.publishEvent({
      eventType: 'BillingCharge',
      aggregateId: payload.subscriberRef,
      payload: event,
    });

    this.logger.log(`BillingCharge published: subscriberRef=${payload.subscriberRef}, amount=${payload.amount}`);
  }
}
