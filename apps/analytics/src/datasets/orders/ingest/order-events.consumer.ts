import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { OrderAggregatesService } from '../aggregates/order-aggregates.service';
import { UserPurchaseAggregatesService } from '../aggregates/user-purchase-aggregates.service';
import { ChannelAggregatesService } from '../aggregates/channel-aggregates.service';
import { VariantAggregatesService } from '../aggregates/variant-aggregates.service';
import { CustomerLifetimeService } from '../aggregates/customer-lifetime.service';
import { OrderFactsService } from '../facts/order-facts.service';
import { DbTx } from '../../../db.types';
import { analyticsSchema } from '../../../schema';
import { DbService } from '@app/db';
import { ORDER_STREAM } from '@packages/event-contracts/streams/orders.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly orderFactsService: OrderFactsService,
    private readonly orderAggregatesService: OrderAggregatesService,
    private readonly userPurchaseAggregatesService: UserPurchaseAggregatesService,
    private readonly channelAggregatesService: ChannelAggregatesService,
    private readonly variantAggregatesService: VariantAggregatesService,
    private readonly customerLifetimeService: CustomerLifetimeService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  @On(ORDER_STREAM, 'OrderCreated')
  async onOrderCreated(
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderCreated'>,
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderCreated'>,
  ) {
    this.logger.log(`OrderCreated received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordOrderCreated(envelope, payload, tx);
      if (!result.claimed) {
        return;
      }
      await this.orderAggregatesService.applyOrderCreated(result.seeds, tx);
      await this.userPurchaseAggregatesService.applyOrderCreated(
        payload.customerId,
        payload.items,
        new Date(payload.createdAt),
        tx,
      );
      await this.variantAggregatesService.applyOrderCreated(result.variantSeeds, tx);
      if (result.channelSeed) {
        await this.channelAggregatesService.applyOrderCreated(result.channelSeed, tx);
      }
      if (result.customerSeed) {
        await this.customerLifetimeService.applyOrderCreated(result.customerSeed, tx);
      }
    });
    this.logger.debug(`OrderCreated processed: ${payload.orderId} (${envelope.messageId})`);
  }

  @On(ORDER_STREAM, 'OrderCancelled')
  async onOrderCancelled(
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderCancelled'>,
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderCancelled'>,
  ) {
    this.logger.log(`OrderCancelled received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordOrderCancelled(envelope, payload, tx);
      if (!result.claimed || result.orphan || !result.salesChannel) {
        return;
      }
      await this.orderAggregatesService.applyCancellation(
        result.occurredDate,
        result.salesChannel,
        result.masterAmounts,
        tx,
      );
      await this.channelAggregatesService.applyCancellation(
        result.occurredDate,
        result.salesChannel,
        result.totalAmount,
        tx,
      );
    });
  }

  @On(ORDER_STREAM, 'OrderRefundCreated')
  async onOrderRefundCreated(
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderRefundCreated'>,
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderRefundCreated'>,
  ) {
    this.logger.log(`OrderRefundCreated received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const result = await this.orderFactsService.recordOrderRefund(envelope, payload, tx);
      // `supersededByCancellation` 은 같은 주문의 취소가 이미 전액을 차감했다는 뜻이다 —
      // 근거와 도착 순서별 효과는 OrderFactsService.hasCancellationEnvelope 주석 참조.
      if (!result.claimed || result.orphan || result.supersededByCancellation || !result.salesChannel) {
        return;
      }
      // 채널 단위는 환불액 원본(payload.amount), 상품 단위는 그것을 master 별로 배분한 값을
      // 받는다 — 배분 합이 payload.amount 와 같아 두 테이블의 환불 총액이 일치한다.
      await this.channelAggregatesService.applyRefund(result.occurredDate, result.salesChannel, payload.amount, tx);
      await this.orderAggregatesService.applyRefund(result.occurredDate, result.salesChannel, result.masterAmounts, tx);
    });
  }
}
