import { DbService, InjectDb } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { Injectable, Logger } from '@nestjs/common';
import { USER_STREAM } from '@packages/event-contracts/streams';
import { and, asc, gt, isNotNull, like, type SQL } from 'drizzle-orm';
import * as schema from '../../../database/drizzle/schema';
import { type UserServiceSchema } from '../../../database/drizzle/schema';

export type ReplayWithdrawnParams = { dryRun: boolean; limit?: number; afterUserId?: string };
export type ReplayWithdrawnResult = {
  matched: number;
  published: number;
  lastUserId: string | null;
  failedUserId: string | null;
  userIds: string[];
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * 재발행 대상 선택 조건. 순수 함수로 두는 이유는 스펙이 렌더된 SQL 로 「조건이 둘 다인가」를 단정하기 위해서다.
 * `_` 는 LIKE 의 와일드카드라 이스케이프한다 (Postgres 기본 escape 문자 `\`).
 */
export function withdrawnUsersSelection(afterUserId?: string): SQL {
  const conditions: SQL[] = [
    isNotNull(schema.users.deletedAt),
    like(schema.users.email, 'withdrawn\\_%@deleted.invalid'),
  ];
  if (afterUserId) conditions.push(gt(schema.users.id, afterUserId));
  // conditions 가 항상 2개 이상이라 and() 가 undefined 를 돌려주지 않는다
  return and(...conditions)!;
}

/**
 * 이미 탈퇴한 회원의 `UserDeleted` 를 다시 낸다 (#786 백필, 스펙 §4.4).
 *
 * 왜 「사실 재발행」인가: 정상 경로(Kafka → channel-adapter inbox → Medusa withdraw 라우트)를 그대로 타므로
 * 코드가 하나고, 라우트가 userId 키로 멱등하므로 겹쳐 불러도 안전하다. membership 도 같은 이벤트를 받아
 * 남은 구독을 해지한다 — 09-02 정책과 같다. 그래서 반드시 dryRun 으로 건수를 본 뒤 실행한다.
 *
 * 왜 `deleted_at` 만으로 고르지 않는가: 2026-09-02 마이그레이션(`20260902050051_add-dormant-at.sql`)은
 * `dormant_at` 컬럼만 추가했고 옛 `deleted_at` 행을 재분류하지 않았다. 그 이전 `deleted_at` 은 휴면과 탈퇴가
 * 공유했다. 치환 이메일(`withdrawn_<token>@deleted.invalid`, `AuthService.anonymizeIdentity`)은 탈퇴 익명화를
 * 거쳤다는 유일한 증거다. `deleted_at` 전체로 재발행하면 휴면 회원의 구독이 해지되고 Medusa 고객이
 * 익명화된다. 이 조건에 안 걸리는 2026-03-02 ~ 09-02 탈퇴자는 사람이 판정한 목록으로 따로 다룬다.
 */
@Injectable()
export class WithdrawnReplayService {
  private readonly logger = new Logger(WithdrawnReplayService.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    @InjectPublisher(USER_STREAM) private readonly eventPublisher: PublisherFor<typeof USER_STREAM>,
  ) {}

  async replay(params: ReplayWithdrawnParams): Promise<ReplayWithdrawnResult> {
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const rows = await this.dbService.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(withdrawnUsersSelection(params.afterUserId))
      .orderBy(asc(schema.users.id))
      .limit(limit);

    const userIds = rows.map((r) => r.id);
    const lastMatchedUserId = userIds.length > 0 ? userIds[userIds.length - 1] : null;

    if (params.dryRun) {
      this.logger.log(`[WithdrawnReplay] dryRun: matched=${userIds.length} lastUserId=${lastMatchedUserId ?? '-'}`);
      return { matched: userIds.length, published: 0, lastUserId: lastMatchedUserId, failedUserId: null, userIds };
    }

    let published = 0;
    let lastUserId: string | null = null;
    let failedUserId: string | null = null;
    for (const userId of userIds) {
      // softDeleteUser 와 같은 발행 방식 — 즉시 Kafka. 하나가 실패하면 여기서 멈추고 published 까지만 보고한다.
      // 호출자는 마지막 «성공» id 뒤부터 다시 부른다 (하류가 멱등이라 겹쳐도 안전) — 그래서
      // lastUserId 는 매칭된 마지막 행이 아니라 실제로 발행에 성공한 마지막 id 여야 한다.
      try {
        await this.eventPublisher.publishEvent({ eventType: 'UserDeleted', aggregateId: userId, payload: { userId } });
        published++;
        lastUserId = userId;
      } catch (error) {
        failedUserId = userId;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[WithdrawnReplay] publish failed userId=${userId}: ${message}`);
        break;
      }
    }

    this.logger.log(
      `[WithdrawnReplay] published=${published}/${userIds.length} lastUserId=${lastUserId ?? '-'} failedUserId=${failedUserId ?? '-'}`,
    );
    return { matched: userIds.length, published, lastUserId, failedUserId, userIds };
  }
}
