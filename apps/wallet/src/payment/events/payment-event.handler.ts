import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import {
  PaymentAuthorizedEvent,
  PaymentCapturedEvent,
  PaymentFailedEvent,
  SettlementBatchStartedEvent,
  SettlementBatchCompletedEvent,
} from './payment.events';

/**
 * Payment 이벤트 핸들러 - 부가적 후속 조치 전담
 *
 * 이 핸들러는 동기적 브릿지 패턴의 일부로, PaymentService가 모든 핵심 DB 작업을
 * 완료한 후 발행하는 이벤트를 수신하여 부가적인 후속 조치만을 처리합니다.
 *
 * 아키텍처 원칙:
 * 1. 핵심 DB 작업 금지: INSERT, UPDATE 등 데이터 변경 작업을 수행하지 않음
 * 2. 부가적 작업만 수행: 알림, 외부 시스템 연동, 모니터링 등
 * 3. 격리된 실행: 에러가 발생해도 원본 트랜잭션에 영향을 주지 않음
 * 4. 재시도 가능: 필요시 재시도 로직을 통해 안정성 확보
 */
@Injectable()
export class PaymentEventHandler {
  private readonly logger = new Logger(PaymentEventHandler.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    // 실제 프로젝트에서는 아래와 같은 서비스들을 주입받습니다:
    // private readonly notificationService: NotificationService,
    // private readonly slackService: SlackNotificationService,
    // private readonly kafkaProducer: KafkaProducerService,
    // private readonly metricsService: MetricsService,
    // private readonly emailService: EmailService,
  ) {}

