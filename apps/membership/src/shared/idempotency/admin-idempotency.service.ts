import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { membershipSchema, adminOperationKeys } from '../schemas/entities/schema';

/** PROCESSING 점유 만료(초). 핸들러 크래시로 점유가 영구히 남는 것을 막는 안전장치. */
const LOCK_TTL_MS = 10 * 60_000;

export type BeginResult =
  | { kind: 'proceed'; lockedUntil: Date }
  | { kind: 'replay'; response: unknown }
  | { kind: 'conflict'; reason: string };

/**
 * 관리자 운영 액션(계약/권한 변경) 멱등성.
 * wallet의 결제 멱등과 책임 분리 — membership 상태를 바꾸는 액션은 membership이 키를 소유한다.
 *
 * 흐름: begin(점유/캐시판정) → (proceed면) 핸들러 실행 → complete/fail.
 */
@Injectable()
export class AdminIdempotencyService {
  private readonly logger = new Logger(AdminIdempotencyService.name);

  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  hashRequest(input: unknown): string {
    return createHash('sha256')
      .update(stableStringify(input ?? {}))
      .digest('hex');
  }

  /**
   * 점유 시도 및 중복 판정.
   * - 신규: PROCESSING 선점 → proceed
   * - COMPLETED + 같은 본문: 저장된 응답 replay
   * - 같은 키 + 다른 본문: conflict(409)
   * - PROCESSING(점유 유효): conflict(409, 처리 중)
   * - PROCESSING(점유 만료) / FAILED: 재점유 후 proceed
   */
  async begin(operation: string, key: string, requestHash: string): Promise<BeginResult> {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + LOCK_TTL_MS);

    const inserted = await this.dbService.db
      .insert(adminOperationKeys)
      .values({ operation, key, requestHash, status: 'PROCESSING', lockedUntil })
      .onConflictDoNothing()
      .returning({ id: adminOperationKeys.id });
    if (inserted.length > 0) return { kind: 'proceed', lockedUntil };

    const [row] = await this.dbService.db
      .select()
      .from(adminOperationKeys)
      .where(and(eq(adminOperationKeys.operation, operation), eq(adminOperationKeys.key, key)))
      .limit(1);
    if (!row) return { kind: 'proceed', lockedUntil }; // 경합으로 사라진 극히 드문 경우 — 재시도 안전

    if (row.requestHash !== requestHash) {
      return { kind: 'conflict', reason: '같은 Idempotency-Key로 다른 요청이 전달되었습니다.' };
    }
    if (row.status === 'COMPLETED') {
      return { kind: 'replay', response: row.responseJson };
    }
    if (row.status === 'PROCESSING' && row.lockedUntil > now) {
      return { kind: 'conflict', reason: '동일 요청이 처리 중입니다.' };
    }

    // FAILED 또는 점유 만료된 PROCESSING → 재점유 (조건부 업데이트로 동시성 안전)
    const reclaimed = await this.dbService.db
      .update(adminOperationKeys)
      .set({ status: 'PROCESSING', lockedUntil, errorJson: null })
      .where(
        and(
          eq(adminOperationKeys.operation, operation),
          eq(adminOperationKeys.key, key),
          eq(adminOperationKeys.requestHash, requestHash),
          eq(adminOperationKeys.status, row.status),
        ),
      )
      .returning({ id: adminOperationKeys.id });
    return reclaimed.length > 0
      ? { kind: 'proceed', lockedUntil }
      : { kind: 'conflict', reason: '동시 처리 충돌이 감지되었습니다.' };
  }

  async complete(operation: string, key: string, requestHash: string, lockedUntil: Date, response: unknown): Promise<void> {
    await this.dbService.db
      .update(adminOperationKeys)
      .set({ status: 'COMPLETED', responseJson: (response ?? null) as never, completedAt: new Date() })
      .where(
        and(
          eq(adminOperationKeys.operation, operation),
          eq(adminOperationKeys.key, key),
          eq(adminOperationKeys.requestHash, requestHash),
          eq(adminOperationKeys.status, 'PROCESSING'),
          eq(adminOperationKeys.lockedUntil, lockedUntil),
        ),
      );
  }

  async fail(operation: string, key: string, requestHash: string, lockedUntil: Date, error: unknown): Promise<void> {
    const errorJson = { message: error instanceof Error ? error.message : String(error) };
    await this.dbService.db
      .update(adminOperationKeys)
      .set({ status: 'FAILED', errorJson, completedAt: new Date() })
      .where(
        and(
          eq(adminOperationKeys.operation, operation),
          eq(adminOperationKeys.key, key),
          eq(adminOperationKeys.requestHash, requestHash),
          eq(adminOperationKeys.status, 'PROCESSING'),
          eq(adminOperationKeys.lockedUntil, lockedUntil),
        ),
      );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}
