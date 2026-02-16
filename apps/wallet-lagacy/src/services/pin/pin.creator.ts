import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { PinCryptoUtil } from './pin-crypto.util';
import type { NewUserPaymentPassword, NewPinHistory } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

/**
 * PinCreator - PIN 생성 (Implementation Layer)
 *
 * 책임: PIN 등록 로직 (검증 + 데이터 생성 + DB 저장)
 */
@Injectable()
export class PinCreator {
  private readonly logger = new Logger(PinCreator.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * PIN을 등록합니다.
   */
  async register(userId: string, pin: string, ipAddress?: string, tx?: WalletExecutor): Promise<void> {
    const executor = tx || this.db.db;

    // 1. PIN 해시화
    const passwordHash = await PinCryptoUtil.hash(pin);

    // 2. PIN 정보 생성
    const newPin: NewUserPaymentPassword = {
      userId,
      passwordHash,
      failureCount: 0,
      status: 'ACTIVE',
    };

    // 3. DB 저장
    await executor.insert(walletSchema.userPaymentPasswords).values(newPin);

    // 4. History 기록
    const history: NewPinHistory = {
      id: generateUUIDv7(),
      userId,
      actionType: 'REGISTER',
      previousHash: null,
      changedByIp: ipAddress || null,
    };

    await executor.insert(walletSchema.pinHistory).values(history);

    this.logger.log(`PIN registered for user ${userId}`);
  }
}
