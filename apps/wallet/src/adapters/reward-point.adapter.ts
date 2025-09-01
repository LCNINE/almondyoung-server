// adapters/reward-point.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentMethodAdapterPort,
  RegisterMethodRequest,
  RegisterMethodResult,
  VerificationResult,
  DeactivationResult,
} from '../ports/payment-method-adapter.port';

/**
 * 리워드 포인트 어댑터
 * - 외부 시스템 연동 불필요 (내부 포인트 시스템)
 * - 즉시 사용 가능
 */
@Injectable()
export class RewardPointAdapter implements PaymentMethodAdapterPort {
  private readonly logger = new Logger(RewardPointAdapter.name);

  async register(
    request: RegisterMethodRequest,
  ): Promise<RegisterMethodResult> {
    this.logger.log(`포인트 결제수단 등록: ${request.userId}`);

    // 포인트는 별도 토큰화 불필요, 즉시 사용 가능
    return {
      success: true,
      // 포인트는 PG 토큰 불필요
      metadata: {
        pointSystemType: 'INTERNAL',
        registeredAt: new Date().toISOString(),
      },
    };
  }

  async verify(): Promise<VerificationResult> {
    // 포인트 시스템 상태 확인 (항상 유효)
    return {
      isValid: true,
      message: '포인트 결제수단 사용 가능',
    };
  }

  async deactivate(methodId: string): Promise<DeactivationResult> {
    this.logger.log(`포인트 결제수단 비활성화: ${methodId}`);

    // 포인트는 내부 시스템이므로 별도 외부 정리 불필요
    return {
      success: true,
      message: '포인트 결제수단이 비활성화되었습니다',
    };
  }
}
