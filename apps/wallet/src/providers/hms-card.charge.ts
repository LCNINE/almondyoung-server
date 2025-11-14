import { Injectable, Logger } from '@nestjs/common';
import {
  ChargePort,
  HmsCardPayload,
  PaymentResult,
  ProviderType,
} from './payment-provider.interface';
import { HmsAPI, ApiClientFactory } from 'hms-api-wrapper'; // 실제 라이브러리 경로로 수정하세요.

@Injectable()
export class HmsCardChargeProvider
  implements ChargePort<ProviderType.HMS_CARD>
{
  private readonly logger = new Logger(HmsCardChargeProvider.name);
  private readonly hmsApi: HmsAPI;

  constructor() {
    const isTest = process.env.NODE_ENV !== 'production';
    this.logger.warn(
      `🔍 HMS Card Charge 초기화 - NODE_ENV: ${process.env.NODE_ENV}, isTest: ${isTest}`,
    );
    
    // 카드 결제도 api-test를 사용
    const baseURL = isTest 
      ? 'https://api-test.hyosungcms.co.kr/v1'
      : 'https://api.hyosungcms.co.kr/v1';
    
    this.hmsApi = new (require('hms-api-wrapper').HmsAPI)({
      swKey: process.env.SW_KEY || '',
      custKey: process.env.CUST_KEY || '',
      isTest: isTest,
      baseURL: baseURL,
    });
  }

  async process(payload: HmsCardPayload): Promise<PaymentResult> {
    this.logger.log(
      `➡️ HMS 카드 결제 - MemberId: ${payload.memberId}, Amount: ${payload.amount}`,
    );

    try {
      // 기존 processPayload 로직을 그대로 가져옵니다.
      const hmsReq = {
        transactionId: 'TX' + Date.now(), // 고유 ID 생성 방식은 비즈니스 로직에 맞게 조정
        memberId: payload.memberId,
        callAmount: payload.amount,
        vatAmount: Math.floor(payload.amount * 0.1), // 부가세 계산 로직
      };

      const resp =
        await this.hmsApi.paymentTransactions.requestTransaction(hmsReq);

      this.logger.log(`✅ HMS 카드 결제 성공 - TxId: ${hmsReq.transactionId}`);

      // 인터페이스 계약(PaymentResult)에 맞춰 결과를 반환합니다.
      const success = resp.payment.result.flag === 'Y';
      return {
        success: success,
        transactionId: hmsReq.transactionId,
        code: success ? 'SUCCESS' : 'HMS_PAYMENT_FAILED',
        message: resp.payment.result.message,
        raw: resp, // 디버깅을 위해 원본 응답을 포함
      };
    } catch (error: any) {
      this.logger.error(`❌ HMS 카드 결제 실패: ${error.message}`, error.stack);
      return {
        success: false,
        code: 'HMS_API_ERROR',
        message: `HMS 카드 API 연동 실패: ${error.message}`,
        raw: error,
      };
    }
  }
}