  /**
   * 결제 승인 완료 후 부가적인 후속 조치 처리
   *
   * PaymentService가 모든 핵심 작업을 완료한 후 발행하는 이벤트를 처리합니다.
   * 이 시점에는 이미:
   * - PaymentEvent가 DB에 저장됨
   * - BnplTransaction이 DB에 저장됨
   * - Invoice가 PAID 상태로 업데이트됨
   *
   * @param event 결제 승인 이벤트 정보
   */
  @OnEvent('payment.authorized')
  async handleAuthorized(event: PaymentAuthorizedEvent) {
    this.logger.log(
      `[부가 작업] 결제 승인 후속 처리 시작: PaymentEvent ${event.paymentEventId}`,
    );

    try {
      // ─────────────────────────────────────────
      // Step 1: 필요시 전체 정보 조회 (읽기 전용)
      // ─────────────────────────────────────────
      const paymentInfo = await this.dbService.db.query.paymentEvents.findFirst(
        {
          where: eq(schema.paymentEvents.id, event.paymentEventId),
          with: {
            paymentSession: true, // 결제 세션 정보
            paymentMethod: {
              with: {
                batchCms: true, // BNPL 상세 정보
              },
            },
          },
        },
      );

      if (!paymentInfo) {
        this.logger.error(
          `[부가 작업] 결제 정보를 찾을 수 없습니다: ${event.paymentEventId}`,
        );
        return;
      }

      // ─────────────────────────────────────────
      // Step 2: 사용자 알림 처리
      // ─────────────────────────────────────────
      try {
        this.logger.log(
          `[부가 작업] 사용자 ${paymentInfo.paymentSession.userId}에게 결제 완료 알림 전송`,
        );

        // 실제 구현 예시:
        // await this.notificationService.sendPaymentSuccessNotification({
        //   userId: paymentInfo.paymentSession.userId,
        //   amount: Number(paymentInfo.amount),
        //   paymentSessionId: paymentInfo.paymentSessionId,
        //   paymentMethod: paymentInfo.paymentMethod.methodName,
        //   nextBillingDate: this.calculateNextBillingDate(paymentInfo.paymentMethod.batchCms?.billingCycleDay),
        // });

        // 이메일 전송 예시:
        // await this.emailService.sendPaymentConfirmationEmail({
        //   userId: paymentInfo.paymentSession.userId,
        //   paymentSessionId: paymentInfo.paymentSessionId,
        //   amount: Number(paymentInfo.amount),
        //   paymentDate: new Date(),
        //   paymentMethod: paymentInfo.paymentMethod.methodType,
        // });

        this.logger.log(`[부가 작업] 사용자 알림 전송 완료`);
      } catch (notificationError) {
        // 알림 실패는 결제 자체에 영향을 주지 않음
        this.logger.error(
          `[부가 작업] 사용자 알림 전송 실패:`,
          notificationError,
        );
        // 실제 구현에서는 재시도 큐에 넣거나 모니터링 알림 발송
      }

      // ─────────────────────────────────────────
      // Step 3: 내부 운영팀 알림
      // ─────────────────────────────────────────
      try {
        if (Number(paymentInfo.amount) >= 1000000) {
          // 100만원 이상 고액 결제
          this.logger.log(`[부가 작업] 고액 결제 운영팀 알림`);

          // 실제 구현 예시:
          // await this.slackService.sendHighValuePaymentAlert({
          //   amount: Number(paymentInfo.amount),
          //   userId: paymentInfo.paymentSession.userId,
          //   paymentSessionId: paymentInfo.paymentSessionId,
          //   paymentMethod: paymentInfo.paymentMethod.methodType,
          //   timestamp: new Date(),
          // });
        }
      } catch (slackError) {
        this.logger.error(`[부가 작업] Slack 알림 전송 실패:`, slackError);
      }

      // ─────────────────────────────────────────
      // Step 4: 외부 시스템 연동
      // ─────────────────────────────────────────
      try {
        // 배송 시스템에 결제 완료 알림
        this.logger.log(`[부가 작업] 배송 시스템 연동 시작`);

        // 실제 구현 예시:
        // await this.kafkaProducer.send('fulfillment-topic', {
        //   eventType: 'PAYMENT_COMPLETED',
        //   paymentSessionId: paymentInfo.paymentSessionId,
        //   userId: paymentInfo.paymentSession.userId,
        //   paidAt: new Date(),
        //   amount: Number(paymentInfo.amount),
        // });

        // 재고 시스템 연동
        // await this.kafkaProducer.send('inventory-topic', {
        //   eventType: 'ORDER_PAID',
        //   paymentSessionId: paymentInfo.paymentSessionId,
        //   timestamp: new Date(),
        // });

        this.logger.log(`[부가 작업] 외부 시스템 연동 완료`);
      } catch (kafkaError) {
        this.logger.error(`[부가 작업] Kafka 메시지 발행 실패:`, kafkaError);
        // 실제 구현에서는 DLQ(Dead Letter Queue)로 전송
      }

      // ─────────────────────────────────────────
      // Step 5: 메트릭 수집 및 모니터링
      // ─────────────────────────────────────────
      try {
        // 결제 성공 메트릭 기록
        // await this.metricsService.recordPaymentSuccess({
        //   paymentMethod: paymentInfo.paymentMethod.methodType,
        //   amount: Number(paymentInfo.amount),
        //   userId: paymentInfo.paymentSession.userId,
        // });

        // 실시간 대시보드 업데이트
        // await this.metricsService.updateDashboard({
        //   totalRevenue: Number(paymentInfo.amount),
        //   paymentCount: 1,
        //   paymentMethod: paymentInfo.paymentMethod.methodType,
        // });

        this.logger.log(`[부가 작업] 메트릭 수집 완료`);
      } catch (metricsError) {
        this.logger.error(`[부가 작업] 메트릭 수집 실패:`, metricsError);
      }

      // ─────────────────────────────────────────
      // Step 6: BNPL 특화 처리
      // ─────────────────────────────────────────
      if (
        paymentInfo.paymentMethod.methodType === 'BNPL' &&
        paymentInfo.paymentMethod.batchCms
      ) {
        try {
          const billingDay = paymentInfo.paymentMethod.batchCms.billingCycleDay;
          const nextBillingDate = this.calculateNextBillingDate(billingDay);

          this.logger.log(
            `[부가 작업] BNPL 다음 결제일 알림 준비: ${nextBillingDate}`,
          );

          // 다음 결제일 리마인더 스케줄링
          // await this.schedulerService.scheduleReminder({
          //   userId: paymentInfo.paymentSession.userId,
          //   type: 'BNPL_PAYMENT_DUE',
          //   scheduledFor: new Date(nextBillingDate),
          //   data: {
          //     amount: Number(paymentInfo.amount),
          //     paymentSessionId: paymentInfo.paymentSessionId,
          //   }
          // });
        } catch (bnplError) {
          this.logger.error(`[부가 작업] BNPL 후속 처리 실패:`, bnplError);
        }
      }

      this.logger.log(
        `[부가 작업] 결제 승인 후속 처리 완료: PaymentEvent ${event.paymentEventId}`,
      );
    } catch (error) {
      // 최상위 에러 핸들러 - 어떤 에러가 발생해도 원본 트랜잭션에는 영향 없음
      this.logger.error(
        `[부가 작업] 후속 처리 중 예상치 못한 에러 발생:`,
        error,
      );

      // 실제 구현에서는 에러 추적 시스템에 보고
      // await this.errorTrackingService.captureException(error, {
      //   context: 'payment.authorized.handler',
      //   paymentEventId: event.paymentEventId,
      // });
    }
  }

