import { Injectable, Logger, Inject } from '@nestjs/common';
import { CardMethodGateway } from '../../interfaces/payment-method-gateways.interface';
import {
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from '../../interfaces/payment-gateway.interface';
import { HMS_CARD_PAYMENT_ADAPTER } from '../../shared/tokens/gateway.tokens';

/**
 * 카드 결제수단 전용 서비스
 * - Billing Key 기반 정기결제 회원 등록 관리
 * - Billing Key 검증, 카드 정보 갱신 등
 */
@Injectable()
export class CardMethodService {
  private readonly logger = new Logger(CardMethodService.name);

  constructor(
    @Inject(HMS_CARD_PAYMENT_ADAPTER)
    private readonly cardGateway: CardMethodGateway,
  ) {}

  /**
   * 카드 정기결제용 회원 등록 (Billing Key 발급)
   */
  async registerRecurringMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`카드 회원 등록: ${request.memberName}`);

    return this.cardGateway.registerRecurringMember(request);
  }

  /**
   * HMS Member ID 유효성 확인
   */
  async validateHmsMember(hmsMemberId: string) {
    this.logger.log(`HMS Member ID 검증: ${hmsMemberId}`);
    return this.cardGateway.validateHmsMember(hmsMemberId);
  }
}
