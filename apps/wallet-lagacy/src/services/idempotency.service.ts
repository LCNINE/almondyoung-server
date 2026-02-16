import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Injectable, ConflictException } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { WalletTx } from '../shared/database';

export interface IdempotencyResult<T> {
  hit: boolean;
  response?: T;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly dbService: DbService<typeof walletSchema>) {}

  private static createSafeHash(payload: unknown): string {
    // ... (기존 해시 생성 로직은 변경 없음)
    const sortedPayload = this.sortObjectKeys(payload);
    const jsonString = JSON.stringify(sortedPayload);
    return createHash('sha256').update(jsonString).digest('hex');
  }

  private static sortObjectKeys(obj: unknown): unknown {
    /* ... */ return obj;
  }

  async checkOrCreate<T>(
    tx: WalletTx,
    idemKey: string | undefined,
    userId: string, // ✨ [개선] userId를 명시적으로 받습니다.
    payload: unknown,
    route: string,
  ): Promise<IdempotencyResult<T>> {
    if (!idemKey) return { hit: false };

    const requestHash = IdempotencyService.createSafeHash({ payload, route });
    const hit = await tx.query.idempotencyKeys.findFirst({
      where: eq(schema.idempotencyKeys.id, idemKey),
    });

    if (hit) {
      if (hit.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency-Key reused with different payload',
        );
      }
      if (hit.status === 'SUCCESS' && hit.responseBody) {
        return { hit: true, response: JSON.parse(hit.responseBody) as T };
      }
      if (hit.status === 'PENDING') {
        throw new ConflictException(
          'Request with this Idempotency-Key is currently being processed.',
        );
      }
    } else {
      await tx.insert(schema.idempotencyKeys).values({
        id: idemKey,
        userId: userId, // ✨ [개선] 전달받은 userId를 사용합니다.
        requestPath: route,
        requestHash,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
    return { hit: false };
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
        status: 'SUCCESS',
        responseCode: statusCode || 200,
        responseBody: JSON.stringify(response),
      })
      .where(eq(schema.idempotencyKeys.id, idemKey));
  }
}
