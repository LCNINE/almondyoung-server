import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PinCryptoUtil } from './pin-crypto.util';
import type { UserPaymentPassword, NewPinHistory } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';
import { generateUUIDv7 } from '../../shared/utils/id-generator';

/**
 * PinManager - PIN 관리 (Implementation Layer)
 *
 * 책임: PIN 검증, 변경, 재설정, 잠금 관리
 */
@Injectable()
export class PinManager {
  private readonly logger = new Logger(PinManager.name);

  constructor(private readonly db: DbService<typeof walletSchema>) {}

  /**
   * PIN을 검증합니다.
   * @returns 검증 성공 여부
   */
  async verify(
    userId: string,
    inputPin: string,
    ipAddress?: string,
    userAgent?: string,
    tx?: WalletExecutor,
  ): Promise<boolean> {
    const executor = tx || this.db.db;

    // 1. PIN 정보 조회
    const [pinRecord] = await executor
      .select()
      .from(walletSchema.userPaymentPasswords)
      .where(eq(walletSchema.userPaymentPasswords.userId, userId))
      .limit(1);

    if (!pinRecord) {
      throw new Error('PIN_NOT_REGISTERED');
    }

    // 2. 잠금 상태 확인
    if (pinRecord.status === 'LOCKED') {
      // 감사 로그 기록 (잠금 상태에서 시도)
      await this.logAccessAttempt(
        userId,
        false,
        pinRecord.failureCount,
        ipAddress,
        userAgent,
        executor,
      );
      throw new Error('PIN_LOCKED');
    }

    // 3. PIN 비교
    const isMatch = await PinCryptoUtil.compare(inputPin, pinRecord.passwordHash);

    // 4. [Audit] 로그 기록 (성공/실패 여부와 상관없이 무조건 기록)
    // failureCountSnapshot은 검증 시점의 실패 횟수 (증가 전)
    await this.logAccessAttempt(
      userId,
      isMatch,
      pinRecord.failureCount,
      ipAddress,
      userAgent,
      executor,
    );

    if (isMatch) {
      // 5. [성공] 실패 카운트 초기화
      if (pinRecord.failureCount > 0) {
        await executor
          .update(walletSchema.userPaymentPasswords)
          .set({ failureCount: 0, updatedAt: new Date() })
          .where(eq(walletSchema.userPaymentPasswords.userId, userId));
      }
      return true;
    } else {
      // 6. [실패] 카운트 증가 및 폐기 처리 로직
      const newCount = pinRecord.failureCount + 1;

      if (newCount >= 5) {
        // 🚨 5회 도달: 즉시 폐기(잠금) 처리
        await executor
          .update(walletSchema.userPaymentPasswords)
          .set({
            failureCount: newCount,
            status: 'LOCKED',
            updatedAt: new Date(),
          })
          .where(eq(walletSchema.userPaymentPasswords.userId, userId));

        // History에 폐기 기록
        const history: NewPinHistory = {
          id: generateUUIDv7(),
          userId,
          actionType: 'LOCKED_DISPOSAL',
          previousHash: pinRecord.passwordHash,
          changedByIp: ipAddress || null,
        };
        await executor.insert(walletSchema.pinHistory).values(history);

        throw new Error('PIN_LOCKED');
      } else {
        // ⚠️ 5회 미만: 카운트만 증가
        await executor
          .update(walletSchema.userPaymentPasswords)
          .set({ failureCount: newCount, updatedAt: new Date() })
          .where(eq(walletSchema.userPaymentPasswords.userId, userId));

        throw new Error('PIN_MISMATCH');
      }
    }
  }

  /**
   * PIN을 변경합니다 (현재 PIN 검증 후).
   */
  async change(
    userId: string,
    currentPin: string,
    newPin: string,
    ipAddress?: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    // 1. 현재 PIN 검증 (실패 시 카운트 증가 로직 적용)
    await this.verify(userId, currentPin, ipAddress, undefined, executor);

    // 2. 현재 PIN과 새 PIN이 같으면 거절
    if (currentPin === newPin) {
      throw new Error('PIN_SAME_AS_CURRENT');
    }

    // 3. 기존 해시 조회
    const [pinRecord] = await executor
      .select()
      .from(walletSchema.userPaymentPasswords)
      .where(eq(walletSchema.userPaymentPasswords.userId, userId))
      .limit(1);

    if (!pinRecord) {
      throw new Error('PIN_NOT_REGISTERED');
    }

    // 4. 새 PIN 해시화
    const newPasswordHash = await PinCryptoUtil.hash(newPin);

    // 5. DB 업데이트
    await executor
      .update(walletSchema.userPaymentPasswords)
      .set({
        passwordHash: newPasswordHash,
        failureCount: 0,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })
      .where(eq(walletSchema.userPaymentPasswords.userId, userId));

    // 6. History 기록
    const history: NewPinHistory = {
      id: generateUUIDv7(),
      userId,
      actionType: 'CHANGE',
      previousHash: pinRecord.passwordHash,
      changedByIp: ipAddress || null,
    };
    await executor.insert(walletSchema.pinHistory).values(history);

    this.logger.log(`PIN changed for user ${userId}`);
  }

  /**
   * PIN을 재설정합니다 (본인인증 토큰 필요).
   */
  async reset(
    userId: string,
    newPin: string,
    ipAddress?: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    // 1. 기존 PIN 정보 조회
    const [pinRecord] = await executor
      .select()
      .from(walletSchema.userPaymentPasswords)
      .where(eq(walletSchema.userPaymentPasswords.userId, userId))
      .limit(1);

    const previousHash = pinRecord?.passwordHash || null;

    // 2. 새 PIN 해시화
    const newPasswordHash = await PinCryptoUtil.hash(newPin);

    // 3. DB 업데이트 또는 생성
    if (pinRecord) {
      await executor
        .update(walletSchema.userPaymentPasswords)
        .set({
          passwordHash: newPasswordHash,
          failureCount: 0,
          status: 'ACTIVE',
          updatedAt: new Date(),
        })
        .where(eq(walletSchema.userPaymentPasswords.userId, userId));
    } else {
      await executor.insert(walletSchema.userPaymentPasswords).values({
        userId,
        passwordHash: newPasswordHash,
        failureCount: 0,
        status: 'ACTIVE',
      });
    }

    // 4. History 기록
    const history: NewPinHistory = {
      id: generateUUIDv7(),
      userId,
      actionType: 'RESET',
      previousHash,
      changedByIp: ipAddress || null,
    };
    await executor.insert(walletSchema.pinHistory).values(history);

    this.logger.log(`PIN reset for user ${userId}`);
  }

  /**
   * 실패 카운트를 초기화합니다.
   */
  async resetFailureCount(
    userId: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    await executor
      .update(walletSchema.userPaymentPasswords)
      .set({ failureCount: 0, updatedAt: new Date() })
      .where(eq(walletSchema.userPaymentPasswords.userId, userId));
  }

  /**
   * 감사 로그를 기록합니다.
   * 성공/실패 여부와 상관없이 무조건 기록합니다.
   */
  private async logAccessAttempt(
    userId: string,
    isSuccess: boolean,
    failureCountSnapshot: number,
    ipAddress?: string,
    userAgent?: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    const executor = tx || this.db.db;

    await executor.insert(walletSchema.pinAccessLogs).values({
      userId,
      isSuccess,
      failureCountSnapshot, // 당시 누적 실패 횟수
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });
  }
}

