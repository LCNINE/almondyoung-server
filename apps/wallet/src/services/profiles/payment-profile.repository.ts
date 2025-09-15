import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { eq, and } from 'drizzle-orm';
import { WalletExecutor } from '../../shared/database';
import { ProviderType } from '../../providers/payment-provider.interface';

/**
 * 공통 `payment_profiles` 테이블을 관리하는 Repository
 */
@Injectable()
export class PaymentProfilesRepository {
  constructor(private readonly db: DbService<typeof schema>) {}

  private get executor() {
    return this.db.db;
  }

  async create(
    input: {
      id: string;
      userId: string;
      kind: 'CARD' | 'BANK_ACCOUNT' | 'WALLET';
      provider: ProviderType;
      name?: string | null;
    },
    tx: WalletExecutor = this.executor,
  ) {
    const [result] = await tx
      .insert(schema.paymentProfiles)
      .values({ ...input, status: 'PENDING', provider: input.provider })
      .returning({ id: schema.paymentProfiles.id });
    return result.id;
  }

  async updateStatus(
    id: string,
    status: schema.PaymentProfileStatus,
    tx: WalletExecutor = this.executor,
  ) {
    await tx
      .update(schema.paymentProfiles)
      .set({ status })
      .where(eq(schema.paymentProfiles.id, id));
  }

  async findOneByUserAndProvider(
    userId: string,
    tx: WalletExecutor = this.executor,
  ) {
    const [row] = await tx
      .select()
      .from(schema.paymentProfiles)
      .where(and(eq(schema.paymentProfiles.userId, userId)))
      .limit(1);
    return row ?? null;
  }
}

/**
 * `cms_card_profiles` 테이블을 관리하는 Repository
 */
@Injectable()
export class CmsCardProfilesRepository {
  constructor(private readonly db: DbService<typeof schema>) {}
  private get executor() {
    return this.db.db;
  }

  async insert(
    input: typeof schema.cmsCardProfiles.$inferInsert,
    tx: WalletExecutor = this.executor,
  ) {
    await tx.insert(schema.cmsCardProfiles).values(input);
  }

  async findById(id: string, tx: WalletExecutor = this.executor) {
    const [row] = await tx
      .select()
      .from(schema.cmsCardProfiles)
      .where(eq(schema.cmsCardProfiles.id, id))
      .limit(1);
    return row ?? null;
  }
}

/**
 * `cms_batch_profiles` 테이블을 관리하는 Repository
 */
@Injectable()
export class CmsBatchProfilesRepository {
  constructor(private readonly db: DbService<typeof schema>) {}
  private get executor() {
    return this.db.db;
  }

  async insert(
    input: typeof schema.cmsBatchProfiles.$inferInsert,
    tx: WalletExecutor = this.executor,
  ) {
    await tx.insert(schema.cmsBatchProfiles).values(input);
  }

  async findById(id: string, tx: WalletExecutor = this.executor) {
    const [row] = await tx
      .select()
      .from(schema.cmsBatchProfiles)
      .where(eq(schema.cmsBatchProfiles.id, id))
      .limit(1);
    return row ?? null;
  }
}
