import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import { EventPayloadOf } from '@packages/event-contracts/types';
import { ArrearsRepaymentService } from '../services/arrears/arrears-repayment.service';
import { isArrearsPayment } from '../services/arrears/arrears-payment.metadata';

/**
 * 미수 청산 결제의 «유일한» 권위 신호.
 *
 * 청산 결제는 무통장으로만 받으므로(멤버십 요금 정책) 결제 화면을 떠나는 시점엔 아직 입금 전이다.
 * 실제로 돈이 들어온 것은 관리자가 입금을 확인해 intent 가 CAPTURED 로 바뀔 때 이 이벤트로 온다.
 * 브라우저 콜백을 믿으면 돈은 들어왔는데 원장이 안 닫히거나, 그 반대가 된다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class ArrearsPaymentConsumer {
  private readonly logger = new Logger(ArrearsPaymentConsumer.name);

  constructor(private readonly arrearsRepaymentService: ArrearsRepaymentService) {}

  @On(PAYMENT_STREAM, 'payment.intent.captured')
  async onIntentCaptured(@EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.captured'>) {
    if (!isArrearsPayment(payload.metadata)) return;

    this.logger.log(`[arrears] 청산 결제 CAPTURED 감지: intentId=${payload.intentId}`);
    await this.arrearsRepaymentService.settleFromCapturedIntent(payload.intentId);
  }
}
