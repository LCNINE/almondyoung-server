import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { ShopListingManager } from '../shop-listing.manager';

/**
 * 회원 영구 삭제 → 그 회원의 샵 매매 글에서 연락처(개인정보)를 지우고 감춘다.
 *
 * `author_user_id` 에 FK 가 없어(논리 DB 가 갈린다) cascade 가 오지 않는다. 그 자리를 메운다.
 * 물리 삭제는 하지 않는다(spec §10) — 본문과 판정 이력 스냅샷은 남는다.
 * 선례: apps/ai/src/assistant/consumers/user-permanent-deleted.consumer.ts
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ShopListingUserPermanentDeletedConsumer {
  private readonly logger = new Logger(ShopListingUserPermanentDeletedConsumer.name);

  constructor(private readonly manager: ShopListingManager) {}

  @On(USER_STREAM, 'UserPermanentDeleted')
  async onUserPermanentDeleted(
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPermanentDeleted'>,
  ): Promise<void> {
    const { userId } = payload;
    if (!userId) return;

    const hidden = await this.manager.withdrawAuthor(userId);
    this.logger.log(`[UserPermanentDeleted] 샵 매매 감춤: userId=${userId} listings=${hidden}`);
  }
}
