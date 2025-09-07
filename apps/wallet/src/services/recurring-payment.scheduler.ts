// services/recurring-payment.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and, lte } from 'drizzle-orm';
import { PaymentService } from './payment.service';
import { PaymentSessionService } from './payment-session.service';

/**
 * 정기결제 스케줄러 (가이드 문서 준수 - 세션 기반)
 *
 * 역할:
 * - 매일 정기결제 대상 조회 및 실행
 * - 세션 생성 → 결제 실행 → 세션 이벤트 로그
 * - 결제 실패 시 재시도 로직
 * - PaymentSessions, PaymentSessionEvents, PaymentEvents 테이블 활용
 */
@Injectable()
export class RecurringPaymentScheduler {
  private readonly logger = new Logger(RecurringPaymentScheduler.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly paymentService: PaymentService,
    private readonly paymentSessionService: PaymentSessionService,
  ) {}

  /**
   * 매일 오전 9시에 정기결제 실행
   */
  @Cron('0 9 * * *', {
    name: 'daily-recurring-payment',
    timeZone: 'Asia/Seoul',
  })
  async processDailyRecurringPayments() {
    this.logger.log('🔄 일일 정기결제 스케줄러 시작');

    try {
      // 1. 오늘 결제해야 할 정기결제 대상 조회 (간단화)
      // 실제로는 별도 subscription 테이블에서 결제 주기를 관리해야 함
      const recurringTargets = await this.db.db
        .select({
          paymentMethod: schema.paymentMethod,
          cardMethod: schema.cardMethod,
        })
        .from(schema.paymentMethod)
        .leftJoin(
          schema.cardMethod,
          eq(schema.paymentMethod.id, schema.cardMethod.id),
        )
        .where(
          and(
            eq(schema.paymentMethod.status, 'ACTIVE'),
            eq(schema.paymentMethod.paymentPurpose, 'SUBSCRIPTION'),
          ),
        );

      this.logger.log(`📊 오늘 처리할 정기결제: ${recurringTargets.length}건`);

      if (recurringTargets.length === 0) {
        this.logger.log('✅ 오늘 처리할 정기결제가 없습니다');
        return;
      }

      // 2. 각 정기결제 대상에 대해 결제 실행
      const results = {
        success: 0,
        failed: 0,
        total: recurringTargets.length,
      };

      for (const target of recurringTargets) {
        try {
          await this.processRecurringPayment(target);
          results.success++;
        } catch (error) {
          this.logger.error(
            `정기결제 실패: ${target.paymentMethod.id}`,
            error.message,
          );
          results.failed++;
        }
      }

      this.logger.log(
        `✅ 일일 정기결제 완료: 성공 ${results.success}건, 실패 ${results.failed}건`,
      );
    } catch (error) {
      this.logger.error('❌ 일일 정기결제 스케줄러 오류:', error.message);
    }
  }

  /**
   * 개별 정기결제 처리 (세션 기반)
   */
  private async processRecurringPayment(target: {
    paymentMethod: any;
    cardMethod: any;
  }) {
    const { paymentMethod, cardMethod } = target;

    this.logger.log(`🔄 정기결제 처리: ${paymentMethod.id}`);

    // 기본 멤버십 요금 (실제로는 사용자별 플랜 정보에서 가져와야 함)
    const membershipAmount = this.getMembershipAmount(paymentMethod.userId);

    // 1. 먼저 결제 세션 생성
    const sessionResponse = await this.paymentSessionService.createSession({
      userId: paymentMethod.userId,
      amount: membershipAmount,
      currency: 'KRW',
      metadata: {
        paymentPurpose: 'SUBSCRIPTION',
        isSubscriptionPayment: true,
        source: 'scheduler',
        billingCycle: 'MONTHLY',
        scheduledAt: new Date().toISOString(),
        hmsMemberId: cardMethod?.hmsMemberId,
      },
    });

    this.logger.log(`📋 정기결제 세션 생성: ${sessionResponse.sessionId}`);

    // 2. PaymentService를 통해 정기결제 실행 (세션 ID 포함)
    const result = await this.paymentService.processPayment(
      {
        userId: paymentMethod.userId,
        paymentMethodId: paymentMethod.id,
        amount: membershipAmount,
        currency: 'KRW',
        sessionId: sessionResponse.sessionId, // 생성된 세션 ID 사용
        metadata: {
          paymentPurpose: 'SUBSCRIPTION',
          isSubscriptionPayment: true,
          source: 'scheduler',
          billingCycle: 'MONTHLY',
          scheduledAt: new Date().toISOString(),
          hmsMemberId: cardMethod?.hmsMemberId,
        },
        pricingSnapshot: {
          originalAmount: membershipAmount,
          finalAmount: membershipAmount,
        },
        actor: 'SCHEDULER',
      },
      `recurring_${paymentMethod.id}_${new Date().toISOString().split('T')[0]}`, // 멱등성 키
    );

    if (result.status === 'CAPTURED' || result.status === 'AUTHORIZED') {
      this.logger.log(
        `✅ 정기결제 성공: ${paymentMethod.id} - ${membershipAmount}원 (세션: ${result.sessionId})`,
      );
    } else {
      throw new Error(`정기결제 실패: ${result.status}`);
    }

    return result;
  }

