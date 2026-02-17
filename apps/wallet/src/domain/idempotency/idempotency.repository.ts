import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { WalletSchema } from '../../schema';
import {
  IdempotencyKeyRecord,
  NewIdempotencyKeyRecord,
  UpdateIdempotencyKeyRecord,
  idempotencyKeys,
} from './idempotency.schema';

export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export interface IdempotencyRepository {
  findById(recordId: string): Promise<IdempotencyKeyRecord | null>;
  insert(record: NewIdempotencyKeyRecord): Promise<void>;
  update(recordId: string, patch: UpdateIdempotencyKeyRecord): Promise<void>;
}

@Injectable()
export class DrizzleIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly dbService: DbService<WalletSchema>) {}

  async findById(recordId: string): Promise<IdempotencyKeyRecord | null> {
    const rows = await this.dbService.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.id, recordId))
      .limit(1);

    return rows[0] ?? null;
  }

  async insert(record: NewIdempotencyKeyRecord): Promise<void> {
    await this.dbService.db.insert(idempotencyKeys).values(record);
  }

  async update(recordId: string, patch: UpdateIdempotencyKeyRecord): Promise<void> {
    await this.dbService.db
      .update(idempotencyKeys)
      .set(patch)
      .where(eq(idempotencyKeys.id, recordId));
  }
}
