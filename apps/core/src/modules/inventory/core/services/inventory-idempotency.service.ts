import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lt } from 'drizzle-orm';
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
  private static readonly RETENTION_DAYS = 30;
  private readonly logger = new Logger(InventoryIdempotencyService.name);

  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /**
   * 요청(핸들러) 단위 멱등 래퍼 — 스펙 §4.2.
   * 신규 키: handler 실행 후 반환값을 같은 tx 에서 response 로 저장(throw 시 키까지 롤백).
   * 중복 키: 본문 해시 일치 시 저장 응답 replay, 불일치 시 409.
   * 동시 중복은 UNIQUE(endpoint,key) INSERT 의 행 락 대기로 직렬화된다.
   * 계약: handler 는 null/undefined 로 resolve 하면 안 된다 — response null 은 "처리 중" 표식이라 완료 replay 가 영구 409 가 된다.
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
        if (result == null) {
          throw new Error('withIdempotency handler must not resolve null/undefined — response null 은 처리 중 표식');
        }
        await trx.update(t).set({ response: result }).where(eq(t.id, inserted[0].id));
        return result;
      }

      const [existing] = await trx
        .select()
        .from(t)
        .where(and(eq(t.endpoint, endpoint), eq(t.key, key)))
        .limit(1);
      // 스펙 §4.2: hash 불일치("키 재사용")를 처리 중 판정보다 먼저 검사한다 — 다른 본문으로
      // 키를 재사용한 요청은 처리 중 여부와 무관하게 항상 재사용 오류로 귀결돼야 한다.
      if (existing && existing.requestHash !== requestHash) {
        throw new ConflictError(`idempotencyKey 재사용: 같은 키로 다른 요청 본문 (${endpoint}, key=${key})`);
      }
      // ON CONFLICT 가 빈 결과 = 경쟁 tx 커밋 완료 → READ COMMITTED 에서 row 가시.
      // 미가시(경쟁 tx 진행 중 등 이례 상황)면 처리 중으로 간주.
      if (!existing || existing.response === null) {
        throw new ConflictError(`동일 요청이 처리 중입니다: ${endpoint} (key=${key})`);
      }
      // jsonb round-trip 값 — 저장 시점 handler 반환값과 동형이라는 계약. jsonb 조회 타입이
      // unknown 이라 캐스트 불가피 (정당화 주석, CLAUDE.md 타입 규칙)
      return existing.response as T;
    }, tx);
  }

  /** 멱등 기록 보존 크론 — 재전송 방어 window(30일) 초과분 정리. 야간 03:30 KST (스펙 §6). */
  @Cron('30 3 * * *', { name: 'inventory-idempotency-purge', timeZone: 'Asia/Seoul' })
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - InventoryIdempotencyService.RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.dbService.run(async (trx) =>
      trx
        .delete(wmsTables.inventoryIdempotencyRequests)
        .where(lt(wmsTables.inventoryIdempotencyRequests.createdAt, cutoff))
        .returning({ id: wmsTables.inventoryIdempotencyRequests.id }),
    );
    this.logger.log(`idempotency purge: ${deleted.length} rows (< ${cutoff.toISOString()})`);
    return deleted.length;
  }
}
