import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { DomainEvent } from '@packages/event-contracts/types';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { processedEvents, inboxEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';

/**
 * Membership Event Consumer
 *
 * 멤버십 서비스가 발행한 이벤트를 수신하여 Inbox에 저장합니다.
 * InboxWorker가 비동기로 Medusa 고객 그룹 동기화를 처리합니다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipEventConsumer {
  private readonly logger = new Logger(MembershipEventConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {
    this.logger.log('Membership Event Consumer 초기화 완료');
  }

  @OnEvent('membership.events.v1', 'MembershipStatusChanged')
  async onMembershipStatusChanged(
    @EventEnvelope()
    envelope: DomainEvent<MembershipStatusChangedPayload>,
    @EventPayload() payload: MembershipStatusChangedPayload,
  ): Promise<void> {
    const startTime = Date.now();
    const { userId, status } = payload;

    this.logger.log(
      `[Membership] StatusChanged 수신: ${userId} → ${status} (correlationId: ${envelope.correlationId})`,
    );

    try {
      const db = this.dbService.db;
      const idempotencyKey = envelope.messageId || `${userId}:${status}`;

      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[Membership] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'membership.events.v1',
        eventType: 'MembershipStatusChanged',
        resourceId: userId,
        eventVersion: envelope.messageId || new Date().toISOString(),
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(inboxEvents).values({
        eventType: 'MembershipStatusChanged',
        aggregateType: 'Membership',
        aggregateId: userId,
        partitionKey: userId,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
          chainId: envelope.chainId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      const duration = Date.now() - startTime;
      this.logger.log(`[Membership] Inbox 저장 완료: ${userId} (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[Membership] Inbox 저장 실패: ${userId} (${duration}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