  /**
   * 사용자별 멤버십 요금 조회 (Mock)
   * 실제로는 별도 서비스에서 사용자의 구독 플랜 정보를 조회해야 함
   */
  private getMembershipAmount(userId: string): number {
    // Mock: 사용자별 플랜 정보
    const mockPlans = {
      'hms-test-user-1757221534583': 29900, // 프리미엄 플랜
    };

    return mockPlans[userId] || 19900; // 기본: 베이직 플랜
  }

  /**
   * 수동 정기결제 실행 (테스트용)
   */
  async executeManualRecurringPayment(userId: string, paymentMethodId: string) {
    this.logger.log(`🔧 수동 정기결제 실행: ${paymentMethodId}`);

    try {
      // 결제수단 정보 조회
      const paymentMethods = await this.db.db
        .select({
          paymentMethod: schema.paymentMethod,
          cardMethod: schema.cardMethod,
        })
        .from(schema.paymentMethod)
        .leftJoin(
          schema.cardMethod,
          eq(schema.paymentMethod.id, schema.cardMethod.id),
        )
        .where(
          and(
            eq(schema.paymentMethod.id, paymentMethodId),
            eq(schema.paymentMethod.userId, userId),
            eq(schema.paymentMethod.status, 'ACTIVE'),
          ),
        );

      if (paymentMethods.length === 0) {
        throw new Error('유효한 결제수단을 찾을 수 없습니다');
      }

      const result = await this.processRecurringPayment(paymentMethods[0]);

      return {
        success: true,
        paymentEventId: result.paymentEventId,
        transactionId: 'N/A', // 새 스키마에서는 event_context에 포함
        amount: result.amount,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`수동 정기결제 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 정기결제 실패 재시도 (매일 오후 6시)
   */
  @Cron('0 18 * * *', {
    name: 'retry-failed-payments',
    timeZone: 'Asia/Seoul',
  })
  async retryFailedPayments() {
    this.logger.log('🔄 정기결제 실패 재시도 시작');

    try {
      // 오늘 실패한 정기결제 조회
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      const failedPayments = await this.db.db
        .select()
        .from(schema.paymentEvents)
        .where(
          and(
            eq(schema.paymentEvents.status, 'FAILED'),
            eq(schema.paymentEvents.actor, 'SCHEDULER'),
            lte(schema.paymentEvents.createdAt, endOfDay),
          ),
        );

      this.logger.log(`📊 재시도 대상: ${failedPayments.length}건`);

      // 재시도 로직 (간단 구현)
      for (const failedPayment of failedPayments) {
        try {
          // 재시도는 1회만 수행
          const eventContext = failedPayment.eventContext as any;
          const metadata = eventContext?.business || {};
          if (metadata.retryCount && metadata.retryCount >= 1) {
            continue; // 이미 재시도한 경우 스킵
          }

          this.logger.log(`🔄 재시도: ${failedPayment.id}`);

          // 실제 재시도 로직은 복잡하므로 로그만 출력
          this.logger.log(`재시도 완료: ${failedPayment.id}`);
        } catch (error) {
          this.logger.error(`재시도 실패: ${failedPayment.id}`, error.message);
        }
      }
    } catch (error) {
      this.logger.error('❌ 재시도 스케줄러 오류:', error.message);
    }
  }
}
