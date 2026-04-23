import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import { WALLET_COMMAND_STREAM, type WalletCommandEvents, type BillingChargePayload } from '@packages/event-contracts/streams/wallet-command.stream';

@Injectable()
export class WalletCommandPublisher {
  private readonly logger = new Logger(WalletCommandPublisher.name);

  constructor(
    @InjectStreamPublisher(WALLET_COMMAND_STREAM.topic.topic)
    private readonly publisher: StreamPublisher<WalletCommandEvents>,
  ) {}

  async publishBillingCharge(payload: Omit<BillingChargePayload, 'requestedAt'>): Promise<void> {
    const event: BillingChargePayload = {
      ...payload,
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
