import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { EventPayload, EventEnvelope, OnEvent } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { DomainEvent } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { analyticsSchema } from '../../../schema';
import { MembershipFactsService } from '../facts/membership-facts.service';
import { MembershipDimensionsService } from '../dimensions/membership-dimensions.service';

@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipEventsConsumer {
  private readonly logger = new Logger(MembershipEventsConsumer.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly membershipFactsService: MembershipFactsService,
    private readonly membershipDimensionsService: MembershipDimensionsService,
  ) {}

  @OnEvent('membership.events.v1', 'MembershipStatusChanged')
  async onMembershipStatusChanged(
    @EventEnvelope() envelope: DomainEvent<MembershipStatusChangedPayload>,
    @EventPayload() payload: MembershipStatusChangedPayload,
  ) {
    this.logger.log(`MembershipStatusChanged received: ${payload.userId} → ${payload.status}`);
    await this.dbService.run(async (tx) => {
      const result = await this.membershipFactsService.recordStatusChanged(envelope, payload, tx);
      if (!result.claimed) {
        return;
      }
      await this.membershipDimensionsService.applyStatusChanged(result, tx);
    });
    this.logger.debug(`MembershipStatusChanged processed: ${payload.userId} (${envelope.messageId})`);
  }
}
