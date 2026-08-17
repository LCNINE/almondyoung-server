import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, ne } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, pollingChangeHashes } from '../schema';

type DbTx = Parameters<Parameters<DbService<typeof channelAdapterSchema>['db']['transaction']>[0]>[0];

/**
 * 폴링 기반 외부 시스템 동기화에서 "내용이 실제로 바뀌었는지"를 판단하기 위한 공용 dedupe 서비스.
 *
 * 외부 시스템(Medusa, Naver, Coupang 등)은 메타데이터/상태머신 등 부수 효과로
 * `updated_at`을 자주 bump한다. 폴링은 단지 `updated_at > since`로 가져오므로,
 * 받아온 것을 그대로 이벤트로 발행하면 사실상 변경이 없는 OrderModified가 양산된다.
 * 이 서비스는 (source, resourceType, resourceId, content) 단위로 sha256 해시를 저장해두고,
 * 다음 폴링 때 같은 해시면 발행을 생략한다.
 */
@Injectable()
export class PollingChangeHashService {
  constructor(private readonly db: DbService<typeof channelAdapterSchema>) {}

  computeHash(content: unknown): string {
    return createHash('sha256').update(stableStringify(content)).digest('hex');
  }

  async getStoredHash(source: string, resourceType: string, resourceId: string, tx?: DbTx): Promise<string | null> {
    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .select({ hash: pollingChangeHashes.hash })
        .from(pollingChangeHashes)
        .where(
          and(
            eq(pollingChangeHashes.source, source),
            eq(pollingChangeHashes.resourceType, resourceType),
            eq(pollingChangeHashes.resourceId, resourceId),
          ),
        )
        .limit(1);
    const rows = await exec(tx ?? this.db.db);
    return rows[0]?.hash ?? null;
  }

  /**
   * 해시가 바뀐 경우에만 기록을 선점하고, 선점에 성공했는지를 돌려준다 (#599).
   *
   * `getStoredHash` → 비교 → `upsert` 로 나눠 쓰면 **읽기와 쓰기 사이에 틈이 생긴다.** 겹쳐 도는
   * 두 폴이 같은 옛 해시를 읽고 둘 다 "바뀌었다" 고 판단해 같은 사실을 두 번 발행한다. 두
   * 이벤트는 messageId 가 달라 소비자의 멱등 가드가 잡지 못한다 — 라이브에서 실제로 8건 발생했다.
   *
   * 여기서는 검사와 기록이 **한 문장**이다:
   *
   * ```sql
   * INSERT … ON CONFLICT (source, resource_type, resource_id)
   * DO UPDATE SET hash = …, last_seen_at = …
   * WHERE polling_change_hashes.hash <> <새 해시>
   * RETURNING resource_id
   * ```
   *
   * - 행이 없으면 INSERT 성공 → 반환 행 있음 → 선점
   * - 행이 있고 해시가 다르면 DO UPDATE 발동 → 반환 행 있음 → 선점
   * - 행이 있고 해시가 같으면 `setWhere` 가 거짓 → 반환 행 없음 → 이미 처리된 사실
   *
   * 동시 실행에서 뒤늦은 쪽은 `ON CONFLICT DO UPDATE` 가 잡는 행 잠금에서 대기하다가, 앞선
   * 트랜잭션이 커밋된 **뒤의** 행으로 술어를 다시 평가한다. 그래서 정확히 한 쪽만 선점한다.
   *
   * 호출자는 **반드시 발행과 같은 트랜잭션**에서 부를 것 — 선점만 커밋되고 발행이 사라지면
   * 그 사실은 영영 재발행되지 않는다.
   */
  async claimChanged(
    source: string,
    resourceType: string,
    resourceId: string,
    hash: string,
    tx?: DbTx,
  ): Promise<boolean> {
    const now = new Date();
    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(pollingChangeHashes)
        .values({ source, resourceType, resourceId, hash, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [pollingChangeHashes.source, pollingChangeHashes.resourceType, pollingChangeHashes.resourceId],
          set: { hash, lastSeenAt: now },
          setWhere: ne(pollingChangeHashes.hash, hash),
        })
        .returning({ resourceId: pollingChangeHashes.resourceId });
    const rows = await exec(tx ?? this.db.db);
    return rows.length > 0;
  }

  async upsert(source: string, resourceType: string, resourceId: string, hash: string, tx?: DbTx): Promise<void> {
    const now = new Date();
    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(pollingChangeHashes)
        .values({ source, resourceType, resourceId, hash, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [pollingChangeHashes.source, pollingChangeHashes.resourceType, pollingChangeHashes.resourceId],
          set: { hash, lastSeenAt: now },
        });
    await exec(tx ?? this.db.db);
  }
}

// 객체 키 정렬을 보장하는 안정적 직렬화 — 같은 데이터면 항상 같은 해시가 나오게.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
