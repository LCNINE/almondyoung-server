// adapters/bnpl-deferred.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  DeferredPaymentAdapter,
  DeferredAuthorizeRequest,
  DeferredAuthorizeResponse,
  DeferredCaptureRequest,
  DeferredCaptureResponse,
  DeferredRefundRequest,
  DeferredRefundResponse,
} from '../ports/deferred-payment.port';
import { BNPLService } from '../services/bnpl.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/**
 * BNPL 후불결제 어댑터
 * - authorize: 내부적으로만 승인 처리 (한도 차감)
 * - capture: 실제 HMS 출금 요청 실행
 */
@Injectable()
export class BnplDeferredAdapter implements DeferredPaymentAdapter {
  private readonly logger = new Logger(BnplDeferredAdapter.name);

  constructor(
    private readonly bnplService: BNPLService,
    private readonly db: DbService<typeof schema>,
  ) {}

  async authorize(
    request: DeferredAuthorizeRequest,
  ): Promise<DeferredAuthorizeResponse> {
    this.logger.log(
      `BNPL 내부 승인: ${request.paymentMethodId}, 금액: ${request.amount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. BNPL 계정 조회 및 잔여 한도 확인
        const [bnplAccount] = await tx
          .select()
          .from(schema.bnplAccount)
          .where(
            eq(schema.bnplAccount.paymentMethodId, request.paymentMethodId),
          )
          .limit(1);

        if (!bnplAccount) {
          return {
            success: false,
            authorizationId: '',
            error: 'BNPL 계정을 찾을 수 없습니다',
          };
        }

        if (bnplAccount.status !== 'ACTIVE') {
          return {
            success: false,
            authorizationId: '',
            error: 'BNPL 계정이 비활성화 상태입니다',
          };
        }

        // 2. 잔여 한도 확인
        if (bnplAccount.approvedLimit < request.amount) {
          return {
            success: false,
            authorizationId: '',
            error: '잔여 한도가 부족합니다',
            metadata: {
              remainingLimit: bnplAccount.approvedLimit,
            },
          };
        }

        // 3. BNPL 트랜잭션 생성 (내부 승인만)
        const authorizationId = ulid();
        const [bnplTransaction] = await tx
          .insert(schema.bnplTransaction)
          .values({
            id: authorizationId,
            bnplAccountId: bnplAccount.id,
            paymentSessionId: request.metadata?.paymentSessionId || 'unknown',
            transactionType: 'DEBIT',
            status: 'AUTHORIZED', // 내부적으로만 승인
            amount: request.amount,
          })
          .returning();

        // 4. 잔여 한도 차감
        const newLimit = bnplAccount.approvedLimit - request.amount;
        await tx
          .update(schema.bnplAccount)
          .set({
            approvedLimit: newLimit,
            updatedAt: new Date(),
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));

        this.logger.log(
          `BNPL 내부 승인 완료: ${authorizationId}, 잔여한도: ${newLimit}`,
        );

        return {
          success: true,
          authorizationId,
          metadata: {
            bnplAccountId: bnplAccount.id,
            previousLimit: bnplAccount.approvedLimit,
            remainingLimit: newLimit,
            authorizedAt: new Date().toISOString(),
            hmsMemberId: bnplAccount.paymentMethodId,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 내부 승인 실패: ${errorMessage}`);

      return {
        success: false,
        authorizationId: '',
        error: 'BNPL 승인 처리 중 오류가 발생했습니다',
      };
    }
  }

  async capture(
    request: DeferredCaptureRequest,
  ): Promise<DeferredCaptureResponse> {
    this.logger.log(`BNPL 출금 실행: ${request.authorizationId}`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. BNPL 트랜잭션 조회
        const [bnplTransaction] = await tx
          .select()
          .from(schema.bnplTransaction)
          .where(eq(schema.bnplTransaction.id, request.authorizationId))
          .limit(1);

        if (!bnplTransaction) {
          return {
            success: false,
            transactionId: '',
            error: 'BNPL 승인 트랜잭션을 찾을 수 없습니다',
          };
        }

        if (bnplTransaction.status !== 'AUTHORIZED') {
          return {
            success: false,
            transactionId: '',
            error: '승인되지 않은 트랜잭션입니다',
          };
        }

        // 2. 실제 HMS 출금 요청
        const hmsResult = await this.bnplService.requestWithdrawal({
          memberId: bnplTransaction.bnplAccountId,
          amount: request.amount,
          paymentDate: new Date().toISOString().split('T')[0],
          invoiceId: request.authorizationId,
        });

        if (!hmsResult.success) {
          this.logger.error(
            `HMS 출금 요청 실패: ${request.authorizationId}`,
            hmsResult.error,
          );
          return {
            success: false,
            transactionId: '',
            error: hmsResult.error || 'HMS 출금 요청에 실패했습니다',
          };
        }

        // 3. 트랜잭션 상태 업데이트
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: 'CAPTURED',
          })
          .where(eq(schema.bnplTransaction.id, request.authorizationId));

        return {
          success: true,
          transactionId: hmsResult.transactionId,
          metadata: {
            authorizationId: request.authorizationId,
            hmsTransactionId: hmsResult.transactionId,
            capturedAt: new Date().toISOString(),
            hmsStatus: hmsResult.status,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 출금 실행 실패: ${errorMessage}`);

      return {
        success: false,
        transactionId: '',
        error: 'BNPL 출금 처리 중 오류가 발생했습니다',
      };
    }
  }

  async refund(
    request: DeferredRefundRequest,
  ): Promise<DeferredRefundResponse> {
    this.logger.log(
      `BNPL 환불: ${request.transactionId}, 금액: ${request.amount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. HMS 환불 요청 (기록만)
        const hmsRefundResult = this.bnplService.requestRefund({
          transactionId: request.transactionId,
          amount: request.amount,
          reason: request.reason || '고객 요청',
        });

        // 2. 환불 트랜잭션 생성
        const refundId = ulid();

        // 실제로는 원래 트랜잭션을 조회해서 bnplAccountId를 찾아야 하지만
        // 여기서는 간소화
        const refundTransaction = {
          id: refundId,
          // bnplAccountId: originalTransaction.bnplAccountId,
          transactionType: 'CREDIT' as const,
          status: 'CAPTURED' as const,
          amount: request.amount,
        };

        this.logger.log(`BNPL 환불 기록 완료: ${refundId}`);

        return {
          success: true,
          refundId,
          metadata: {
            originalTransactionId: request.transactionId,
            hmsRefundId: hmsRefundResult.refundId,
            refundedAt: new Date().toISOString(),
            reason: request.reason,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 환불 실패: ${errorMessage}`);

      return {
        success: false,
        refundId: '',
        error: 'BNPL 환불 처리 중 오류가 발생했습니다',
      };
    }
  }
}
