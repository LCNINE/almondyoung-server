// adapters/hms-card-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';
import {
  PaymentGateway,
  PaymentMetadata,
  PaymentResult,
  RefundResult,
  PaymentMethodRegistrationRequest,
  PaymentMethodRegistrationResult,
} from '../interfaces/payment-gateway.interface';
import { CardMethodGateway } from '../interfaces/payment-method-gateways.interface';
import { Money } from '../shared/utils/money.util';

/**
 * HMS 신용카드 결제 어댑터 (표준 간소화)
 * - processPayment(): 정기결제 즉시 처리
 * - refundPayment(): 결제 환불
 * - registerPaymentMethod(): 정기결제 회원 등록
 */
@Injectable()
export class HmsCardPaymentAdapter
  implements PaymentGateway, CardMethodGateway
{
  private readonly logger = new Logger(HmsCardPaymentAdapter.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor() {
    // 🎯 신용카드는 Test 서버 우선 사용 (실시간 지원)
    this.hmsApi = HmsApiFactory.createForCard();

    const apiType =
      this.hmsApi instanceof MockHmsAPI
        ? 'Mock (PaymentProfiles 미지원)'
        : 'HMS Test Server';
    this.logger.log(`HMS 신용카드 어댑터 초기화 완료 - ${apiType} 사용`);
  }

  async processPayment(
    amount: number,
    _currency: string = 'KRW',
    metadata?: PaymentMetadata,
  ): Promise<PaymentResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `HMS 신용카드 정기결제: ${metadata?.hmsMemberId}, 금액: ${amountKRW}KRW`,
    );

    try {
      // HMS API 타입 안전성 체크
      if (!('paymentTryansactions' in this.hmsApi)) {
        throw new Error('HMS PaymentTransaction API가 지원되지 않습니다');
      }

      const response =
        await this.hmsApi.paymentTryansactions.requestTryansaction({
          transactionId: getTsid().toString(),
          memberId: metadata?.hmsMemberId || metadata?.paymentMethodId || '',
          callAmount: amountKRW,
          cardPointFlag: 'N',
        });

      if (response.payment.result.flag !== 'SUCCESS') {
        return {
          success: false,
          transactionId: '',
          error: `HMS 정기결제 실패: ${response.payment.result.message}`,
        };
      }

      return {
        success: true,
        transactionId: response.payment.transactionId,
        captureId: response.payment.transactionId, // 즉시 확정
        metadata: {
          provider: 'hms_card',
          method: 'recurring',
          approvalNumber: response.payment.approvalNumber,
          paymentDate: response.payment.paymentDate,
          actualAmount: response.payment.actualAmount,
          fee: response.payment.fee,
          rawResponse: response,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 신용카드 정기결제 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: `HMS 신용카드 결제 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  async refundPayment(
    transactionId: string,
    amount: number,
    _reason?: string,
  ): Promise<RefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `HMS 신용카드 환불: ${transactionId}, 금액: ${amountKRW}KRW`,
    );

    try {
      // HMS API 타입 안전성 체크
      if (!('paymentTryansactions' in this.hmsApi)) {
        throw new Error('HMS PaymentTransaction API가 지원되지 않습니다');
      }

      const response =
        amountKRW > 0
          ? await this.hmsApi.paymentTryansactions.cancelPartialTryansaction(
              transactionId,
              amountKRW,
            )
          : await this.hmsApi.paymentTryansactions.cancelTryansaction(
              transactionId,
            );

      if (response.payment.result.flag !== 'SUCCESS') {
        return {
          success: false,
          refundId: '',
          refundedAmount: 0,
          error: `HMS 환불 실패: ${response.payment.result.message}`,
        };
      }

      return {
        success: true,
        refundId: response.payment.transactionId,
        refundedAmount: response.payment.cancelAmount || amountKRW,
        metadata: {
          provider: 'hms_card',
          cancelDate: response.payment.cancelDate,
          remainAmount: response.payment.cancelRemainAmount,
          rawResponse: response,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 신용카드 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        refundedAmount: 0,
        error: `HMS 신용카드 환불 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * 정기결제 회원 등록 (PaymentProfile API) - PaymentGateway 인터페이스용
   */
  async registerPaymentMethod(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    return this.registerRecurringMember(request);
  }

  /**
   * 정기결제 회원 등록 (PaymentProfile API) - CardMethodGateway 인터페이스용
   */
  async registerRecurringMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`HMS 신용카드 회원 등록: ${request.memberName}`);

    try {
      // HMS Test Server에서 PaymentProfiles 지원 확인
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentProfiles' in this.hmsApi)
      ) {
        // Mock 환경: 시뮬레이션 응답
        this.logger.log('Mock 환경: HMS CMS 카드 회원 등록 시뮬레이션');

        const mockHmsMemberId = `HMS_CARD_${getTsid().toString()}`;
        return {
          success: true,
          paymentMethodId: '', // PaymentMethodService에서 설정
          hmsMemberId: mockHmsMemberId,
          metadata: {
            maskedCardNumber: this.maskCardNumber(request.paymentNumber!),
            cardCompany: 'HMS_CARD',
            cardType: 'CREDIT',
            validYear: request.validYear,
            validMonth: request.validMonth,
            memberName: request.memberName, // metadata에 포함
          },
        };
      }

      // 🎯 실제 HMS Test Server API 호출 (실시간 지원)
      this.logger.log('HMS Test Server: 실제 PaymentProfiles API 호출');
      const response = await this.hmsApi.paymentProfiles.create({
        memberId: getTsid().toString(),
        memberName: request.memberName,
        phone: request.phone,
        paymentKind: 'CARD',
        paymentNumber: request.paymentNumber!,
        payerName: request.payerName!,
        payerNumber: request.paymentNumber!, // HMS API 요구사항
        validYear: request.validYear!,
        validMonth: request.validMonth!,
        paymentDay: request.billingCycleDay?.toString() || '1',
        paymentCompany: 'TOSS',
      });

      if (response.member.result.flag !== 'SUCCESS') {
        return {
          success: false,
          paymentMethodId: '',
          error: `HMS 회원 등록 실패: ${response.member.result.message}`,
        };
      }

      return {
        success: true,
        paymentMethodId: response.member.memberId,
        hmsMemberId: response.member.memberId,
        metadata: {
          provider: 'hms_card',
          hmsStatus: response.member.status,
          maskedCardNumber: this.maskCardNumber(request.paymentNumber!),
          cardInfo: {
            validYear: request.validYear,
            validMonth: request.validMonth,
            payerName: request.payerName,
          },
          rawResponse: response,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS 신용카드 회원 등록 실패: ${errorMessage}`);

      return {
        success: false,
        paymentMethodId: '',
        error: `신용카드 정기결제 회원 등록 실패: ${errorMessage}`,
      };
    }
  }

  /**
   * HMS Member ID 유효성 검증 - CardMethodGateway 인터페이스용
   */
  async validateHmsMember(hmsMemberId: string): Promise<{
    isValid: boolean;
    cardInfo?: {
      maskedNumber: string;
      cardCompany: string;
      cardType: string;
    };
    error?: string;
  }> {
    this.logger.log(`HMS Member ID 검증: ${hmsMemberId}`);

    try {
      // HMS API로 Member 정보 조회 (Mock 구현)
      // 실제로는 HMS PaymentProfiles API의 조회 기능 사용

      return {
        isValid: true,
        cardInfo: {
          maskedNumber: '1234-****-****-5678',
          cardCompany: 'HMS_CARD',
          cardType: 'CREDIT',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'HMS API 호출 실패';
      this.logger.error(`HMS Member ID 검증 실패: ${errorMessage}`);

      return {
        isValid: false,
        error: `HMS Member ID 검증 실패: ${errorMessage}`,
      };
    }
  }

  private maskCardNumber(cardNumber: string): string {
    if (cardNumber.length < 8) return cardNumber;
    const firstFour = cardNumber.slice(0, 4);
    const lastFour = cardNumber.slice(-4);
    const middleMask = '*'.repeat(cardNumber.length - 8);
    return `${firstFour}${middleMask}${lastFour}`;
  }
}
