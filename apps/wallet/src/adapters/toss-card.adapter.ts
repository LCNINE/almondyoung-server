// adapters/toss-card.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentMethodAdapterPort,
  RegisterMethodRequest,
  RegisterMethodResult,
  VerificationResult,
  DeactivationResult,
} from '../ports/payment-method-adapter.port';

/**
 * 토스 카드 어댑터 (예시 구현 - 주석처리 예정)
 * TODO: 실제 토스 API 연동 시 활성화
 */
@Injectable()
export class TossCardAdapter implements PaymentMethodAdapterPort {
  private readonly logger = new Logger(TossCardAdapter.name);

  // TODO: 실제 구현 시 TossApiService 주입
  // constructor(private readonly tossApi: TossApiService) {}

  async register(
    request: RegisterMethodRequest,
  ): Promise<RegisterMethodResult> {
    this.logger.log(`토스 카드 등록 시작: ${request.userId}`);

    try {
      // 비동기 대기를 위한 Promise 사용
      await new Promise((resolve) => setTimeout(resolve, 1)); // Mock 지연

      // TODO: 실제 토스 API 호출
      /*
      const [expiryMonth, expiryYear] = request.cardInfo!.expiryDate.split('/');
      const tokenizeResult = await this.tossApi.registerCard({
        cardNumber: request.cardInfo!.cardNumber,
        expiryMonth,
        expiryYear: `20${expiryYear}`, // YY -> YYYY 변환
        customerKey: request.userId,
        cardholderName: request.cardInfo!.cardHolderName,
      });

      if (tokenizeResult.success) {
        return {
          success: true,
          pgToken: tokenizeResult.customerKey,
          billingKey: tokenizeResult.billingKey,
          maskedCardNumber: tokenizeResult.maskedCardNumber,
          metadata: {
            cardBrand: tokenizeResult.cardBrand,
            cardType: tokenizeResult.cardType,
            issuerName: tokenizeResult.issuerName,
          }
        };
      }

      return {
        success: false,
        error: tokenizeResult.errorMessage || '카드 등록에 실패했습니다',
      };
      */

      // MVP: Mock 응답 (개발/테스트용)
      const mockMaskedNumber = this.maskCardNumber(
        request.cardInfo!.cardNumber,
      );

      return {
        success: true,
        pgToken: `toss_customer_${request.userId}_${Date.now()}`,
        billingKey: `toss_billing_${Math.random().toString(36).substring(2, 15)}`,
        maskedCardNumber: mockMaskedNumber,
        metadata: {
          cardBrand: this.detectCardBrand(request.cardInfo!.cardNumber),
          cardType: 'CREDIT', // Mock
          issuerName: 'Mock Bank',
          registeredAt: new Date().toISOString(),
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`토스 카드 등록 실패: ${errorMessage}`, errorStack);
      return {
        success: false,
        error: '카드 등록 처리 중 오류가 발생했습니다',
      };
    }
  }

  async verify(): Promise<VerificationResult> {
    // TODO: 실제 구현
    /*
    const cardMethod = await this.getCardMethod(methodId);
    const isValid = await this.tossApi.verifyBillingKey(cardMethod.billingKey);
    */

    // Mock - await 추가
    await new Promise((resolve) => setTimeout(resolve, 1));

    return {
      isValid: true,
      message: '카드 사용 가능',
    };
  }

  async deactivate(methodId: string): Promise<DeactivationResult> {
    // TODO: 실제 구현
    /*
    const cardMethod = await this.getCardMethod(methodId);
    await this.tossApi.deleteBillingKey(cardMethod.billingKey);
    */

    // Mock - await 추가
    await new Promise((resolve) => setTimeout(resolve, 1));

    this.logger.log(`토스 카드 비활성화: ${methodId}`);

    return {
      success: true,
      message: '카드가 비활성화되었습니다',
    };
  }

  // === 헬퍼 메서드들 ===

  private maskCardNumber(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');
    const lastFour = cleaned.slice(-4);
    return `**** **** **** ${lastFour}`;
  }

  private detectCardBrand(cardNumber: string): string {
    const cleaned = cardNumber.replace(/\D/g, '');

    if (cleaned.startsWith('4')) return 'VISA';
    if (cleaned.startsWith('5') || cleaned.startsWith('2')) return 'MASTERCARD';
    if (cleaned.startsWith('3')) return 'AMEX';

    return 'UNKNOWN';
  }

  // TODO: 실제 구현 시 사용
  /*
  private async getCardMethod(methodId: string) {
    return await this.db.db
      .select()
      .from(schema.cardMethod)
      .where(eq(schema.cardMethod.id, methodId))
      .limit(1);
  }
  */
}
