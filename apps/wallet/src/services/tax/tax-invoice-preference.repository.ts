import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import type {
  UserTaxInvoicePreference,
  NewUserTaxInvoicePreference,
  UpdateUserTaxInvoicePreference,
} from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * TaxInvoicePreferenceRepository (Data Access Layer)
 *
 * 책임: 사용자 세금계산서 기본 설정 데이터 접근
 */
@Injectable()
export class TaxInvoicePreferenceRepository {
  private readonly logger = new Logger(TaxInvoicePreferenceRepository.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * 사용자 ID로 기본 설정 조회
   */
  async findByUserId(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference | null> {
    const executor = tx || this.db.db;
    const [preference] = await executor
      .select()
      .from(schema.userTaxInvoicePreferences)
      .where(eq(schema.userTaxInvoicePreferences.userId, userId))
      .limit(1);
    return preference ?? null;
  }

  /**
   * 기본 설정 생성
   */
  async create(
    data: NewUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    const executor = tx || this.db.db;
    const [created] = await executor
      .insert(schema.userTaxInvoicePreferences)
      .values(data)
      .returning();

    this.logger.log(`TaxInvoicePreference created for user: ${created.userId}`);
    return created;
  }

  /**
   * 기본 설정 업데이트
   */
  async update(
    userId: string,
    data: UpdateUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .update(schema.userTaxInvoicePreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.userTaxInvoicePreferences.userId, userId));

    this.logger.log(`TaxInvoicePreference updated for user: ${userId}`);
  }

  /**
   * 기본 설정 생성 또는 업데이트 (Upsert)
   */
  async upsert(
    data: NewUserTaxInvoicePreference,
    tx?: WalletExecutor,
  ): Promise<UserTaxInvoicePreference> {
    const executor = tx || this.db.db;
    const [result] = await executor
      .insert(schema.userTaxInvoicePreferences)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userTaxInvoicePreferences.userId,
        set: {
          defaultEnabled: data.defaultEnabled,
          defaultBusinessInfo: data.defaultBusinessInfo as any,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.logger.log(`TaxInvoicePreference upserted for user: ${result.userId}`);
    return result;
  }

  /**
   * 기본 설정 삭제
   */
  async delete(userId: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;
    await executor
      .delete(schema.userTaxInvoicePreferences)
      .where(eq(schema.userTaxInvoicePreferences.userId, userId));

    this.logger.warn(`TaxInvoicePreference deleted for user: ${userId}`);
  }
}
