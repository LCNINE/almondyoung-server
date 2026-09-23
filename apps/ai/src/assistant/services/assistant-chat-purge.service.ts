import { CronOnce } from '@app/cron-once';
import { Injectable, Logger } from '@nestjs/common';
import { AssistantChatRepository } from '../repositories/assistant-chat.repository';

/** 잘못 감춘 것을 되돌릴 수 있는 창. 사고를 알아차리는 데 걸리는 시간이지 보존기간이 아니다. */
const PURGE_GRACE_DAYS = 30;

/** 감춰 둔 대화를 유예 뒤에 지운다. 이게 없으면 감추기만 하고 행은 영원히 쌓인다. */
@Injectable()
export class AssistantChatPurgeService {
  private readonly logger = new Logger(AssistantChatPurgeService.name);

  constructor(private readonly repository: AssistantChatRepository) {}

  @CronOnce('30 4 * * *', { name: 'assistant-chat-purge', timeZone: 'Asia/Seoul' })
  async purge(): Promise<void> {
    const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const purged = await this.repository.purgeSoftDeletedBefore(cutoff);

    // 0건이어도 찍는다 — 크론이 도는지 보는 유일한 신호다.
    this.logger.log(`[AssistantChatPurge] 파기 완료: sessions=${purged} cutoff=${cutoff.toISOString()}`);
  }
}
