import { Injectable } from '@nestjs/common';
import { PaymentAttemptRepository } from './payment-attempt.repository';
import type { PaymentAttempt } from '../../shared/database/types';
import type {
  PaymentRequest,
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';

/**
 * PaymentAttemptManager (Implement Layer)
 *
 * 책임:
 * - Attempt 관련 구현 로직 조율
 * - Repository 접근을 캡슐화
 * - Business Layer에 필요한 고수준 메서드 제공
 *
 * 레이어 구조:
 * Business Layer (Orchestrator) → Implement Layer (Manager) → Data Access Layer (Repository)
 */
@Injectable()
export class PaymentAttemptManager {
  constructor(private readonly attemptRepo: PaymentAttemptRepository) {}

  /**
   * 활성 상태의 Attempt를 취소합니다.
   * 동시 결제 방지를 위해 사용됩니다.
   */
  async cancelActiveAttempts(intentId: string, tx?: any): Promise<string[]> {
    return this.attemptRepo.cancelActiveAttempts(intentId, tx);
  }

  /**
   * PaymentAttempt를 기록합니다.
   */
  async recordAttempt(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
    status: string,
    tx?: any,
  ): Promise<void> {
    return this.attemptRepo.create(request, result, providerType, status, tx);
  }

  /**
   * Attempt 상태를 업데이트합니다.
   */
  async updateStatus(
    attemptId: string,
    status: string,
    result: PaymentResult,
    tx?: any,
  ): Promise<void> {
    return this.attemptRepo.updateStatus(attemptId, status, result, tx);
  }

  /**
   * Attempt ID로 조회합니다.
   */
  async findById(attemptId: string): Promise<PaymentAttempt | undefined> {
    return this.attemptRepo.findById(attemptId);
  }

  /**
   * Attempt ID로 조회하고 존재하지 않으면 에러를 던집니다.
   */
  async findByIdOrFail(attemptId: string): Promise<PaymentAttempt> {
    return this.attemptRepo.findByIdOrFail(attemptId);
  }
}
