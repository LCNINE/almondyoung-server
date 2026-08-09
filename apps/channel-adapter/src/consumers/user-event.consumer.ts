import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { processedEvents, inboxEvents, cafe24MemberMappings } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';
import { USER_STREAM } from '@packages/event-contracts/streams/user.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * User Event Consumer
 *
 * user-service가 발행한 Cafe24 연동/해제 이벤트를 수신하여 Inbox에 저장합니다.
 * InboxWorker가 비동기로 Firebase 멤버십 상태 확인 후 Medusa 고객 그룹 동기화를 처리합니다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserEventConsumer {
  private readonly logger = new Logger(UserEventConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  @On(USER_STREAM, 'UserEmailVerified')
  async onUserEmailVerified(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserEmailVerified'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserEmailVerified'>,
  ): Promise<void> {
    const { userId } = payload;
    const idempotencyKey = envelope.messageId || `UserEmailVerified:${userId}`;

    this.logger.log(`[User] UserEmailVerified 수신: userId=${userId}`);

    try {
      const db = this.dbService.db;

      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[User] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'users.events.v1',
        eventType: 'UserEmailVerified',
        resourceId: userId,
        eventVersion: envelope.messageId || new Date().toISOString(),
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(inboxEvents).values({
        eventType: 'UserEmailVerified',
        aggregateType: 'User',
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

      this.logger.log(`[User] UserEmailVerified Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] UserEmailVerified Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  @On(USER_STREAM, 'Cafe24Linked')
  async onCafe24Linked(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'Cafe24Linked'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'Cafe24Linked'>,
  ): Promise<void> {
    const { userId, cafe24MemberId, email } = payload;
    const idempotencyKey = envelope.messageId || `Cafe24Linked:${userId}:${cafe24MemberId}`;

    this.logger.log(`[User] Cafe24Linked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const db = this.dbService.db;

      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[User] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'users.events.v1',
        eventType: 'Cafe24Linked',
        resourceId: userId,
        eventVersion: envelope.messageId || new Date().toISOString(),
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(inboxEvents).values({
        eventType: 'Cafe24Linked',
        aggregateType: 'FirebaseMembership',
        aggregateId: cafe24MemberId,
        partitionKey: cafe24MemberId,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
          chainId: envelope.chainId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      await db
        .insert(cafe24MemberMappings)
        .values({ cafe24MemberId, userId, email, createdAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: cafe24MemberMappings.cafe24MemberId,
          set: { userId, email, updatedAt: new Date() },
        });

      this.logger.log(`[User] Cafe24Linked Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] Cafe24Linked Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  @On(USER_STREAM, 'Cafe24Unlinked')
  async onCafe24Unlinked(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'Cafe24Unlinked'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'Cafe24Unlinked'>,
  ): Promise<void> {
    const { userId, cafe24MemberId } = payload;
    const idempotencyKey = envelope.messageId || `Cafe24Unlinked:${userId}:${cafe24MemberId}`;

    this.logger.log(`[User] Cafe24Unlinked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const db = this.dbService.db;

      const [existing] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.idempotencyKey, idempotencyKey))
        .limit(1);

      if (existing) {
        this.logger.debug(`[User] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
        return;
      }

      await db.insert(processedEvents).values({
        idempotencyKey,
        source: 'users.events.v1',
        eventType: 'Cafe24Unlinked',
        resourceId: userId,
        eventVersion: envelope.messageId || new Date().toISOString(),
        status: 'PROCESSED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(inboxEvents).values({
        eventType: 'Cafe24Unlinked',
        aggregateType: 'FirebaseMembership',
        aggregateId: cafe24MemberId,
        partitionKey: cafe24MemberId,
        payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
          chainId: envelope.chainId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      await db.delete(cafe24MemberMappings).where(eq(cafe24MemberMappings.cafe24MemberId, cafe24MemberId));

      this.logger.log(`[User] Cafe24Unlinked Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] Cafe24Unlinked Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }
}
