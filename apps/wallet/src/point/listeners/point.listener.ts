import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PointService } from '../point.service';

/**
 * 포인트 이벤트 리스너
 * 다른 모듈에서 발생하는 이벤트를 수신하여 포인트를 자동으로 적립/회수합니다.
 *
 * 이벤트 기반 연동으로 다른 시스템과 느슨한 결합을 유지합니다.
 */
@Injectable()
export class PointListener {
  private readonly logger = new Logger(PointListener.name);

  // 포인트 적립률 설정 (1% = 0.01)
  private readonly POINT_EARN_RATE = 0.01;

  constructor(private readonly pointService: PointService) {}

  /**
   * 결제 완료 이벤트 처리
   * SettlementService에서 최종 정산이 성공(CAPTURED)했을 때 포인트를 자동 적립
   */
  @OnEvent('payment.completed')
  async handlePaymentCompleted(event: any) {
    this.logger.log(`결제 완료 이벤트 수신: ${JSON.stringify(event)}`);

    try {
      // 이벤트에서 필요한 정보 추출
      const { paymentEventId, userId, amount, invoiceId } = event;

      if (!userId || !amount) {
        this.logger.warn('결제 완료 이벤트에 필요한 정보가 없습니다:', event);
        return;
      }

      // 포인트 적립 금액 계산 (1% 적립)
      const pointAmount = Math.floor(amount * this.POINT_EARN_RATE);

      if (pointAmount <= 0) {
        this.logger.log(`포인트 적립 금액이 0 이하입니다: ${pointAmount}`);
        return;
      }

      // 포인트 적립
      const result = await this.pointService.addPoints({
        userId,
        amount: pointAmount,
        reason: `결제 완료 적립 (주문: ${invoiceId || paymentEventId})`,
        relatedEventId: paymentEventId,
        expiresAt: this.calculateExpiryDate(), // 1년 후 만료
      });

      if (result.success) {
        this.logger.log(
          `포인트 자동 적립 완료: userId=${userId}, amount=${pointAmount}P, 새 잔액=${result.currentBalance}P`,
        );
      } else {
        this.logger.error(
          `포인트 자동 적립 실패: userId=${userId}, amount=${pointAmount}P, error=${result.message}`,
        );
      }
    } catch (error) {
      this.logger.error('결제 완료 이벤트 처리 실패:', error);
    }
  }

  /**
   * 환불 완료 이벤트 처리
   * RefundService에서 환불이 최종 완료(COMPLETED)되었을 때 포인트를 자동 회수
   */
  @OnEvent('refund.completed.points')
  async handleRefundCompleted(event: any) {
    this.logger.log(`환불 완료 이벤트 수신: ${JSON.stringify(event)}`);

    try {
      // 이벤트에서 필요한 정보 추출
      const { refundId, refundAmount, originalPaymentEventId, userId } = event;

      if (!userId || !refundAmount) {
        this.logger.warn('환불 완료 이벤트에 필요한 정보가 없습니다:', event);
        return;
      }

      // 환불 금액에 대응하는 포인트 회수 금액 계산 (1% 회수)
      const pointAmount = Math.floor(refundAmount * this.POINT_EARN_RATE);

      if (pointAmount <= 0) {
        this.logger.log(`포인트 회수 금액이 0 이하입니다: ${pointAmount}`);
        return;
      }

      // 포인트 차감 (회수)
      const result = await this.pointService.deductPoints({
        userId,
        amount: pointAmount,
        reason: `환불 완료로 인한 포인트 회수 (환불ID: ${refundId})`,
        relatedEventId: refundId,
      });

      if (result.success) {
        this.logger.log(
          `포인트 자동 회수 완료: userId=${userId}, amount=${pointAmount}P, 새 잔액=${result.currentBalance}P`,
        );
      } else {
        this.logger.error(
          `포인트 자동 회수 실패: userId=${userId}, amount=${pointAmount}P, error=${result.message}`,
        );
      }
    } catch (error) {
      this.logger.error('환불 완료 이벤트 처리 실패:', error);
    }
  }

  /**
   * 포인트 만료일 계산 (1년 후)
   */
  private calculateExpiryDate(): Date {
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    return expiryDate;
  }
}
