import { Injectable, Logger } from '@nestjs/common';
import { PinReader } from './pin.reader';
import { PinCreator } from './pin.creator';
import { PinManager } from './pin.manager';
import { PinPolicyUtil } from './pin-policy.util';
import type { UserPaymentPassword } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

/**
 * PinService (Business Layer)
 *
 * 책임: PIN 도메인의 비즈니스 흐름
 */
@Injectable()
export class PinService {
  private readonly logger = new Logger(PinService.name);

  constructor(
    private readonly pinReader: PinReader,
    private readonly pinCreator: PinCreator,
    private readonly pinManager: PinManager,
  ) { }

  /**
   * PIN 상태 조회
   */
  async getStatus(userId: string): Promise<{
    hasPin: boolean;
    status: 'ACTIVE' | 'LOCKED' | 'NONE';
    failureCount: number;
  }> {
    const pin = await this.pinReader.findByUserId(userId);

    if (!pin) {
      return {
        hasPin: false,
        status: 'NONE',
        failureCount: 0,
      };
    }

    return {
      hasPin: true,
      status: pin.status,
      failureCount: pin.failureCount,
    };
  }

  /**
   * PIN 등록
   */
  async register(userId: string, pin: string, ipAddress?: string, tx?: WalletExecutor): Promise<void> {

    console.log('register', pin);
    // 1. 보안 정책 검사
    if (!PinPolicyUtil.isValid(pin)) {
      throw new Error('WEAK_PIN');
    }

    // 2. 이미 등록된 PIN 확인
    const existing = await this.pinReader.findByUserId(userId, tx);
    if (existing) {
      throw new Error('PIN_ALREADY_EXISTS');
    }

    // 3. 등록
    await this.pinCreator.register(userId, pin, ipAddress, tx);
  }

  /**
   * PIN 검증
   */
  async verify(
    userId: string,
    pin: string,
    ipAddress?: string,
    userAgent?: string,
    tx?: WalletExecutor,
  ): Promise<boolean> {
    try {
      return await this.pinManager.verify(userId, pin, ipAddress, userAgent, tx);
    } catch (error) {
      // PIN_MISMATCH는 실패 횟수 정보를 포함해야 함
      // pinManager에서 이미 카운트를 증가시켰으므로, 증가된 카운트를 조회
      if (error instanceof Error && error.message === 'PIN_MISMATCH') {
        const pinRecord = await this.pinReader.findByUserId(userId, tx);
        const currentCount = pinRecord?.failureCount || 0;
        throw new Error(`PIN_MISMATCH:${currentCount}:5`);
      }
      throw error;
    }
  }

  /**
   * PIN 변경
   */
  async change(
    userId: string,
    currentPin: string,
    newPin: string,
    ipAddress?: string,
    tx?: WalletExecutor,
  ): Promise<void> {
    // 1. 새 PIN 보안 정책 검사
    if (!PinPolicyUtil.isValid(newPin)) {
      throw new Error('WEAK_PIN');
    }

    // 2. 변경
    await this.pinManager.change(userId, currentPin, newPin, ipAddress, tx);
  }

  /**
   * PIN 재설정 (본인인증 토큰 필요)
   */
  async reset(userId: string, newPin: string, ipAddress?: string, tx?: WalletExecutor): Promise<void> {
    // 1. 새 PIN 보안 정책 검사
    if (!PinPolicyUtil.isValid(newPin)) {
      throw new Error('WEAK_PIN');
    }

    // 2. 재설정
    await this.pinManager.reset(userId, newPin, ipAddress, tx);
  }
}
