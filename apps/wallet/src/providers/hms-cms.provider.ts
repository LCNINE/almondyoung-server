// providers/hms-cms.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  PaymentRequest,
  RefundRequest,
  ProfileRegistrationRequest,
  PaymentType,
  PaymentProvider_ID,
  ProfileRegistrationResult,
} from './payment-provider.interface';
import {
  PaymentResult,
  RefundResult,
} from '../interfaces/payment-gateway.interface';

/**
 * HMS CMS 결제 Provider (TODO: 구현 예정)
 * - 효성 CMS(자동이체) API 연동
 * - 은행계좌 기반 정기결제 지원
 */
@Injectable()
export class HmsCmsProvider implements PaymentProvider {
  private readonly logger = new Logger(HmsCmsProvider.name);

  readonly providerId: PaymentProvider_ID = 'HMS_CMS';
  readonly supportedTypes: PaymentType[] = ['RECURRING'];

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `HMS CMS 결제 처리 - Intent: ${request.intentId} (구현 예정)`,
    );

    // TODO: HMS CMS 어댑터 구현 후 연동
    throw new Error('HMS CMS Provider는 아직 구현되지 않았습니다');
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `HMS CMS 환불 처리 - RefundId: ${request.refundId} (구현 예정)`,
    );

    // TODO: HMS CMS 환불 로직 구현
    throw new Error('HMS CMS 환불은 아직 구현되지 않았습니다');
  }

  async registerProfile(
    request: ProfileRegistrationRequest,
  ): Promise<ProfileRegistrationResult> {
    this.logger.log(
      `HMS CMS 프로필 등록 - UserId: ${request.userId} (구현 예정)`,
    );

    // TODO: HMS CMS 계좌 등록 로직 구현
    throw new Error('HMS CMS 프로필 등록은 아직 구현되지 않았습니다');
  }
}
