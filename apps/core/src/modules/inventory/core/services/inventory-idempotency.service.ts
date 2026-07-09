import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';

/**
 * 요청 본문 지문. 키 정렬 정규화는 하지 않는다 — 같은 클라이언트의 재전송은 직렬화가
 * 동일하고, 오탐(직렬화 상이)은 409로만 귀결되어 안전한 방향 (스펙 §4.1).
 */
export function computeRequestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

@Injectable()
export class InventoryIdempotencyService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 요청(핸들러) 단위 멱등 래퍼 — 스펙 §4.2.
   * 신규 키: handler 실행 후 반환값을 같은 tx 에서 response 로 저장(throw 시 키까지 롤백).
   * 중복 키: 본문 해시 일치 시 저장 응답 replay, 불일치 시 409.
   * 동시 중복은 UNIQUE(endpoint,key) INSERT 의 행 락 대기로 직렬화된다.
   */
  async withIdempotency<T>(
    endpoint: string,
    key: string,
    requestBody: unknown,
    handler: (tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    const requestHash = computeRequestHash(requestBody);
    const t = wmsTables.inventoryIdempotencyRequests;
    return this.dbService.run(async (trx) => {
      const inserted = await trx
        .insert(t)
        .values({ endpoint, key, requestHash })
        .onConflictDoNothing({ target: [t.endpoint, t.key] })
        .returning({ id: t.id });

      if (inserted.length > 0) {
        const result = await handler(trx);
        await trx
          .update(t)
          .set({ response: result ?? null })
          .where(eq(t.id, inserted[0].id));
        return result;
      }

      const [existing] = await trx
        .select()
        .from(t)
        .where(and(eq(t.endpoint, endpoint), eq(t.key, key)))
        .limit(1);
      // ON CONFLICT 가 빈 결과 = 경쟁 tx 커밋 완료 → READ COMMITTED 에서 row 가시.
      // 미가시(경쟁 tx 진행 중 등 이례 상황)면 처리 중으로 간주.
      if (!existing || existing.response === null) {
        throw new ConflictError(`동일 요청이 처리 중입니다: ${endpoint} (key=${key})`);
      }
      if (existing.requestHash !== requestHash) {
        throw new ConflictError(`idempotencyKey 재사용: 같은 키로 다른 요청 본문 (${endpoint}, key=${key})`);
      }
      // jsonb round-trip 값 — 저장 시점 handler 반환값과 동형이라는 계약. jsonb 조회 타입이
      // unknown 이라 캐스트 불가피 (정당화 주석, CLAUDE.md 타입 규칙)
      return existing.response as T;
    }, tx);
  }
}
