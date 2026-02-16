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
      `➡️ HMS BNPL 내부 승인 - MemberId: ${payload.memberId}, Amount: ${payload.captureAmount}`,
    );

    const transactionId = `BNPL_${Date.now()}`;
    this.logger.log(`✅ HMS BNPL 승인 완료 - TxId: ${transactionId}`);

    // ⚠️ 여기서는 DB를 건드리지 않음. Executor가 한도 차감/이벤트 insert 처리.
    return {
      success: true,
      transactionId,
      code: 'SUCCESS',
      message: 'BNPL 내부 승인 완료',
      raw: { invoiceId: payload.invoiceId, memberId: payload.memberId },
    };
  }
}
