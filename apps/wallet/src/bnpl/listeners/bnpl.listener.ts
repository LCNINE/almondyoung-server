import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { BnplAccountService } from '../services/bnpl-account.service';

/**
 * BNPL 관련 이벤트를 수신하는 리스너
 */
@Injectable()
export class BnplListener {
  private readonly logger = new Logger(BnplListener.name);

  constructor(private readonly bnplAccountService: BnplAccountService) {}

  /**
   * BNPL 결제수단 등록 이벤트를 처리합니다.
   * @param payload 이벤트와 함께 전달된 데이터
   */
  @OnEvent('bnpl.method.registered', { async: true }) // 비동기 처리를 권장
  async handleBnplMethodRegisteredEvent(
    payload: BnplPaymentMethodRegisteredEvent,
  ) {
    this.logger.log(`'bnpl.method.registered' 이벤트 수신`, payload);
    // 실제 계정 생성 로직은 서비스에게 위임합니다.
    await this.bnplAccountService.createFromEvent(payload);
  }
}
