// services/payment-method-factory.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentMethodAdapterPort } from '../ports/payment-method-adapter.port';
import { TossCardAdapter } from '../adapters/toss-card.adapter'; // 예시 어댑터 (주석처리됨)
import { RewardPointAdapter } from '../adapters/reward-point.adapter';

/**
 * 결제수단 타입별 어댑터 팩토리
 * - 각 결제수단 타입에 맞는 어댑터 제공
 * - BNPL은 제외 (별도 컨트롤러에서 처리)
 */
@Injectable()
export class PaymentMethodFactoryService {
  constructor(
    private readonly tossCardAdapter: TossCardAdapter, // 예시 구현 (Mock)
    private readonly rewardPointAdapter: RewardPointAdapter,
  ) {}

  /**
   * 결제수단 타입에 맞는 어댑터 반환
   */
  getAdapter(
    methodType: 'CARD' | 'REWARD_POINT',
  ): PaymentMethodAdapterPort | null {
    switch (methodType) {
      case 'CARD':
        return this.tossCardAdapter; // Mock 구현 활성화
      case 'REWARD_POINT':
        return this.rewardPointAdapter;
      default:
        throw new BadRequestException(
          `지원하지 않는 결제수단 타입: ${methodType as string}`,
        );
    }
  }

  /**
   * 어댑터가 필요한 결제수단 타입인지 확인
   */
  requiresAdapter(methodType: string): boolean {
    return methodType === 'CARD'; // 카드만 PG사 연동 필요
  }
}
