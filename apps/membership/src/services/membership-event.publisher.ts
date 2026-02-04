import { Injectable, Logger } from '@nestjs/common';
import { InjectStreamPublisher, StreamPublisher } from '@app/events';
import {
  MEMBERSHIP_STREAM,
  type MembershipEvents,
  type MembershipStatusChangedPayload,
} from '@packages/event-contracts/streams';

@Injectable()
export class MembershipEventPublisher {
  private readonly logger = new Logger(MembershipEventPublisher.name);

  constructor(
    @InjectStreamPublisher(MEMBERSHIP_STREAM.topic.topic)
    private readonly publisher: StreamPublisher<MembershipEvents>,
  ) {}

  async publishStatusChanged(
    payload: MembershipStatusChangedPayload,
  ): Promise<void> {
    await this.publisher.publishEvent({
      eventType: 'MembershipStatusChanged',
      aggregateId: payload.userId,
      payload,
    });

    this.logger.log(
      `MembershipStatusChanged published: ${payload.userId} → ${payload.status}`,
    );
  }
}