  /**
   * 결제 캡처 완료 후 부가적인 후속 조치 처리
   */
  @OnEvent('payment.captured')
  async handleCaptured(event: PaymentCapturedEvent) {
    this.logger.log(
      `[부가 작업] 결제 캡처 후속 처리 시작: PaymentEvent ${event.paymentEventId}`,
    );

    try {
      // 캡처 완료 알림 (주로 BNPL 정산 요청 완료 알림)
      // await this.notificationService.sendCaptureNotification({
      //   paymentEventId: event.paymentEventId,
      //   status: event.status,
      //   capturedAt: event.timestamp,
      // });

      // 정산 시스템에 알림
      // await this.settlementService.notifyCapture({
      //   paymentEventId: event.paymentEventId,
      //   amount: event.amount,
      //   capturedAt: event.timestamp,
      // });

      this.logger.log(`[부가 작업] 결제 캡처 후속 처리 완료`);
    } catch (error) {
      this.logger.error(`[부가 작업] 결제 캡처 후속 처리 실패:`, error);
    }
  }

  /**
   * 결제 실패 후 부가적인 후속 조치 처리
   */
  @OnEvent('payment.failed')
  async handleFailed(event: PaymentFailedEvent) {
    this.logger.log(
      `[부가 작업] 결제 실패 후속 처리 시작: PaymentEvent ${event.paymentEventId}`,
    );

    try {
      // 결제 실패 정보 조회
      const failedPayment =
        await this.dbService.db.query.paymentEvents.findFirst({
          where: eq(schema.paymentEvents.id, event.paymentEventId),
          with: {
            paymentSession: true,
            paymentMethod: true,
          },
        });

      if (!failedPayment) {
        this.logger.error(`[부가 작업] 실패한 결제 정보를 찾을 수 없습니다`);
        return;
      }

      // 사용자에게 결제 실패 알림
      // await this.notificationService.sendPaymentFailureNotification({
      //   userId: failedPayment.paymentSession.userId,
      //   reason: event.reason,
      //   paymentSessionId: failedPayment.paymentSessionId,
      //   amount: Number(failedPayment.amount),
      // });

      // 운영팀 알림 (반복적인 실패 또는 특정 패턴 감지)
      // if (await this.shouldAlertOperations(failedPayment.paymentSession.userId)) {
      //   await this.slackService.sendPaymentFailureAlert({
      //     userId: failedPayment.paymentSession.userId,
      //     paymentEventId: event.paymentEventId,
      //     reason: event.reason,
      //     amount: Number(failedPayment.amount),
      //   });
      // }

      // 실패 메트릭 기록
      // await this.metricsService.recordPaymentFailure({
      //   paymentMethod: failedPayment.paymentMethod.methodType,
      //   reason: event.reason,
      //   amount: Number(failedPayment.amount),
      // });

      this.logger.log(`[부가 작업] 결제 실패 후속 처리 완료`);
    } catch (error) {
      this.logger.error(`[부가 작업] 결제 실패 후속 처리 중 에러:`, error);
    }
  }

