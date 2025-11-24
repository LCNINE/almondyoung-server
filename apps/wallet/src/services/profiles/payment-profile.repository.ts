import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { walletSchema } from '../../shared/database/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { WalletExecutor } from '../../shared/database';
import { ProviderType } from '../../providers/payment-provider.interface';

/**
 * 공통 `payment_profiles` 테이블을 관리하는 Repository
 */
@Injectable()
export class PaymentProfilesRepository {
  constructor(private readonly db: DbService<typeof walletSchema>) {}

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

  /**
   * 프로필 ID로 조회 (소유자 확인용)
   */
  async findById(
    profileId: string,
    tx: WalletExecutor = this.executor,
  ): Promise<typeof schema.paymentProfiles.$inferSelect | null> {
    const [row] = await tx
      .select()
      .from(schema.paymentProfiles)
      .where(eq(schema.paymentProfiles.id, profileId))
      .limit(1);
    return row ?? null;
  }

  /**
   * 기본값 변경
   * - 기존 기본값 해제 후 새 기본값 설정
   */
  async setDefault(
    userId: string,
    profileId: string,
    tx: WalletExecutor = this.executor,
  ): Promise<void> {
    // 기존 기본값 해제
    await tx
      .update(schema.paymentProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.paymentProfiles.userId, userId),
          eq(schema.paymentProfiles.isDefault, true),
          isNull(schema.paymentProfiles.deletedAt),
        ),
      );

    // 새 기본값 설정
    await tx
      .update(schema.paymentProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(schema.paymentProfiles.id, profileId));
  }

  /**
   * Soft Delete
   * - deletedAt 필드에 현재 시각 기록
   * - 기본값인 경우 isDefault를 false로 해제
   */
  async softDelete(
    profileId: string,
    tx: WalletExecutor = this.executor,
  ): Promise<void> {
    await tx
      .update(schema.paymentProfiles)
      .set({
        deletedAt: new Date(),
        isDefault: false, // 기본값 해제 (자동 승계 없음)
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentProfiles.id, profileId));
  }
}

/**
 * `cms_card_profiles` 테이블을 관리하는 Repository
 */
@Injectable()
export class CmsCardProfilesRepository {
  constructor(private readonly db: DbService<typeof walletSchema>) {}
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
  constructor(private readonly db: DbService<typeof walletSchema>) {}
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
