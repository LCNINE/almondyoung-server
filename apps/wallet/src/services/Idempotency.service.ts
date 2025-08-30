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
  async checkOrCreate<T>(
    tx: WalletTx,
    idemKey: string | undefined,
    payload: any,
    route: string,
  ): Promise<IdempotencyResult<T>> {
    if (!idemKey) return { hit: false };

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...payload, route }))
      .digest('hex');

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

  async complete<T>(
    tx: WalletTx,
    idemKey: string | undefined,
    response: T,
    statusCode = 200,
  ): Promise<void> {
    if (!idemKey) return;
    await tx
      .update(schema.idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseCode: statusCode,
        responseBody: JSON.stringify(response),
      })
      .where(eq(schema.idempotencyKeys.id, idemKey));
  }
}
