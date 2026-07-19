import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  WALLET_COMMAND_STREAM,
  type WalletCommandEvents,
  type BillingChargePayload,
  type CreateInvoicePayload,
  type VoidInvoicePayload,
} from '@packages/event-contracts/streams/wallet-command.stream';

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

  /** ADR-0027 §4-1. 인보이스 생성 커맨드 — 주기당 1 멱등키라 재발행은 wallet 이 dedupe 한다. */
  async publishCreateInvoice(payload: Omit<CreateInvoicePayload, 'requestedAt'>): Promise<void> {
    const event: CreateInvoicePayload = {
      ...payload,
      requestedAt: new Date().toISOString(),
    };

    await this.publisher.publishEvent({
      eventType: 'CreateInvoice',
      aggregateId: payload.subscriberRef,
      payload: event,
    });

    this.logger.log(
      `CreateInvoice published: subscriberRef=${payload.subscriberRef}, period=${payload.periodStart}~${payload.periodEnd}`,
    );
  }

  /** ADR-0027 §4-1. 구독 취소/해지 시 열린 인보이스 무효화. */
  async publishVoidInvoice(payload: Omit<VoidInvoicePayload, 'requestedAt'>): Promise<void> {
    const event: VoidInvoicePayload = {
      ...payload,
      requestedAt: new Date().toISOString(),
    };

    await this.publisher.publishEvent({
      eventType: 'VoidInvoice',
      aggregateId: payload.subscriberRef,
      payload: event,
    });

    this.logger.log(`VoidInvoice published: subscriberRef=${payload.subscriberRef}, reason=${payload.reason}`);
  }
}
