import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import type { UserPaymentPassword } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * PinReader - PIN 조회 (Implementation Layer)
 *
 * 책임: PIN 관련 데이터 조회
 */
@Injectable()
export class PinReader {
  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * 사용자의 PIN 정보를 조회합니다.
   */
  async findByUserId(userId: string, tx?: WalletExecutor): Promise<UserPaymentPassword | null> {
    const executor = tx || this.db.db;

    const [result] = await executor
      .select()
      .from(walletSchema.userPaymentPasswords)
      .where(eq(walletSchema.userPaymentPasswords.userId, userId))
      .limit(1);

    return result || null;
  }

  /**
   * 사용자의 PIN 정보를 조회하거나 실패합니다.
   */
  async findByUserIdOrFail(userId: string, tx?: WalletExecutor): Promise<UserPaymentPassword> {
    const pin = await this.findByUserId(userId, tx);
    if (!pin) {
      throw new Error('PIN not found');
    }
    return pin;
  }
}
