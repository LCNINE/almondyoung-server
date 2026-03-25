import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { EventPayload, EventEnvelope, OnEvent, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { OrderAggregatesService } from '../aggregates/order-aggregates.service';
import { OrderFactsService } from '../facts/order-facts.service';
import { DbTx } from '../../../db.types';
import { analyticsSchema } from '../../../schema';
import { DbService } from '@app/db';

@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class OrderEventsConsumer {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly orderFactsService: OrderFactsService,
    private readonly orderAggregatesService: OrderAggregatesService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  @OnEvent('orders.events.v1', 'OrderCreated')
  async onOrderCreated(
    @EventEnvelope() envelope: DomainEvent<OrderCreatedPayload>,
    @EventPayload() payload: OrderCreatedPayload,
  ) {
    this.logger.log(`OrderCreated received: ${payload.orderId}`);
    await this.inTx(async (tx) => {
      const seeds = await this.orderFactsService.recordOrderCreated(envelope, payload, tx);
      await this.orderAggregatesService.applyOrderCreated(seeds, tx);
    });
    this.logger.debug(`OrderCreated processed: ${payload.orderId} (${envelope.messageId})`);
  }
}
