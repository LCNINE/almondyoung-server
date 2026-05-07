import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
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

  async getStoredHash(
    source: string,
    resourceType: string,
    resourceId: string,
    tx?: DbTx,
  ): Promise<string | null> {
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

  async upsert(
    source: string,
    resourceType: string,
    resourceId: string,
    hash: string,
    tx?: DbTx,
  ): Promise<void> {
    const now = new Date();
    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(pollingChangeHashes)
        .values({ source, resourceType, resourceId, hash, lastSeenAt: now })
        .onConflictDoUpdate({
          target: [
            pollingChangeHashes.source,
            pollingChangeHashes.resourceType,
            pollingChangeHashes.resourceId,
          ],
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
