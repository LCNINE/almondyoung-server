import { Injectable, Logger } from '@nestjs/common';
import { InjectPublisher, PublisherFor, type DbTx } from '@app/events';
import { MEMBERSHIP_STREAM, type MembershipStatusChangedPayload } from '@packages/event-contracts/streams';

@Injectable()
export class MembershipEventPublisher {
  private readonly logger = new Logger(MembershipEventPublisher.name);

  constructor(
    @InjectPublisher(MEMBERSHIP_STREAM)
    private readonly publisher: PublisherFor<typeof MEMBERSHIP_STREAM>,
  ) {}

  async publishStatusChanged(payload: MembershipStatusChangedPayload): Promise<void> {
    await this.publisher.publishEvent({
      eventType: 'MembershipStatusChanged',
      aggregateId: payload.userId,
      payload,
    });

    this.logger.log(`MembershipStatusChanged published: ${payload.userId} → ${payload.status}`);
  }

  /**
   * MembershipStatusChanged 를 주어진 트랜잭션의 아웃박스에 기록한다.
   * 엔타이틀먼트 insert 와 같은 tx 로 커밋되므로 원자적 — 발행 유실이 불가능하다.
   * 실제 Kafka 발행은 OutboxDispatcher 가 재시도하며 담당한다.
   */
  async saveStatusChanged(payload: MembershipStatusChangedPayload, tx: DbTx): Promise<void> {
    await this.publisher.enqueue({ eventType: 'MembershipStatusChanged', aggregateId: payload.userId, payload }, tx);
  }
}
