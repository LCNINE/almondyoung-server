// src/services/idempotency.service.ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Injectable, ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { WalletTx } from '../shared/database';

export interface IdempotencyResult<T> {
  hit: boolean;
  response?: T;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly dbService: DbService<typeof schema>) {}

  /**
   * 설계안 v2 멱등키 생성
   */
  static generateAuthorizeKey(data: {
    sessionId: string;
    methods: Array<{ methodId: string; type: string; amount: number }>;
    usePoints?: number;
  }): string {
    const payload = {
      sessionId: data.sessionId,
      methods: data.methods,
      usePoints: data.usePoints || 0,
    };

    const hash = this.createSafeHash(payload);
    return `authorize:${hash}`;
  }

  /**
   * 안전한 해시 생성 (객체 키 정렬)
   */
  private static createSafeHash(payload: unknown): string {
    const sortedPayload = this.sortObjectKeys(payload);
    const jsonString = JSON.stringify(sortedPayload);

    return createHash('sha256')
      .update(jsonString)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * 객체의 키를 재귀적으로 정렬
   */
  private static sortObjectKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }

    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const sortedObj: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      sortedObj[key] = this.sortObjectKeys(
        (obj as Record<string, unknown>)[key],
      );
    }

    return sortedObj;
  }
  async checkOrCreate<T>(
    tx: WalletTx,
    idemKey: string | undefined,
    payload: unknown,
    route: string,
  ): Promise<IdempotencyResult<T>> {
    if (!idemKey) return { hit: false };

    // 안전한 해시 생성 사용
    const requestHash = IdempotencyService.createSafeHash({
      payload,
      route,
    });

    const hit = await tx
      .select()
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.id, idemKey))
      .limit(1);

    if (hit.length) {
      if (hit[0].requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key reused with different payload',
        );
      }
      if (hit[0].status === 'COMPLETED' && hit[0].responseBody) {
        return { hit: true, response: JSON.parse(hit[0].responseBody) as T };
      }
      // PROCESSING 상태이면 대기 중으로 간주
      return { hit: false };
    } else {
      await tx.insert(schema.idempotencyKeys).values({
        id: idemKey,
        userId: 'unknown',
        requestPath: route,
        requestHash,
        status: 'PROCESSING',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
    return { hit: false };
  }

  /**
   * 멱등키 유효성 검증
   */
  static validateKey(key: string): boolean {
    // 기본 형식: prefix:hash (최소 길이 체크)
    const parts = key.split(':');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length >= 8;
  }

  async complete<T>(
    tx: WalletTx,
    idemKey: string | undefined,
    response: T,
    statusCode?: number,
  ): Promise<void> {
    if (!idemKey) return;
    await tx
      .update(schema.idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseCode: statusCode || 200,
        responseBody: JSON.stringify(response),
      })
      .where(eq(schema.idempotencyKeys.id, idemKey));
  }
}
