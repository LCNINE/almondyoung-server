// adapters/hms-card-payment.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  CreatePaymentProfileDto,
  PaymentTransactionRequest,
} from 'hms-api-wrapper';
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
import axios from 'axios';

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
      // Mock API 환경에서는 PaymentTransaction 미지원
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentTransactions' in this.hmsApi)
      ) {
        this.logger.log('Mock 환경: HMS 신용카드 결제 시뮬레이션');

        // Mock 결제 성공 응답 생성
        const mockTransactionId = `MOCK_CARD_${getTsid().toString()}`;
        return {
          success: true,
          transactionId: mockTransactionId,
          captureId: mockTransactionId, // 즉시 확정
          metadata: {
            provider: 'hms_card',
            method: 'recurring_mock',
            approvalNumber: `MOCK_${Date.now()}`,
            paymentDate: new Date().toISOString(),
            actualAmount: amountKRW,
            fee: 0,
            rawResponse: {
              payment: {
                result: { flag: 'SUCCESS', message: 'Mock 결제 성공' },
                transactionId: mockTransactionId,
                approvalNumber: `MOCK_${Date.now()}`,
                paymentDate: new Date().toISOString(),
                actualAmount: amountKRW,
                fee: 0,
              },
            },
          },
        };
      }

      // HMS API PaymentTransactionRequest 타입에 정확히 맞게 데이터 매핑
      const paymentRequest: PaymentTransactionRequest = {
        transactionId: getTsid().toString(),
        memberId: metadata?.hmsMemberId || metadata?.paymentMethodId || '',
        callAmount: amountKRW,
        cardPointFlag: 'N',
        vatAmount: Math.floor(amountKRW * 0.1), // 부가세 계산 (10%)
      };

      this.logger.log(
        'HMS API 결제 요청 데이터:',
        JSON.stringify(paymentRequest, null, 2),
      );

      // 실제 HMS Test API 호출
      const response = await (
        this.hmsApi as any
      ).paymentTransactions.requestTransaction(paymentRequest);

      if (response.payment.result.flag !== 'Y') {
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
      if (!('paymentTransactions' in this.hmsApi)) {
        throw new Error('HMS PaymentTransaction API가 지원되지 않습니다');
      }

      const response =
        amountKRW > 0
          ? await (
              this.hmsApi as any
            ).paymentTransactions.cancelPartialTransaction(
              transactionId,
              amountKRW,
            )
          : await (this.hmsApi as any).paymentTransactions.cancelTransaction(
              transactionId,
            );

      if (response.payment.result.flag !== 'Y') {
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
  /**
   * 정기결제 회원 등록 (PaymentProfile API) - CardMethodGateway 인터페이스용
   */
  async registerRecurringMember(
    request: PaymentMethodRegistrationRequest,
  ): Promise<PaymentMethodRegistrationResult> {
    this.logger.log(`HMS 신용카드 회원 등록: ${request.memberName}`);

    try {
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentProfiles' in this.hmsApi)
      ) {
        this.logger.warn('Mock API 환경이므로 실제 등록을 시뮬레이션합니다.');
        const mockHmsMemberId = `HMS_CARD_${getTsid().toString()}`;
        return {
          success: true,
          paymentMethodId: '',
          hmsMemberId: mockHmsMemberId,
          metadata: {
            /* ... */
          },
        };
      }

      this.logger.log('HMS Test Server: 실제 PaymentProfiles API 호출');

      const hmsPayload: CreatePaymentProfileDto = {
        memberId: getTsid().toString(),
        memberName: request.memberName,
        phone: request.phone,
        paymentKind: 'CARD',
        paymentNumber: request.paymentNumber!,
        payerName: request.payerName!,
        payerNumber: request.payerNumber!,
        validYear: request.validYear!,
        validMonth: request.validMonth!,
        paymentDay:
          request.billingCycleDay?.toString().padStart(2, '0') || '01',
        password: '23',
      };

      this.logger.log(
        'HMS API 요청 데이터:',
        JSON.stringify(hmsPayload, null, 2),
      );

      const response = await this.hmsApi.paymentProfiles.create(hmsPayload);

      // ✅ [최종 수정] 성공 플래그를 'SUCCESS'가 아닌 'Y'로 정확하게 비교합니다.
      if (response.member.result.flag !== 'Y') {
        const errorMessage = `HMS 회원 등록 실패: ${response.member.result.message}`;
        this.logger.error(errorMessage, JSON.stringify(response, null, 2));
        return {
          success: false,
          paymentMethodId: '',
          error: errorMessage,
        };
      }

      // 정상 성공 시 결과 반환
      return {
        success: true,
        paymentMethodId: response.member.memberId,
        hmsMemberId: response.member.memberId,
        metadata: {
          provider: 'hms_card',
          hmsStatus: response.member.status,
          maskedCardNumber: this.maskCardNumber(request.paymentNumber!),
          rawResponse: response,
        },
      };
    } catch (error) {
      // API 호출 자체가 실패했을 때, 서버의 실제 응답을 확인하기 위한 상세 로깅
      this.logger.error(
        'HMS API 호출 예외 발생 - 전체 에러 객체:',
        JSON.stringify(error, null, 2),
      );
      if (error.response && error.response.data) {
        this.logger.error(
          '!!! HMS 서버 실제 응답 에러 본문 !!!:',
          JSON.stringify(error.response.data, null, 2),
        );
      }
      const errorMessage =
        error.response?.data?.error?.message ||
        error.message ||
        '알 수 없는 오류';
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

  /**
   * HMS API용 10자리 납부자 번호 생성
   * - payerNumber가 이미 제공된 경우 그대로 사용
   * - 없으면 전화번호에서 10자리 추출 (01012345678 -> 0101234567)
   */
  private extractPayerNumber(cardNumber: string, phone: string): string {
    // 전화번호에서 10자리 추출 (하이픈 제거 후 앞 10자리)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length >= 10) {
      return cleanPhone.slice(0, 10);
    }

    // 전화번호가 10자리 미만이면 카드번호 뒷 10자리 사용
    if (cardNumber.length >= 10) {
      return cardNumber.slice(-10);
    }

    // 둘 다 부족하면 기본값
    return '0000000000';
  }
}
