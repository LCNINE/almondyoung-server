// providers/hms-card.provider.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  HmsAPI,
  MockHmsAPI,
  CreatePaymentProfileDto,
  PaymentTransactionRequest,
} from 'hms-api-wrapper';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { getTsid } from 'tsid-ts';
import { Money } from '../shared/utils/money.util';
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
  PaymentMetadata,
  PaymentMethodRegistrationRequest,
} from '../interfaces/payment-gateway.interface';

/**
 * HMS 카드 결제 Provider (통합 구현)
 * - 효성 카드 API 직접 통신
 * - 저장카드(빌링키) 기반 정기결제 지원
 * - Adapter 레이어 제거하고 Provider에서 직접 PG 호출
 */
@Injectable()
export class HmsCardProvider implements PaymentProvider {
  private readonly logger = new Logger(HmsCardProvider.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  readonly providerId: PaymentProvider_ID = 'HMS_CARD';
  readonly supportedTypes: PaymentType[] = ['ORDER', 'RECURRING'];

  constructor() {
    // HMS API 초기화 (Adapter 제거하고 Provider에서 직접 관리)
    this.hmsApi = HmsApiFactory.createForCard();

    const apiType =
      this.hmsApi instanceof MockHmsAPI
        ? 'Mock (PaymentProfiles 미지원)'
        : 'HMS Test Server';
    this.logger.log(`HMS 카드 Provider 초기화 완료 - ${apiType} 사용`);
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    this.logger.log(
      `HMS 카드 결제 처리 시작 - Intent: ${request.intentId}, Amount: ${request.amount}KRW`,
    );

    // Profile 기반 결제만 지원
    if (!request.profileId) {
      throw new Error('HMS 카드는 저장된 프로필이 필요합니다');
    }

    const amountKRW = Money.toKRWInt(request.amount);
    Money.validate(amountKRW);

    try {
      // Mock API 환경에서는 PaymentTransaction 미지원
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentTransactions' in this.hmsApi)
      ) {
        this.logger.log('Mock 환경: HMS 카드 결제 시뮬레이션');

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
        memberId: request.metadata?.hmsMemberId || request.profileId,
        callAmount: amountKRW,
        cardPointFlag: 'N',
        vatAmount: Math.floor(amountKRW * 0.1), // 부가세 계산 (10%)
      };

      this.logger.log(
        'HMS API 결제 요청 데이터:',
        JSON.stringify(paymentRequest, null, 2),
      );

      // HMS API 호출
      const response =
        await this.hmsApi.paymentTransactions.requestTransaction(
          paymentRequest,
        );

      this.logger.log('HMS API 결제 응답:', JSON.stringify(response, null, 2));

      // 응답 처리
      if (response.payment?.result?.flag === 'SUCCESS') {
        return {
          success: true,
          transactionId: response.payment.transactionId,
          captureId: response.payment.transactionId, // 카드는 즉시 확정
          metadata: {
            provider: 'hms_card',
            method: 'recurring',
            approvalNumber: response.payment.approvalNumber,
            paymentDate: response.payment.paymentDate,
            actualAmount: response.payment.actualAmount,
            fee: response.payment.fee || 0,
            rawResponse: response,
          },
        };
      } else {
        return {
          success: false,
          transactionId: response.payment?.transactionId || '',
          error: `HMS 카드 결제 실패: ${response.payment?.result?.message || '알 수 없는 오류'}`,
          metadata: {
            provider: 'hms_card',
            rawResponse: response,
          },
        };
      }
    } catch (error) {
      this.logger.error(
        `HMS 카드 결제 실패 - Intent: ${request.intentId}`,
        error,
      );
      return {
        success: false,
        transactionId: '',
        error: `HMS 카드 결제 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    this.logger.log(
      `HMS 카드 환불 처리 시작 - RefundId: ${request.refundId}, Amount: ${request.amount}KRW`,
    );

    const refundAmountKRW = Money.toKRWInt(request.amount);
    Money.validate(refundAmountKRW);

    try {
      // Mock API 환경에서는 환불 시뮬레이션
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentTransactions' in this.hmsApi)
      ) {
        this.logger.log('Mock 환경: HMS 카드 환불 시뮬레이션');

        const mockRefundId = `MOCK_REFUND_${getTsid().toString()}`;
        return {
          success: true,
          refundId: mockRefundId,
          refundedAmount: refundAmountKRW,
          metadata: {
            provider: 'hms_card',
            method: 'refund_mock',
            refundDate: new Date().toISOString(),
            originalTransactionId: request.originalTransactionId,
            rawResponse: {
              refund: {
                result: { flag: 'SUCCESS', message: 'Mock 환불 성공' },
                refundId: mockRefundId,
                refundAmount: refundAmountKRW,
                refundDate: new Date().toISOString(),
              },
            },
          },
        };
      }

      // HMS API 환불 요청 (transactionId만 전달)
      const response = await this.hmsApi.paymentTransactions.cancelTransaction(
        request.originalTransactionId,
      );

      this.logger.log('HMS API 환불 응답:', JSON.stringify(response, null, 2));

      // 환불 응답 처리 (response.payment 속성 사용)
      if (response.payment?.result?.flag === 'SUCCESS') {
        return {
          success: true,
          refundId: response.payment.transactionId,
          refundedAmount: response.payment.cancelAmount || refundAmountKRW,
          pgTransactionId: response.payment.transactionId,
          metadata: {
            provider: 'hms_card',
            method: 'refund',
            refundDate: response.payment.cancelDate,
            originalTransactionId: request.originalTransactionId,
            rawResponse: response,
          },
        };
      } else {
        return {
          success: false,
          refundId: request.refundId,
          refundedAmount: 0,
          error: `HMS 카드 환불 실패: ${response.payment?.result?.message || '알 수 없는 오류'}`,
          metadata: {
            provider: 'hms_card',
            rawResponse: response,
          },
        };
      }
    } catch (error) {
      this.logger.error(
        `HMS 카드 환불 실패 - RefundId: ${request.refundId}`,
        error,
      );
      return {
        success: false,
        refundId: request.refundId,
        refundedAmount: 0,
        error: `HMS 카드 환불 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }

  async registerProfile(
    request: ProfileRegistrationRequest,
  ): Promise<ProfileRegistrationResult> {
    this.logger.log(
      `HMS 카드 프로필 등록 시작 - UserId: ${request.userId}, Type: ${request.profileType}`,
    );

    if (request.profileType !== 'CARD') {
      throw new Error('HMS 카드 Provider는 CARD 타입만 지원합니다');
    }

    if (!request.paymentNumber || !request.payerName || !request.payerNumber) {
      throw new Error(
        '카드 등록에는 카드번호, 카드소유자명, 생년월일이 필요합니다',
      );
    }

    if (!request.validUntil || !request.password) {
      throw new Error(
        '카드 등록에는 유효기간(MMYY)과 비밀번호 앞 2자리가 필요합니다',
      );
    }

    try {
      // Mock API 환경에서는 프로필 등록 시뮬레이션
      if (
        this.hmsApi instanceof MockHmsAPI ||
        !('paymentProfiles' in this.hmsApi)
      ) {
        this.logger.log('Mock 환경: HMS 카드 프로필 등록 시뮬레이션');

        const mockProfileId = `MOCK_PROFILE_${getTsid().toString()}`;
        const mockHmsMemberId = `HMS_${getTsid().toString()}`;

        return {
          success: true,
          profileId: mockProfileId,
          hmsMemberId: mockHmsMemberId,
          metadata: {
            providerId: this.providerId,
            paymentNumber: request.paymentNumber,
            payerName: request.payerName,
            method: 'register_mock',
            registrationDate: new Date().toISOString(),
            rawResponse: {
              profile: {
                result: { flag: 'SUCCESS', message: 'Mock 프로필 등록 성공' },
                profileId: mockProfileId,
                hmsMemberId: mockHmsMemberId,
                registrationDate: new Date().toISOString(),
              },
            },
          },
        };
      }

      // HMS API 프로필 등록 요청 (callableSchema.ts 기준 - 정확한 필드만)
      const hmsMemberId = getTsid().toString().substring(0, 21); // 21자 이하 TSID

      // validUntil(MMYY)을 validMonth(MM), validYear(YY)로 분리
      const validUntil =
        request.validUntil || request.metadata?.validUntil || '1225';
      const validMonth = validUntil.substring(0, 2); // MM
      const validYear = validUntil.substring(2, 4); // YY

      const profileRequest: CreatePaymentProfileDto = {
        memberId: hmsMemberId, // TSID 기반 21자 이하
        memberName: request.payerName!, // 카드 소유자명
        phone: request.phone!, // 전화번호 (필수)
        paymentKind: 'CARD', // 고정값
        paymentNumber: request.paymentNumber!, // 카드번호
        payerName: request.payerName!, // 납부자명 (카드 소유자명과 동일)
        payerNumber: request.payerNumber!, // 생년월일 6자리
        validYear: validYear, // 유효기간 년도 YY (MMYY에서 분리)
        validMonth: validMonth, // 유효기간 월 MM (MMYY에서 분리)
        password: request.password!, // 비밀번호 앞 2자리
      };

      this.logger.log(
        'HMS API 프로필 등록 요청:',
        JSON.stringify({ ...profileRequest, paymentNumber: '****' }, null, 2),
      );

      const response = await this.hmsApi.paymentProfiles.create(profileRequest);

      this.logger.log(
        'HMS API 프로필 등록 응답:',
        JSON.stringify(response, null, 2),
      );

      // 프로필 등록 응답 처리 (response.member 속성 사용)
      if (response.member?.result?.flag === 'Y') {
        this.logger.log(
          `✅ HMS 카드 프로필 등록 성공: ${response.member.result.message}`,
        );
        return {
          success: true,
          profileId: response.member.memberId,
          hmsMemberId: response.member.memberId,
          metadata: {
            providerId: this.providerId,
            method: 'register',
            registrationDate: response.member.joinDate,
            rawResponse: response,
          },
        };
      } else {
        this.logger.error(
          `❌ HMS 카드 프로필 등록 실패: ${response.member?.result?.message || '알 수 없는 오류'}`,
        );
        return {
          success: false,
          profileId: '',
          error: `HMS 카드 프로필 등록 실패: ${response.member?.result?.message || '알 수 없는 오류'}`,
          metadata: {
            providerId: this.providerId,
            rawResponse: response,
          },
        };
      }
    } catch (error) {
      this.logger.error(
        `HMS 카드 프로필 등록 실패 - UserId: ${request.userId}`,
        error,
      );
      return {
        success: false,
        profileId: '',
        error: `HMS 카드 프로필 등록 실패: ${error.message}`,
        metadata: { providerId: this.providerId },
      };
    }
  }
}
