import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { eq, desc } from 'drizzle-orm';
import { PointService } from './points/point.service';
import { ProviderRegistry } from '../providers/provider-registry';
import { ProviderType } from '../providers/payment-provider.interface';

/**
 * RefundService - 포인트 + 현금 혼합 환불 처리
 *
 * 주요 기능:
 * - 전액 환불 / 부분 환불 지원
 * - 포인트와 현금 비율 계산 (소수점 버림)
 * - BNPL 미정산건은 void, 정산완료건은 refund 처리
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly pointService: PointService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  /**
   * 결제 환불 처리
   *
   * @param intentId - 환불할 결제 의도 ID
   * @param amount - 환불 금액 (미지정 시 전액)
   * @param reason - 환불 사유
   * @returns 환불 결과
   */
  async refundPayment(
    intentId: string,
    amount?: number,
    reason: string = 'CUSTOMER_REQUEST',
  ): Promise<{
    success: boolean;
    refunded: {
      points: number;
      cash: number;
      total: number;
    };
    status: string;
  }> {
    return this.db.db.transaction(async (tx) => {
      // 1. Intent 조회 및 잠금
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .for('update')
        .then((rows) => rows[0]);

      if (!intent) {
        throw new Error(`Intent not found: ${intentId}`);
      }

      // 2. 환불 가능 상태 체크
      if (!['AUTHORIZED', 'CAPTURED'].includes(intent.status)) {
        throw new Error(`Cannot refund intent in ${intent.status} status`);
      }

      const refundAmount = amount ?? intent.amount;
      const totalAmount = intent.totalAmount || intent.amount;

      this.logger.log(
        `환불 처리 시작: intentId=${intentId}, amount=${refundAmount}, reason=${reason}`,
      );

      // 3. 누적 환불 검증 (동시성 제어 포함)
      const existingRefunds = await tx
        .select()
        .from(schema.paymentRefunds)
        .where(eq(schema.paymentRefunds.intentId, intentId))
        .for('update'); // 동시성 제어를 위한 락

      const totalRefunded = existingRefunds.reduce(
        (sum, r) => sum + Number(r.amount),
        0,
      );

      if (totalRefunded + refundAmount > totalAmount) {
        throw new Error(
          `환불 가능 금액 초과: 이미 ${totalRefunded}원 환불됨, ` +
            `요청 ${refundAmount}원, 총액 ${totalAmount}원`,
        );
      }

      this.logger.log(
        `환불 검증 통과: 누적 ${totalRefunded}원, 요청 ${refundAmount}원, 총액 ${totalAmount}원`,
      );

      // 4. 비율 계산 (소수점 버림)
      const discountsTotal = intent.discountsTotal || 0;

      const ratio = refundAmount / totalAmount;
      const pointsToRefund = Math.floor(discountsTotal * ratio);
      const cashToRefund = refundAmount - pointsToRefund;

      this.logger.log(
        `환불 금액 분할: 포인트=${pointsToRefund}, 현금=${cashToRefund}, 비율=${ratio}`,
      );

      // 5. 포인트 복원 (결제 시 사용한 포인트만 복원)
      // 주의: 구매로 적립된 포인트는 메두사의 취소 이벤트로 별도 처리
      if (pointsToRefund > 0) {
        // discounts 배열에서 포인트 정보 확인
        const discounts = (intent.discounts as any) || [];
        const pointDiscount = discounts.find((d: any) => d.type === 'POINTS');

        if (pointDiscount) {
          const partnerId = intent.customerId; // UUIDv7 (customerId와 동일)

          // ⚠️ 중요: 포인트 복원을 동일 트랜잭션에서 실행
          // 외부 환불 실패 시 포인트 복원도 함께 롤백됨
          await this.pointService.addPoints(
            {
              partnerId,
              amount: pointsToRefund,
              reason: 'REFUND',
              orderId: intentId,
              memo: reason,
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1년 후
              withdrawalAvailableAt: new Date(), // 즉시 출금 가능
            },
            tx, // ✅ 상위 트랜잭션 전파
          );

          this.logger.log(`포인트 복원 완료: ${pointsToRefund}원`);
        }
      }

      // 6. 현금 환불
      if (cashToRefund > 0) {
        const attempt = await tx
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.intentId, intentId))
          .orderBy(desc(schema.paymentAttempts.createdAt))
          .limit(1)
          .then((rows) => rows[0]);

        if (attempt) {
          const provider = this.providerRegistry.get(
            attempt.provider as ProviderType,
          );

          if (
            intent.status === 'AUTHORIZED' &&
            attempt.provider === 'HMS_BNPL'
          ) {
            // BNPL 미정산건: void 처리
            this.logger.log('BNPL 미정산건 void 처리');

            if (provider.cancel) {
              await provider.cancel.cancel({
                transactionId: attempt.transactionId || undefined,
                reason,
              });
            }
          } else {
            // 정산완료건: refund 처리
            this.logger.log('정산완료건 refund 처리');

            if (provider.refund) {
              await provider.refund.refund({
                transactionId: attempt.transactionId || undefined,
                paymentKey: attempt.transactionId || undefined,
                amount: cashToRefund,
                reason,
              });
            }
          }

          // Attempt 상태 업데이트
          await tx
            .update(schema.paymentAttempts)
            .set({
              status: 'CANCELLED',
              updatedAt: new Date(),
            })
            .where(eq(schema.paymentAttempts.id, attempt.id));

          this.logger.log(`현금 환불 완료: ${cashToRefund}원`);
        }
      }

      // 7. Intent 상태 업데이트
      const newRefundedAmount = intent.refundedAmount + refundAmount;
      const newStatus =
        newRefundedAmount === totalAmount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      await tx
        .update(schema.paymentIntents)
        .set({
          status: newStatus as any,
          refundedAmount: newRefundedAmount,
          updatedAt: new Date(),
        })
        .where(eq(schema.paymentIntents.id, intentId));

      // 8. 환불 기록 생성
      await tx.insert(schema.paymentRefunds).values({
        intentId,
        attemptId:
          (
            await tx
              .select()
              .from(schema.paymentAttempts)
              .where(eq(schema.paymentAttempts.intentId, intentId))
              .limit(1)
              .then((rows) => rows[0])
          )?.id || '',
        amount: refundAmount,
        status: 'COMPLETED',
        reason,
        completedAt: new Date(),
        completedBy: 'SYSTEM',
        metadata: {
          pointsRefunded: pointsToRefund,
          cashRefunded: cashToRefund,
        },
      });

      this.logger.log(
        `환불 처리 완료: intentId=${intentId}, status=${newStatus}`,
      );

      return {
        success: true,
        refunded: {
          points: pointsToRefund,
          cash: cashToRefund,
          total: refundAmount,
        },
        status: newStatus,
      };
    });
  }
}
