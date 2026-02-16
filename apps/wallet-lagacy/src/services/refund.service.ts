import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { OutboxService } from './outbox/outbox.service';
import { eq, desc, sql } from 'drizzle-orm';
import { PointService } from './points/point.service';
import { ProviderRegistry } from '../providers/provider-registry';
import { ProviderType } from '../providers/payment-provider.interface';
import { generateUUIDv7 } from '../shared/utils/id-generator';

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
    private readonly outboxService: OutboxService,
  ) {}

  /**
   * 결제 환불 처리
   *
   * @param intentId - 환불할 결제 의도 ID
   * @param amount - 환불 금액 (미지정 시 전액 - Original Amount 기준)
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
    refundId?: string;
  }> {
    const refundId = generateUUIDv7(); // 환불 ID 생성

    try {
      return await this.db.db.transaction(async (tx) => {
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

        // 스키마 변경 반영: totalAmount -> originalAmount
        const totalAmount = intent.originalAmount;
        // 환불 요청 금액이 없으면 전체 금액(originalAmount)을 환불 대상으로 설정
        const refundAmount = amount ?? totalAmount;

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
        // 스키마 변경 반영: discounts 배열 제거됨 -> discountAmount 사용
        const discountsTotal = intent.discountAmount || 0;

        const ratio = refundAmount / totalAmount;
        const pointsToRefund = Math.floor(discountsTotal * ratio);
        const cashToRefund = refundAmount - pointsToRefund;

        this.logger.log(
          `환불 금액 분할: 포인트=${pointsToRefund}, 현금=${cashToRefund}, 비율=${ratio}`,
        );

        // 5. 포인트 복원 (결제 시 사용한 포인트만 복원)
        if (pointsToRefund > 0) {
          // 주의: discounts 배열이 삭제되어 포인트/쿠폰 구분이 불가능합니다.
          // 현재 로직은 discountAmount가 존재하면 포인트로 간주하고 복원합니다.
          // 추후 OMS 연동 등을 통해 정확한 소스 구분이 필요할 수 있습니다.

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
        const newStatus: 'REFUNDED' | 'PARTIALLY_REFUNDED' =
          newRefundedAmount >= totalAmount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

        await tx
          .update(schema.paymentIntents)
          .set({
            status: newStatus,
            refundedAmount: newRefundedAmount,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentIntents.id, intentId));

        // 8. 환불 기록 생성
        const attemptResult = await tx
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.intentId, intentId))
          .orderBy(desc(schema.paymentAttempts.createdAt))
          .limit(1)
          .then((rows) => rows[0]);

        const paymentId = attemptResult?.id || '';

        await tx.insert(schema.paymentRefunds).values({
          intentId,
          attemptId: paymentId,
          amount: refundAmount,
          status: 'COMPLETED',
          reason,
          completedAt: new Date(),
          completedBy: 'SYSTEM',
          metadata: {
            pointsRefunded: pointsToRefund,
            cashRefunded: cashToRefund,
            refundId: refundId,
          },
        });

        // 9. Outbox에 이벤트 저장 - RefundCompleted
        await this.outboxService.enqueue(
          {
            eventType: 'RefundCompleted',
            aggregateType: 'Refund',
            aggregateId: refundId,
            partitionKey: intent.customerId,
            payload: {
              refundId: refundId,
              paymentId: paymentId,
              intentId: intentId,
              customerId: intent.customerId,
              amount: refundAmount,
              currency: 'KRW', // 스키마에서 삭제됨, KRW 고정
              providerRefundId: attemptResult?.transactionId,
              // 스키마 변경 반영: orderId -> merchantReferenceId
              orderId: intent.merchantReferenceId,
              referenceType: intent.referenceType,
              discountsRefunded: pointsToRefund,
            },
          },
          tx,
        );

        return {
          success: true,
          refunded: {
            points: pointsToRefund,
            cash: cashToRefund,
            total: refundAmount,
          },
          status: newStatus,
          refundId: refundId,
        };
      });
    } catch (error) {
      const errorObj = error as Error;
      this.logger.error(
        `환불 처리 실패: intentId=${intentId}, refundId=${refundId}`,
        errorObj.stack,
      );

      // Intent 정보 조회 (이벤트 발행용)
      const intent = await this.db.db
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      const attemptResult = await this.db.db
        .select()
        .from(schema.paymentAttempts)
        .where(eq(schema.paymentAttempts.intentId, intentId))
        .orderBy(desc(schema.paymentAttempts.createdAt))
        .limit(1)
        .then((rows) => rows[0]);

      // Outbox에 이벤트 저장 - RefundFailed
      if (intent) {
        // 실패 시에도 originalAmount 기준으로 시도했던 금액을 기록
        const refundAmount = amount ?? intent.originalAmount;

        // 트랜잭션 밖이므로 tx 없이 호출
        await this.outboxService.enqueue({
          eventType: 'RefundFailed',
          aggregateType: 'Refund',
          aggregateId: refundId,
          partitionKey: intent.customerId,
          payload: {
            refundId: refundId,
            paymentId: attemptResult?.id || '',
            intentId: intentId,
            customerId: intent.customerId,
            amount: refundAmount,
            currency: 'KRW',
            errorCode:
              (errorObj as Error & { code?: string }).code || 'REFUND_FAILED',
            errorMessage: errorObj.message || 'Refund processing failed',
            orderId: intent.merchantReferenceId,
            referenceType: intent.referenceType,
            requiresManualProcessing: true,
            failedAt: new Date().toISOString(),
          },
        });
      }

      throw error;
    }
  }

  /**
   * 환불 요청 생성 (Phase 2)
   *
   * 실제 환불 처리 전에 요청만 생성하고 승인 대기
   */
  async requestRefund(
    intentId: string,
    amount?: number,
    reason: string = 'CUSTOMER_REQUEST',
    requestedBy?: string,
  ): Promise<{
    success: boolean;
    refundId: string;
    status: string;
  }> {
    const refundId = generateUUIDv7();

    return this.db.db.transaction(async (tx) => {
      // 1. Intent 조회
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, intentId))
        .then((rows) => rows[0]);

      if (!intent) {
        throw new Error(`Intent not found: ${intentId}`);
      }

      // 2. 환불 가능 상태 체크
      if (!['AUTHORIZED', 'CAPTURED'].includes(intent.status)) {
        throw new Error(`Cannot refund intent in ${intent.status} status`);
      }

      const refundAmount = amount ?? intent.originalAmount;

      // 3. 환불 요청 레코드 생성
      const attemptResult = await tx
        .select()
        .from(schema.paymentAttempts)
        .where(eq(schema.paymentAttempts.intentId, intentId))
        .orderBy(desc(schema.paymentAttempts.createdAt))
        .limit(1)
        .then((rows) => rows[0]);

      await tx.insert(schema.paymentRefunds).values({
        intentId,
        attemptId: attemptResult?.id || '',
        amount: refundAmount,
        status: 'REQUESTED', // 승인 대기
        reason,
        // requestedBy 필드가 없으므로 metadata에 저장
        metadata: {
          refundId: refundId,
          requestedBy: requestedBy || 'CUSTOMER',
        },
      });

      // 4. Outbox에 이벤트 저장 - RefundRequested
      await this.outboxService.enqueue(
        {
          eventType: 'RefundRequested',
          aggregateType: 'Refund',
          aggregateId: refundId,
          partitionKey: intent.customerId,
          payload: {
            refundId: refundId,
            paymentId: attemptResult?.id || '',
            intentId: intentId,
            customerId: intent.customerId,
            amount: refundAmount,
            currency: 'KRW',
            reason: reason,
            reasonDetail: undefined,
            orderId: intent.merchantReferenceId,
            referenceType: intent.referenceType,
            requestedBy: requestedBy,
            requiresApproval: true,
            requestedAt: new Date().toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `환불 요청 생성: refundId=${refundId}, intentId=${intentId}`,
      );

      return {
        success: true,
        refundId: refundId,
        status: 'REQUESTED' as const,
      };
    });
  }

  /**
   * 환불 승인 (Phase 2)
   *
   * WMS 검수 완료 후 호출됨
   */
  async approveRefund(
    refundId: string,
    approvedBy?: string,
    approvalReason?: string,
  ): Promise<{
    success: boolean;
    status: string;
  }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 환불 요청 조회
      const refund = await tx
        .select()
        .from(schema.paymentRefunds)
        // Drizzle의 SQL 연산자를 사용하여 JSONB 내부 검색
        .where(
          sql`${schema.paymentRefunds.metadata}->>'refundId' = ${refundId}`,
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!refund) {
        throw new Error(`Refund not found: ${refundId}`);
      }

      if (refund.status !== 'REQUESTED') {
        throw new Error(`Refund is not in REQUESTED status: ${refund.status}`);
      }

      // 2. Intent 조회
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, refund.intentId))
        .then((rows) => rows[0]);

      if (!intent) {
        throw new Error(`Intent not found: ${refund.intentId}`);
      }

      // 3. 환불 요청 상태 업데이트
      await tx
        .update(schema.paymentRefunds)
        .set({
          status: 'APPROVED',
          completedBy: approvedBy || 'SYSTEM',
          completedAt: new Date(),
        })
        .where(
          sql`${schema.paymentRefunds.metadata}->>'refundId' = ${refundId}`,
        );

      // 4. Outbox에 이벤트 저장 - RefundApproved
      await this.outboxService.enqueue(
        {
          eventType: 'RefundApproved',
          aggregateType: 'Refund',
          aggregateId: refundId,
          partitionKey: intent.customerId,
          payload: {
            refundId: refundId,
            paymentId: refund.attemptId,
            intentId: refund.intentId,
            customerId: intent.customerId,
            amount: refund.amount,
            currency: 'KRW',
            orderId: intent.merchantReferenceId,
            referenceType: intent.referenceType,
            returnId: undefined,
            approvedBy: approvedBy,
            approvalReason: approvalReason,
            approvedAt: new Date().toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `환불 승인 완료: refundId=${refundId}, approvedBy=${approvedBy}`,
      );

      return {
        success: true,
        status: 'APPROVED' as const,
      };
    });
  }

  /**
   * 환불 거부 (Phase 2)
   *
   * 반품 검수 불합격 시 호출됨
   */
  async rejectRefund(
    refundId: string,
    rejectionReason: string,
    rejectedBy?: string,
    requiresCustomerContact: boolean = true,
  ): Promise<{
    success: boolean;
    status: string;
  }> {
    return this.db.db.transaction(async (tx) => {
      // 1. 환불 요청 조회
      const refund = await tx
        .select()
        .from(schema.paymentRefunds)
        .where(
          sql`${schema.paymentRefunds.metadata}->>'refundId' = ${refundId}`,
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!refund) {
        throw new Error(`Refund not found: ${refundId}`);
      }

      if (refund.status !== 'REQUESTED') {
        throw new Error(`Refund is not in REQUESTED status: ${refund.status}`);
      }

      // 2. Intent 조회
      const intent = await tx
        .select()
        .from(schema.paymentIntents)
        .where(eq(schema.paymentIntents.id, refund.intentId))
        .then((rows) => rows[0]);

      if (!intent) {
        throw new Error(`Intent not found: ${refund.intentId}`);
      }

      // 3. 환불 요청 상태 업데이트
      // REJECTED 상태가 스키마 Enum에 없으므로 CANCELLED 혹은 FAILED 사용 (여기선 CANCELLED 사용)
      await tx
        .update(schema.paymentRefunds)
        .set({
          status: 'CANCELLED',
          reason: rejectionReason,
          completedBy: rejectedBy || 'SYSTEM',
          completedAt: new Date(),
        })
        .where(
          sql`${schema.paymentRefunds.metadata}->>'refundId' = ${refundId}`,
        );

      // 4. Outbox에 이벤트 저장 - RefundRejected
      await this.outboxService.enqueue(
        {
          eventType: 'RefundRejected',
          aggregateType: 'Refund',
          aggregateId: refundId,
          partitionKey: intent.customerId,
          payload: {
            refundId: refundId,
            paymentId: refund.attemptId,
            intentId: refund.intentId,
            customerId: intent.customerId,
            amount: refund.amount,
            currency: 'KRW',
            orderId: intent.merchantReferenceId,
            referenceType: intent.referenceType,
            returnId: undefined,
            rejectionReason: rejectionReason,
            rejectionDetail: undefined,
            rejectedBy: rejectedBy,
            requiresCustomerContact: requiresCustomerContact,
            rejectedAt: new Date().toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `환불 거부 완료: refundId=${refundId}, reason=${rejectionReason}`,
      );

      return {
        success: true,
        status: 'CANCELLED' as const,
      };
    });
  }
}
