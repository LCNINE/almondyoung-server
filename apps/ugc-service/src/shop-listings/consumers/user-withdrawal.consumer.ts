import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { ShopListingManager } from '../shop-listing.manager';

/**
 * 회원 탈퇴 → 그 회원의 샵 매매 글에서 연락처(개인정보)를 지우고 감춘다.
 *
 * 두 이벤트를 듣는 이유:
 * - `UserDeleted` — 회원이 탈퇴하는 **그 순간** 나간다(`AuthService.softDeleteUser`). 이게 본 경로다.
 * - `UserPermanentDeleted` — 휴면 크론이 약 3년 뒤에야 낸다. 이것만 들으면 탈퇴한 회원의 전화번호가
 *   몇 년 동안 공개된 채 남는다. 여기서는 본 경로가 놓친 것을 줍는 보조 경로로만 둔다.
 * 둘 다 같은 `withdrawAuthor` 를 부르고 그건 멱등하다 — 같은 회원에 두 번 와도, user-service 의
 * `withdrawn-replay.service.ts` 가 옛 탈퇴자의 `UserDeleted` 를 다시 내도 결과가 같다.
 *
 * `author_user_id` 에 FK 가 없어(논리 DB 가 갈린다) cascade 가 오지 않는다. 그 자리를 메운다.
 * 물리 삭제는 하지 않는다(spec §10) — 본문과 판정 이력 스냅샷은 남는다.
 * 선례: apps/ai/src/assistant/consumers/user-permanent-deleted.consumer.ts
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ShopListingUserWithdrawalConsumer {
  private readonly logger = new Logger(ShopListingUserWithdrawalConsumer.name);

  constructor(private readonly manager: ShopListingManager) {}

  @On(USER_STREAM, 'UserDeleted')
  async onUserDeleted(@EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserDeleted'>): Promise<void> {
    await this.withdraw('UserDeleted', payload.userId);
  }

  @On(USER_STREAM, 'UserPermanentDeleted')
  async onUserPermanentDeleted(
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPermanentDeleted'>,
  ): Promise<void> {
    await this.withdraw('UserPermanentDeleted', payload.userId);
  }

  private async withdraw(eventType: 'UserDeleted' | 'UserPermanentDeleted', userId: string): Promise<void> {
    if (!userId) return;
    const hidden = await this.manager.withdrawAuthor(userId);
    this.logger.log(`[${eventType}] 샵 매매 감춤: userId=${userId} listings=${hidden}`);
  }
}
