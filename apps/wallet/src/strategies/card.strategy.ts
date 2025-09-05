import { Injectable, Logger, Inject } from '@nestjs/common';
import {
  PaymentProcessingStrategy,
  RegistrableStrategy,
  StatusQueryStrategy,
  PaymentResult,
  RegistrationResult,
  RefundResult,
  StatusResult,
} from './payment.strategy.interface';
import { CardMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { PaymentGateway } from '../interfaces/payment-gateway.interface';
import { HMS_CARD_PAYMENT_ADAPTER } from '../shared/tokens/gateway.tokens';

/**
 * @class CardStrategy
 * @description 카드 결제수단의 모든 비즈니스 로직(HMS CMS 정기결제 등록, 결제 등)을 캡슐화한 클래스.
 */
@Injectable()
export class CardStrategy
  implements PaymentProcessingStrategy, RegistrableStrategy, StatusQueryStrategy
{
  private readonly logger = new Logger(CardStrategy.name);

  constructor(
    @Inject(HMS_CARD_PAYMENT_ADAPTER)
    private readonly cardAdapter: CardMethodGateway & PaymentGateway,
  ) {}

  /**
   * @method registerMethod
   * @description HMS CMS 정기결제 회원 등록 (순수 어댑터 호출)
   */
  async registerMethod(
    request: any,
    idempotencyKey?: string,
  ): Promise<RegistrationResult> {
    const { usage = 'RECURRING', ...requestData } = request;
    this.logger.log(
      `카드 등록 (${usage}): ${requestData.memberName || requestData.userId}`,
    );

    // usage에 따른 분기 처리
    if (usage === 'RECURRING') {
      return this.registerRecurringCard(requestData);
    } else if (usage === 'ONE_TIME') {
      return this.registerOneTimeCard(requestData);
    } else {
      throw new Error(`지원하지 않는 카드 사용 용도: ${usage}`);
    }
  }

  /**
   * 정기결제용 카드 등록 (순수 어댑터 호출)
   */
  private async registerRecurringCard(
    request: any,
  ): Promise<RegistrationResult> {
    this.logger.log(`HMS CMS 정기결제 회원 등록: ${request.memberName}`);

    try {
      // HMS CMS 정기결제 회원 등록 (CardMethodGateway 인터페이스 사용)
      const result = await this.cardAdapter.registerRecurringMember(request);

      if (!result.success) {
        throw new Error(result.error || 'HMS CMS 회원 등록 실패');
      }

      this.logger.log(`HMS CMS 회원 등록 완료: ${result.hmsMemberId}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS CMS 회원 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * 일회성 카드 등록 (단순 정보 저장)
   */
  private async registerOneTimeCard(request: any): Promise<RegistrationResult> {
    this.logger.log(`일회성 카드 등록: ${request.userId}`);

    try {
      // 일회성 카드는 단순 정보 저장만 수행 (외부 검증 없음)
      if (!request.cardInfo?.cardNumber) {
        throw new Error('카드 번호가 필요합니다');
      }

      this.logger.log(`일회성 카드 등록 완료`);
      return {
        success: true,
        paymentMethodId: '', // PaymentService에서 생성될 예정
        status: 'ACTIVE',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`일회성 카드 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * @method processPayment
   * @description 카드 결제를 처리합니다 (HMS 게이트웨이 사용).
   */
  async processPayment(
    amount: number,
    currency: string,
    metadata: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `카드 결제 처리: 금액 ${amount}${currency}, 세션: ${metadata.sessionId}`,
    );

    try {
      // HMS CMS 정기결제 또는 Toss 일반결제 처리
      const paymentMetadata = {
        userId: metadata.userId,
        sessionId: metadata.sessionId,
        paymentMethodId: metadata.paymentMethodId || '',
        orderName: metadata.orderName,
        hmsMemberId: metadata.hmsMemberId,
        bnplAccountId: metadata.bnplAccountId,
        isRecurring: metadata.isRecurring || !!metadata.hmsMemberId,
      };

      // PaymentGateway 인터페이스를 통한 결제 처리
      const result = await this.cardAdapter.processPayment(
        amount,
        currency,
        paymentMetadata,
      );

      if (!result.success) {
        throw new Error(result.error || '카드 결제 처리에 실패했습니다');
      }

      return {
        success: true,
        transactionId: result.transactionId,
        captureId: result.captureId,
        amount,
        currency,
        status: 'CAPTURED',
        metadata: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`카드 결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        amount,
        currency,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * @method refundPayment
   * @description 카드 환불을 처리합니다.
   */
  async refundPayment(
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(`카드 환불 처리: 거래ID ${transactionId}, 금액: ${amount}`);

    try {
      const result = await this.cardAdapter.refundPayment(
        transactionId,
        amount,
        reason,
      );

      if (!result.success) {
        throw new Error(result.error || '카드 환불 처리에 실패했습니다');
      }

      return {
        success: true,
        refundId: result.refundId,
        refundedAmount: result.refundedAmount,
        metadata: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`카드 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * @method getMemberStatus
   * @description HMS CMS 회원 상태를 조회합니다.
   */
  async getMemberStatus(memberId: string): Promise<StatusResult> {
    this.logger.log(`HMS CMS 회원 상태 조회: ${memberId}`);

    try {
      // HMS API를 통해 회원 정보 조회 (현재는 간단한 검증만 구현)
      const validationResult =
        await this.cardAdapter.validateHmsMember(memberId);
      const isValid = validationResult.isValid;

      return {
        success: true,
        status: isValid ? 'ACTIVE' : 'INVALID',
        metadata: {
          memberId,
          creditLimit: 1000000,
          lastPaymentDate: null,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`HMS CMS 회원 상태 조회 실패: ${errorMessage}`);

      return {
        success: false,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }
}
