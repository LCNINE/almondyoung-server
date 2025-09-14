import { Injectable, Logger } from '@nestjs/common';
import {
  ChargePort,
  HmsBnplPayload,
  PaymentResult,
  ProviderType,
} from './payment-provider.interface';

@Injectable()
export class HmsBnplChargeProvider
  implements ChargePort<ProviderType.HMS_BNPL>
{
  private readonly logger = new Logger(HmsBnplChargeProvider.name);

  async process(payload: HmsBnplPayload): Promise<PaymentResult> {
    this.logger.log(
      `➡️ HMS BNPL 결제 처리 - MemberId: ${payload.memberId}, Amount: ${payload.captureAmount}`,
    );

    try {
      // 기존 processPayload 로직을 그대로 가져옵니다.
      // BNPL은 즉시 승인 처리 (실제 정산은 배치로 이루어짐)
      const transactionId = `BNPL_${Date.now()}`;

      this.logger.log(`✅ HMS BNPL 결제 승인 완료 - TxId: ${transactionId}`);

      return {
        success: true,
        transactionId: transactionId,
        code: 'SUCCESS',
        message: 'BNPL 정산 승인 완료',
        raw: {
          invoiceId: payload.invoiceId,
          memberId: payload.memberId,
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ HMS BNPL 결제 실패: ${error.message}`, error.stack);
      return {
        success: false,
        code: 'BNPL_PROCESSING_ERROR',
        message: `BNPL 결제 실패: ${error.message}`,
        raw: error,
      };
    }
  }
}
