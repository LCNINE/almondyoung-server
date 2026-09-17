import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { AssistantChatRepository } from '../repositories/assistant-chat.repository';

/**
 * 사용자 영구 삭제 → 그 사람의 대화를 감춘다.
 *
 * `user_id` 에 FK 가 없어(논리 DB 가 갈린다) cascade 가 오지 않는다. 그 자리를 메운다.
 * 탈퇴가 아니라 영구 삭제를 듣는 이유도 같다 — 원래 cascade 가 터지던 시점이 거기다.
 *
 * 지우지 않고 `deleted_at` 만 찍는다. 이벤트 하나에 틀린 userId 가 실리면 되돌릴 곳이
 * 없다 — 실제 파기는 유예 기간 뒤 `AssistantChatPurgeService` 가 한다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserPermanentDeletedConsumer {
  private readonly logger = new Logger(UserPermanentDeletedConsumer.name);

  constructor(private readonly repository: AssistantChatRepository) {}

  @On(USER_STREAM, 'UserPermanentDeleted')
  async onUserPermanentDeleted(
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPermanentDeleted'>,
  ): Promise<void> {
    const { userId } = payload;
    if (!userId) return;

    // 멱등 — 재시도로 다시 들어와도 결과가 같다.
    const hidden = await this.repository.softDeleteSessionsByUser(userId, new Date());
    this.logger.log(`[UserPermanentDeleted] 대화 감춤: userId=${userId} sessions=${hidden}`);
  }
}
