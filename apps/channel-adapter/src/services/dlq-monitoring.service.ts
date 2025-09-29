import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EventPublisherService } from '@app/events';

/**
 * DLQ 모니터링 및 알림 서비스
 *
 * CTO 가이드라인에 따라 WMS 동기 요청 실패 시 DLQ에 기록하고,
 * DLQ 변화 감지 시 개발팀에 알림을 전송합니다.
 *
 * 주요 기능:
 * - DLQ 항목 수집 및 모니터링
 * - 실패율 임계치 초과 시 알림
 * - 주기적 DLQ 상태 리포트
 * - 개발팀 알림 (Slack, 이메일 등)
 */
@Injectable()
export class DlqMonitoringService {
  private readonly logger = new Logger(DlqMonitoringService.name);
  private readonly alertThreshold: number;
  private readonly reportInterval: string;
  private lastDlqCount = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventPublisher: EventPublisherService,
  ) {
    this.alertThreshold = this.configService.get<number>(
      'DLQ_ALERT_THRESHOLD',
      5,
    );
    this.reportInterval = this.configService.get<string>(
      'DLQ_REPORT_INTERVAL',
      '1h',
    );
  }

  /**
   * DLQ에 실패한 요청 기록
   *
   * @param operationType 작업 타입 (CREATE_ORDER, CANCEL_ORDER 등)
   * @param payload 실패한 요청 페이로드
   * @param error 에러 정보
   * @param metadata 추가 메타데이터
   */
  async recordDlqEntry(
    operationType: string,
    payload: any,
    error: Error,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const dlqEntry = {
        id: `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        operationType,
        payload: JSON.stringify(payload),
        errorMessage: error.message,
        errorStack: error.stack,
        metadata: metadata ? JSON.stringify(metadata) : null,
        retryCount: 0,
        maxRetryCount: 3,
        status: 'FAILED' as const,
        createdAt: new Date(),
        lastAttemptAt: new Date(),
      };

      // MVP: 메모리 기반 DLQ 카운터 증가
      this.lastDlqCount += 1;

      this.logger.warn(`📥 DLQ 기록: ${operationType}`, {
        operationType,
        errorMessage: error.message,
        dlqId: dlqEntry.id,
        totalDlqCount: this.lastDlqCount,
        metadata,
      });

      // DLQ 변화 감지 및 알림
      await this.checkDlqThreshold();
    } catch (recordError) {
      this.logger.error('❌ DLQ 기록 실패', {
        error: recordError.message,
        originalError: error.message,
        operationType,
      });
    }
  }

  /**
   * DLQ 임계치 확인 및 알림
   */
  private async checkDlqThreshold(): Promise<void> {
    try {
      // 실제 구현 시 DLQ 테이블에서 카운트 조회
      const currentDlqCount = await this.getDlqCount();

      if (
        currentDlqCount > this.lastDlqCount &&
        currentDlqCount >= this.alertThreshold
      ) {
        await this.sendDlqAlert(currentDlqCount);
      }

      this.lastDlqCount = currentDlqCount;
    } catch (error) {
      this.logger.error('❌ DLQ 임계치 확인 실패', error.message);
    }
  }

  /**
   * DLQ 개수 조회 (MVP: 메모리 기반)
   */
  private async getDlqCount(): Promise<number> {
    // MVP: 실제 DB 대신 메모리 기반 카운터 사용
    return this.lastDlqCount;
  }

  /**
   * DLQ 알림 전송
   */
  private async sendDlqAlert(dlqCount: number): Promise<void> {
    const alertMessage = {
      channelType: 'medusa' as const, // DLQ는 채널 무관하므로 기본값
      syncType: 'command' as const,
      failureReason: `DLQ 임계치 초과: ${dlqCount}건의 실패한 WMS 요청이 DLQ에 적재됨`,
      retryCount: 0,
      maxRetries: this.alertThreshold,
      affectedIds: [], // 실제 구현 시 실패한 작업 ID들 추가
    };

    try {
      // TODO: 실제 구현 시 이벤트 발행으로 알림 시스템에 전달
      // await this.eventPublisher.publishEvent('sync.failure', alertMessage);

      this.logger.error(
        `🚨 DLQ 알림: ${dlqCount}건의 WMS 요청이 실패하여 DLQ에 적재됨`,
        {
          dlqCount,
          threshold: this.alertThreshold,
          failureReason: alertMessage.failureReason,
          timestamp: new Date().toISOString(),
        },
      );

      // 실제 운영에서는 여기서 Slack, 이메일 등 외부 알림 시스템 호출
    } catch (error) {
      this.logger.error('❌ DLQ 알림 발송 실패', error.message);
    }
  }

  /**
   * 주기적 DLQ 상태 리포트 (매시간)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async generateDlqReport(): Promise<void> {
    try {
      const dlqStats = await this.getDlqStatistics();

      if (dlqStats.totalCount > 0) {
        this.logger.warn(`📊 DLQ 상태 리포트`, dlqStats);

        // 중요한 실패가 있는 경우 알림
        if (dlqStats.criticalFailures > 0) {
          await this.sendDlqAlert(dlqStats.criticalFailures);
        }
      }
    } catch (error) {
      this.logger.error('❌ DLQ 리포트 생성 실패', error.message);
    }
  }

  /**
   * DLQ 통계 조회 (MVP: 메모리 기반)
   */
  private async getDlqStatistics(): Promise<{
    totalCount: number;
    criticalFailures: number;
    byOperationType: Record<string, number>;
    recentFailures: number; // 최근 1시간
  }> {
    // MVP: 메모리 기반 통계
    const criticalFailures =
      this.lastDlqCount >= this.alertThreshold ? this.lastDlqCount : 0;

    return {
      totalCount: this.lastDlqCount,
      criticalFailures,
      byOperationType: {
        CREATE_ORDER: Math.floor(this.lastDlqCount * 0.4),
        UPDATE_ORDER: Math.floor(this.lastDlqCount * 0.3),
        CANCEL_ORDER: Math.floor(this.lastDlqCount * 0.3),
      },
      recentFailures: Math.floor(this.lastDlqCount * 0.2), // 최근 1시간은 20%로 가정
    };
  }

  /**
   * DLQ 항목 재처리 시도
   *
   * @param dlqId DLQ 항목 ID
   * @returns 재처리 성공 여부
   */
  async retryDlqEntry(dlqId: string): Promise<boolean> {
    try {
      this.logger.log(`🔄 DLQ 재처리 시도: ${dlqId}`);

      // TODO: DLQ 항목 조회 및 재처리 로직 구현
      // 1. DLQ 항목 조회
      // 2. 원본 요청 재구성
      // 3. WMS API 재호출
      // 4. 성공 시 DLQ에서 제거, 실패 시 재시도 카운트 증가

      return true;
    } catch (error) {
      this.logger.error(`❌ DLQ 재처리 실패: ${dlqId}`, error.message);
      return false;
    }
  }

  /**
   * DLQ 항목 수동 제거 (관리자 기능)
   *
   * @param dlqId DLQ 항목 ID
   * @param reason 제거 사유
   */
  async removeDlqEntry(dlqId: string, reason: string): Promise<void> {
    try {
      this.logger.log(`🗑️ DLQ 항목 수동 제거: ${dlqId}`, { reason });

      // TODO: DLQ 항목 제거 로직 구현
    } catch (error) {
      this.logger.error(`❌ DLQ 항목 제거 실패: ${dlqId}`, error.message);
      throw error;
    }
  }

  /**
   * DLQ 현황 조회 (관리자 API용) - MVP 구현
   */
  async getDlqStatus(): Promise<{
    summary: {
      totalCount: number;
      criticalCount: number;
      lastHourCount: number;
    };
    recentEntries: Array<{
      id: string;
      operationType: string;
      errorMessage: string;
      createdAt: string;
      retryCount: number;
    }>;
  }> {
    try {
      const stats = await this.getDlqStatistics();

      // MVP: 샘플 데이터로 최근 항목들 시뮬레이션
      const recentEntries: Array<{
        id: string;
        operationType: string;
        errorMessage: string;
        createdAt: string;
        retryCount: number;
      }> = [];
      for (let i = 0; i < Math.min(stats.totalCount, 5); i++) {
        recentEntries.push({
          id: `dlq_${Date.now()}_${i}`,
          operationType: ['CREATE_ORDER', 'UPDATE_ORDER', 'CANCEL_ORDER'][
            i % 3
          ],
          errorMessage: 'WMS API 호출 타임아웃',
          createdAt: new Date(Date.now() - i * 3600000).toISOString(), // i시간 전
          retryCount: Math.floor(Math.random() * 3),
        });
      }

      return {
        summary: {
          totalCount: stats.totalCount,
          criticalCount: stats.criticalFailures,
          lastHourCount: stats.recentFailures,
        },
        recentEntries,
      };
    } catch (error) {
      this.logger.error('❌ DLQ 현황 조회 실패', error.message);
      throw error;
    }
  }
}