  /**
   * 정산 배치 시작 이벤트 처리
   */
  @OnEvent('settlement.batch.started')
  async handleBatchStarted(event: SettlementBatchStartedEvent) {
    this.logger.log(
      `[부가 작업] 정산 배치 시작 모니터링: Batch ${event.batchId}`,
    );

    try {
      // 정산 시작 알림
      // await this.slackService.sendSettlementStartNotification({
      //   batchId: event.batchId,
      //   totalAmount: event.totalAmount,
      //   transactionCount: event.transactionCount,
      //   startedAt: new Date(),
      // });

      // 모니터링 대시보드 업데이트
      // await this.metricsService.recordSettlementStart({
      //   batchId: event.batchId,
      //   amount: event.totalAmount,
      //   count: event.transactionCount,
      // });

      this.logger.log(
        `[부가 작업] 정산 배치 시작 알림 완료: ` +
          `${event.transactionCount}건, ${event.totalAmount}원`,
      );
    } catch (error) {
      this.logger.error(`[부가 작업] 정산 시작 알림 실패:`, error);
    }
  }

  /**
   * 정산 배치 완료 이벤트 처리
   */
  @OnEvent('settlement.batch.completed')
  async handleBatchCompleted(event: SettlementBatchCompletedEvent) {
    this.logger.log(`[부가 작업] 정산 배치 완료 처리: Batch ${event.batchId}`);

    try {
      if (event.status === 'COMPLETED') {
        // 정산 성공 알림
        // await this.slackService.sendSettlementSuccessNotification({
        //   batchId: event.batchId,
        //   totalAmount: event.totalAmount,
        //   completedAt: new Date(),
        // });
        // 회계 시스템 연동
        // await this.accountingService.recordSettlement({
        //   batchId: event.batchId,
        //   amount: event.totalAmount,
        //   date: new Date(),
        // });
      } else {
        // 정산 실패 알림 및 에스컬레이션
        // await this.slackService.sendSettlementFailureAlert({
        //   batchId: event.batchId,
        //   totalAmount: event.totalAmount,
        //   status: event.status,
        //   failedAt: new Date(),
        // });
        // 실패한 정산에 대한 자동 재시도 스케줄링
        // await this.schedulerService.scheduleRetry({
        //   type: 'SETTLEMENT_RETRY',
        //   targetId: event.batchId,
        //   retryAfter: new Date(Date.now() + 3600000), // 1시간 후
        // });
      }

      // 정산 완료 메트릭
      // await this.metricsService.recordSettlementComplete({
      //   batchId: event.batchId,
      //   status: event.status,
      //   amount: event.totalAmount,
      // });

      this.logger.log(`[부가 작업] 정산 배치 완료 처리 완료`);
    } catch (error) {
      this.logger.error(`[부가 작업] 정산 완료 처리 중 에러:`, error);
    }
  }

  /**
   * 다음 결제일 계산 헬퍼 메서드
   */
  private calculateNextBillingDate(billingDay?: number): Date {
    const today = new Date();
    const currentDay = today.getDate();
    const targetDay = billingDay || 15; // 기본값 15일

    let nextBillingDate: Date;
    if (currentDay <= targetDay) {
      // 이번 달 결제일이 아직 안 지났으면 이번 달
      nextBillingDate = new Date(
        today.getFullYear(),
        today.getMonth(),
        targetDay,
      );
    } else {
      // 이번 달 결제일이 지났으면 다음 달
      nextBillingDate = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        targetDay,
      );
    }

    return nextBillingDate;
  }

  /**
   * 운영팀 알림이 필요한지 판단하는 헬퍼 메서드
   */
  private async shouldAlertOperations(userId: string): Promise<boolean> {
    // 실제 구현에서는 최근 실패 횟수, 패턴 등을 분석
    // 예: 24시간 내 3회 이상 실패, 특정 에러 코드 반복 등
    return false; // 임시 구현
  }
}
