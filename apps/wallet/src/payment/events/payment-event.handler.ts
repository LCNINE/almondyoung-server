import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PaymentAuthorizedEvent,
  PaymentCapturedEvent,
  PaymentFailedEvent,
} from './payment.events';

@Injectable()
export class PaymentEventHandler {
  private readonly logger = new Logger(PaymentEventHandler.name);

  @OnEvent('payment.authorized')
  handleAuthorized(event: PaymentAuthorizedEvent) {
    this.logger.log(`Payment authorized: paymentId=${event.paymentId}`);
    // TODO: 알림 발송, 외부 시스템 연동 등
  }

  @OnEvent('payment.captured')
  handleCaptured(event: PaymentCapturedEvent) {
    this.logger.log(`Payment captured: paymentId=${event.paymentId}`);
    // TODO: 회계 시스템 연동 등
  }

  @OnEvent('payment.failed')
  handleFailed(event: PaymentFailedEvent) {
    this.logger.warn(
      `Payment failed: paymentId=${event.paymentId}, reason=${event.reason}`,
    );
    // TODO: 장애 알림, 롤백 등
  }
}
