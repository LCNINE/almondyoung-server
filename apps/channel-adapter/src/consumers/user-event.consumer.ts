import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { processedEvents, inboxEvents, cafe24MemberMappings } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';
import { USER_STREAM } from '@packages/event-contracts/streams/user.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

type UserEventType = 'Cafe24Linked' | 'Cafe24Unlinked' | 'UserUpdated' | 'UserDeleted';
type AnyUserEnvelope = EnvelopeOf<typeof USER_STREAM, UserEventType>;

/**
 * User Event Consumer
 *
 * user-service 가 발행한 회원 이벤트를 수신해 Inbox 에 저장한다. InboxWorker 가 비동기로 처리한다:
 * - `Cafe24Linked`/`Cafe24Unlinked` → Firebase 멤버십 상태 확인 후 Medusa 고객 그룹 동기화
 * - `UserUpdated`(email 있는 것만) → Medusa customer email 동기화 (#786)
 * - `UserDeleted` → Medusa 고객 익명화·파기 (#786)
 *
 * Medusa 는 Kafka 를 듣지 않는다. 회원 이벤트가 Medusa 에 닿는 유일한 길이 이 inbox 다 (ADR-0033 §3).
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserEventConsumer {
  private readonly logger = new Logger(UserEventConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {}

  /**
   * processed_events 로 멱등을 보장한 뒤 inbox 에 적재한다.
   * @returns 새로 적재했으면 true, 이미 처리된 메시지라 건너뛰었으면 false
   * @param inbox null 이면 processed 만 기록하고 inbox 에는 넣지 않는다 (예: email 없는 UserUpdated)
   * @param fallbackKey envelope 에 messageId 가 없을 때 쓰는 멱등키. 호출부가 결정한다 — 이벤트마다
   * 무엇이 충돌 없는 키인지가 다르다 (예: Cafe24 는 cafe24MemberId 까지 포함해야 재연동이 안 뭉친다).
   */
  private async recordAndEnqueue(
    envelope: AnyUserEnvelope,
    eventType: UserEventType,
    resourceId: string,
    inbox: { aggregateType: string; aggregateId: string; payload: object } | null,
    fallbackKey: string,
  ): Promise<boolean> {
    const db = this.dbService.db;
    const idempotencyKey = envelope.messageId || fallbackKey;

    const [existing] = await db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      this.logger.debug(`[User] 이미 처리된 이벤트 스킵: ${idempotencyKey}`);
      return false;
    }

    await db.insert(processedEvents).values({
      idempotencyKey,
      source: 'users.events.v1',
      eventType,
      resourceId,
      eventVersion: envelope.messageId || new Date().toISOString(),
      status: 'PROCESSED',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (!inbox) return true;

    await db.insert(inboxEvents).values({
      eventType,
      aggregateType: inbox.aggregateType,
      aggregateId: inbox.aggregateId,
      partitionKey: inbox.aggregateId,
      payload: inbox.payload,
      metadata: {
        correlationId: envelope.correlationId,
        messageId: envelope.messageId,
        chainId: envelope.chainId,
      },
      status: 'pending',
      createdAt: new Date(),
    });
    return true;
  }

  @On(USER_STREAM, 'Cafe24Linked')
  async onCafe24Linked(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'Cafe24Linked'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'Cafe24Linked'>,
  ): Promise<void> {
    const { userId, cafe24MemberId, email } = payload;
    this.logger.log(`[User] Cafe24Linked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const enqueued = await this.recordAndEnqueue(
        envelope,
        'Cafe24Linked',
        userId,
        { aggregateType: 'FirebaseMembership', aggregateId: cafe24MemberId, payload },
        `Cafe24Linked:${userId}:${cafe24MemberId}`,
      );
      if (!enqueued) return;

      await this.dbService.db
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
    this.logger.log(`[User] Cafe24Unlinked 수신: userId=${userId}, cafe24MemberId=${cafe24MemberId}`);

    try {
      const enqueued = await this.recordAndEnqueue(
        envelope,
        'Cafe24Unlinked',
        userId,
        { aggregateType: 'FirebaseMembership', aggregateId: cafe24MemberId, payload },
        `Cafe24Unlinked:${userId}:${cafe24MemberId}`,
      );
      if (!enqueued) return;

      await this.dbService.db.delete(cafe24MemberMappings).where(eq(cafe24MemberMappings.cafe24MemberId, cafe24MemberId));

      this.logger.log(`[User] Cafe24Unlinked Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] Cafe24Unlinked Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  /**
   * 이메일이 바뀐 것만 Medusa 의 관심사다. `UserUpdated` 는 닉네임·전화 등 프로필 수정에도 뜨고 그때는
   * email 이 없다 — 오늘 email 을 싣는 발행자는 cafe24 이메일 이관 하나뿐이다. inbox 에는 `{ userId, email }`
   * 만 싣는다: 워커가 나머지 필드를 읽을 일이 없고, 프로필 값이 inbox 에 남을 이유도 없다.
   */
  @On(USER_STREAM, 'UserUpdated')
  async onUserUpdated(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserUpdated'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserUpdated'>,
  ): Promise<void> {
    const { userId, email } = payload;

    try {
      const enqueued = await this.recordAndEnqueue(
        envelope,
        'UserUpdated',
        userId,
        email ? { aggregateType: 'MedusaCustomer', aggregateId: userId, payload: { userId, email } } : null,
        `UserUpdated:${userId}`,
      );
      if (enqueued && email) {
        this.logger.log(`[User] UserUpdated(email) Inbox 저장 완료: userId=${userId}`);
      }
    } catch (error) {
      this.logger.error(`[User] UserUpdated Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }

  @On(USER_STREAM, 'UserDeleted')
  async onUserDeleted(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserDeleted'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserDeleted'>,
  ): Promise<void> {
    const { userId } = payload;
    this.logger.log(`[User] UserDeleted 수신: userId=${userId}`);

    try {
      const enqueued = await this.recordAndEnqueue(
        envelope,
        'UserDeleted',
        userId,
        { aggregateType: 'MedusaCustomer', aggregateId: userId, payload: { userId } },
        `UserDeleted:${userId}`,
      );
      if (enqueued) this.logger.log(`[User] UserDeleted Inbox 저장 완료: userId=${userId}`);
    } catch (error) {
      this.logger.error(`[User] UserDeleted Inbox 저장 실패: userId=${userId}`, error?.message);
      throw error;
    }
  }
}
