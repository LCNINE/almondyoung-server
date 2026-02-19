import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, lte, sql } from 'drizzle-orm';
import { WalletSchema } from '../../schema';
import { DbTx } from '../../types';
import {
  IdempotencyKeyRecord,
  NewIdempotencyKeyRecord,
  UpdateIdempotencyKeyRecord,
  idempotencyKeys,
} from './idempotency.schema';

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export type IdempotencyTx = DbTx;

export interface IdempotencyRepository {
  runInTransaction<T>(callback: (tx: IdempotencyTx) => Promise<T>): Promise<T>;
  findByIdForUpdate(tx: IdempotencyTx, recordId: string): Promise<IdempotencyKeyRecord | null>;
  insert(tx: IdempotencyTx, record: NewIdempotencyKeyRecord): Promise<void>;
  update(
    tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<void>;
  updateIfPending(
    tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean>;
  updateIfExpired(
    tx: IdempotencyTx,
    recordId: string,
    now: Date,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean>;
}

@Injectable()
export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async runInTransaction<T>(callback: (tx: IdempotencyTx) => Promise<T>): Promise<T> {
    return this.dbService.db.transaction(async (tx) => callback(tx));
  }

  async findByIdForUpdate(
    tx: IdempotencyTx,
    recordId: string,
  ): Promise<IdempotencyKeyRecord | null> {
    const rows = (await tx.execute(sql`
      select
        id,
        user_id as "userId",
        request_path as "requestPath",
        request_hash as "requestHash",
        response_code as "responseCode",
        response_body as "responseBody",
        status,
        created_at as "createdAt",
        updated_at as "updatedAt",
        expires_at as "expiresAt"
      from idempotency_keys
      where id = ${recordId}
      for update
    `)) as unknown as IdempotencyKeyRecord[];
    return rows[0] ?? null;
  }

  async insert(tx: IdempotencyTx, record: NewIdempotencyKeyRecord): Promise<void> {
    await tx.insert(idempotencyKeys).values(record);
  }

  async update(
    tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<void> {
    await tx
      .update(idempotencyKeys)
      .set(patch)
      .where(eq(idempotencyKeys.id, recordId));
  }

  async updateIfPending(
    tx: IdempotencyTx,
    recordId: string,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const rows = await tx
      .update(idempotencyKeys)
      .set(patch)
      .where(
        and(
          eq(idempotencyKeys.id, recordId),
          eq(idempotencyKeys.status, 'PENDING'),
        ),
      )
      .returning({ id: idempotencyKeys.id });

    return rows.length > 0;
  }

  async updateIfExpired(
    tx: IdempotencyTx,
    recordId: string,
    now: Date,
    patch: UpdateIdempotencyKeyRecord,
  ): Promise<boolean> {
    const rows = await tx
      .update(idempotencyKeys)
      .set(patch)
      .where(
        and(
          eq(idempotencyKeys.id, recordId),
          lte(idempotencyKeys.expiresAt, now),
        ),
      )
      .returning({ id: idempotencyKeys.id });

    return rows.length > 0;
  }
}
