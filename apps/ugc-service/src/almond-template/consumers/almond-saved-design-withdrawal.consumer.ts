import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { AlmondSavedDesignManager } from '../services/almond-saved-design.manager';

/**
 * 회원 탈퇴 → 그 회원의 디자인 보관함을 지운다. 주문 스냅샷(almond_designs)은 주문 기록이라 남긴다.
 * 두 이벤트를 듣는 이유와 멱등성은 shop-listings/consumers/user-withdrawal.consumer.ts 와 같다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class AlmondSavedDesignWithdrawalConsumer {
  private readonly logger = new Logger(AlmondSavedDesignWithdrawalConsumer.name);

  constructor(private readonly manager: AlmondSavedDesignManager) {}

  @On(USER_STREAM, 'UserDeleted')
  async onUserDeleted(@EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserDeleted'>): Promise<void> {
    await this.purge('UserDeleted', payload.userId);
  }

  @On(USER_STREAM, 'UserPermanentDeleted')
  async onUserPermanentDeleted(
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPermanentDeleted'>,
  ): Promise<void> {
    await this.purge('UserPermanentDeleted', payload.userId);
  }

  private async purge(eventType: 'UserDeleted' | 'UserPermanentDeleted', userId: string): Promise<void> {
    if (!userId) return;
    const removed = await this.manager.removeAllOf(userId);
    this.logger.log(`[${eventType}] 디자인 보관함 삭제: userId=${userId} designs=${removed}`);
  }
}
