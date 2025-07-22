import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BnplPaymentMethodRegisteredEvent } from '../../payment-method/events/bnpl-payment-method-registered.event';
import { BnplAccountService } from '../services/bnpl-account.service';
import {
  BnplAccountCreatedEvent,
  BnplCreditUsedEvent,
  BnplCreditRestoredEvent,
  BnplCreditLimitChangedEvent,
  BnplAccountStatusChangedEvent,
} from '../events/bnpl.events';

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
    this.logger.log(`📨 'bnpl.method.registered' 이벤트 수신`, payload);
    try {
      // 실제 계정 생성 로직은 서비스에게 위임합니다.
      await this.bnplAccountService.createFromEvent(payload);
      this.logger.log(`✅ BNPL 계정 생성 완료: ${payload.userId}`);
    } catch (error) {
      this.logger.error(`❌ BNPL 계정 생성 실패: ${payload.userId}`, error);
      throw error;
    }
  }

  /**
   * BNPL 계정 생성 이벤트 처리
   */
  @OnEvent('bnpl.account.created')
  async handleBnplAccountCreated(event: BnplAccountCreatedEvent) {
    this.logger.log(`📨 BNPL 계정 생성 이벤트 처리: ${event.bnplAccountId}`);

    try {
      // 이미 BnplAccountService에서 계정을 생성했으므로 여기서는 로깅만 수행
      this.logger.log(
        `✅ BNPL 계정 생성 이벤트 처리 완료: userId=${event.userId}, 한도=${event.approvedLimit}원`,
      );

      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
    } catch (error) {
      this.logger.error(`❌ BNPL 계정 생성 이벤트 처리 실패: ${event.bnplAccountId}`, error);
    }
  }

  /**
   * BNPL 신용 한도 사용 이벤트 처리
   */
  @OnEvent('bnpl.credit.used')
  async handleBnplCreditUsed(event: BnplCreditUsedEvent) {
    this.logger.log(`📨 BNPL 신용 한도 사용 이벤트 처리: ${event.bnplAccountId}`);

    try {
      // 신용 한도 사용 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ BNPL 신용 한도 사용 이벤트 처리 완료: userId=${event.userId}, 사용액=${event.amount}원, 잔여한도=${event.remainingCredit}원`,
      );
    } catch (error) {
      this.logger.error(`❌ BNPL 신용 한도 사용 이벤트 처리 실패: ${event.bnplAccountId}`, error);
    }
  }

  /**
   * BNPL 신용 한도 복원 이벤트 처리
   */
  @OnEvent('bnpl.credit.restored')
  async handleBnplCreditRestored(event: BnplCreditRestoredEvent) {
    this.logger.log(`📨 BNPL 신용 한도 복원 이벤트 처리: ${event.bnplAccountId}`);

    try {
      // 신용 한도 복원 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ BNPL 신용 한도 복원 이벤트 처리 완료: userId=${event.userId}, 복원액=${event.amount}원, 가용한도=${event.newAvailableCredit}원`,
      );
    } catch (error) {
      this.logger.error(`❌ BNPL 신용 한도 복원 이벤트 처리 실패: ${event.bnplAccountId}`, error);
    }
  }

  /**
   * BNPL 신용 한도 변경 이벤트 처리
   */
  @OnEvent('bnpl.credit.limit.changed')
  async handleBnplCreditLimitChanged(event: BnplCreditLimitChangedEvent) {
    this.logger.log(`📨 BNPL 신용 한도 변경 이벤트 처리: ${event.bnplAccountId}`);

    try {
      // 신용 한도 변경 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ BNPL 신용 한도 변경 이벤트 처리 완료: userId=${event.userId}, 이전한도=${event.oldLimit}원, 새한도=${event.newLimit}원, 사유=${event.reason}`,
      );
    } catch (error) {
      this.logger.error(`❌ BNPL 신용 한도 변경 이벤트 처리 실패: ${event.bnplAccountId}`, error);
    }
  }

  /**
   * BNPL 계정 상태 변경 이벤트 처리
   */
  @OnEvent('bnpl.account.status.changed')
  async handleBnplAccountStatusChanged(event: BnplAccountStatusChangedEvent) {
    this.logger.log(`📨 BNPL 계정 상태 변경 이벤트 처리: ${event.bnplAccountId}`);

    try {
      // 계정 상태 변경 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ BNPL 계정 상태 변경 이벤트 처리 완료: userId=${event.userId}, 이전상태=${event.oldStatus}, 새상태=${event.newStatus}, 사유=${event.reason}`,
      );
    } catch (error) {
      this.logger.error(`❌ BNPL 계정 상태 변경 이벤트 처리 실패: ${event.bnplAccountId}`, error);
    }
  }
}
