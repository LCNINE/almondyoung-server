import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { ulid } from 'ulid';
import {
  SettlementBatchCreatedEvent,
  SettlementBatchStartedEvent,
  SettlementBatchCompletedEvent,
  SettlementBatchFailedEvent,
  SettlementBatchItemAddedEvent,
  SettlementBatchStatusChangedEvent,
} from '../events/settlement.events';

/**
 * Settlement 이벤트 리스너 - Event Sourcing Pattern
 * 모든 정산 배치 관련 이벤트를 수신하여 처리합니다.
 */
@Injectable()
export class SettlementEventHandler {
  private readonly logger = new Logger(SettlementEventHandler.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
  ) {}

  /**
   * 정산 배치 생성 이벤트 처리
   */
  @OnEvent('settlement.batch.created')
  async handleSettlementBatchCreated(event: SettlementBatchCreatedEvent) {
    this.logger.log(`📨 정산 배치 생성 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 생성 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ 정산 배치 생성 이벤트 처리 완료: batchId=${event.batchId}, 총액=${event.totalAmount}원, 거래수=${event.transactionCount}건`,
      );
    } catch (error) {
      this.logger.error(`❌ 정산 배치 생성 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 시작 이벤트 처리
   */
  @OnEvent('settlement.batch.started')
  async handleSettlementBatchStarted(event: SettlementBatchStartedEvent) {
    this.logger.log(`📨 정산 배치 시작 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 시작 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 모니터링 등)
      this.logger.log(
        `✅ 정산 배치 시작 이벤트 처리 완료: batchId=${event.batchId}, 총액=${event.totalAmount}원, 거래수=${event.transactionCount}건`,
      );

      // 🔔 운영팀에 정산 시작 알림 (선택사항)
      // await this.notificationService.notifySettlementStarted(event);
    } catch (error) {
      this.logger.error(`❌ 정산 배치 시작 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 완료 이벤트 처리
   */
  @OnEvent('settlement.batch.completed')
  async handleSettlementBatchCompleted(event: SettlementBatchCompletedEvent) {
    this.logger.log(`📨 정산 배치 완료 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 완료 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (알림 발송, 통계 업데이트 등)
      this.logger.log(
        `✅ 정산 배치 완료 이벤트 처리 완료: batchId=${event.batchId}, 상태=${event.status}, 총액=${event.totalAmount}원`,
      );

      // 🔔 운영팀에 정산 완료 알림 (선택사항)
      // await this.notificationService.notifySettlementCompleted(event);

      // 📊 정산 통계 업데이트 (선택사항)
      // await this.statisticsService.updateSettlementStats(event);
    } catch (error) {
      this.logger.error(`❌ 정산 배치 완료 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 실패 이벤트 처리
   */
  @OnEvent('settlement.batch.failed')
  async handleSettlementBatchFailed(event: SettlementBatchFailedEvent) {
    this.logger.log(`📨 정산 배치 실패 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 실패 로그 기록 (필요시)
      // 추가 작업이 필요한 경우 여기에 구현 (긴급 알림 발송, 에러 추적 등)
      this.logger.error(
        `⚠️ 정산 배치 실패 이벤트 처리 완료: batchId=${event.batchId}, 사유=${event.reason}, 총액=${event.totalAmount}원`,
      );

      // 🚨 운영팀에 긴급 알림 (필수)
      // await this.notificationService.notifySettlementFailed(event);

      // 📝 실패 로그를 별도 테이블에 기록 (선택사항)
      // await this.errorTrackingService.recordSettlementFailure(event);
    } catch (error) {
      this.logger.error(`❌ 정산 배치 실패 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 아이템 추가 이벤트 처리
   */
  @OnEvent('settlement.batch.item.added')
  async handleSettlementBatchItemAdded(event: SettlementBatchItemAddedEvent) {
    this.logger.log(`📨 정산 배치 아이템 추가 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 아이템 추가 로그 기록 (필요시)
      this.logger.log(
        `✅ 정산 배치 아이템 추가 이벤트 처리 완료: batchId=${event.batchId}, transactionId=${event.bnplTransactionId}, 금액=${event.amount}원`,
      );
    } catch (error) {
      this.logger.error(`❌ 정산 배치 아이템 추가 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }

  /**
   * 정산 배치 상태 변경 이벤트 처리
   */
  @OnEvent('settlement.batch.status.changed')
  async handleSettlementBatchStatusChanged(event: SettlementBatchStatusChangedEvent) {
    this.logger.log(`📨 정산 배치 상태 변경 이벤트 처리: ${event.batchId}`);

    try {
      // 정산 배치 상태 변경 로그 기록 (필요시)
      this.logger.log(
        `✅ 정산 배치 상태 변경 이벤트 처리 완료: batchId=${event.batchId}, ${event.oldStatus} → ${event.newStatus}, 사유=${event.reason}`,
      );

      // 📊 상태별 통계 업데이트 (선택사항)
      // await this.statisticsService.updateBatchStatusStats(event);
    } catch (error) {
      this.logger.error(`❌ 정산 배치 상태 변경 이벤트 처리 실패: ${event.batchId}`, error);
    }
  }
}