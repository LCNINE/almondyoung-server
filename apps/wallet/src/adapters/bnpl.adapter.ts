// adapters/bnpl.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentAdapter,
  AuthorizeRequest,
  AuthorizeResponse,
  CaptureRequest,
  CaptureResponse,
  RefundRequest,
  RefundResponse,
} from '../ports/payment-adapter.port';
import { BNPLService } from '../services/bnpl.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';

/**
 * BNPL 결제 어댑터
 * - authorize: 내부적으로만 승인 처리 (HMS 출금은 별도 스케줄러에서 처리)
 * - capture: 실제 HMS 출금 요청 실행
 * - refund: HMS 환불 기록
 */
@Injectable()
export class BnplAdapter implements PaymentAdapter {
  private readonly logger = new Logger(BnplAdapter.name);

  constructor(
    private readonly bnplService: BNPLService,
    private readonly db: DbService<typeof schema>,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    this.logger.log(
      `BNPL 결제 승인: ${request.paymentMethodId}, 금액: ${request.amount}`,
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
            error: 'BNPL 계정을 찾을 수 없습니다',
          };
        }

        if (bnplAccount.status !== 'ACTIVE') {
          return {
            success: false,
            error: 'BNPL 계정이 비활성화 상태입니다',
          };
        }

        // 2. 잔여 한도 확인
        if (bnplAccount.approvedLimit < request.amount) {
          return {
            success: false,
            error: '잔여 한도가 부족합니다',
          };
        }

        // 3. BNPL 트랜잭션 생성 (내부 승인만)
        const transactionId = ulid();
        const [bnplTransaction] = await tx
          .insert(schema.bnplTransaction)
          .values({
            id: transactionId,
            bnplAccountId: bnplAccount.id,
            paymentSessionId: request.metadata?.paymentSessionId || 'unknown',
            transactionType: 'DEBIT',
            status: 'AUTHORIZED', // 내부적으로만 승인 처리
            amount: request.amount,
          })
          .returning();

        // 4. 잔여 한도 차감
        await tx
          .update(schema.bnplAccount)
          .set({
            approvedLimit: bnplAccount.approvedLimit - request.amount,
            updatedAt: new Date(),
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));

        this.logger.log(
          `BNPL 내부 승인 완료: ${transactionId}, 잔여한도: ${bnplAccount.approvedLimit - request.amount}`,
        );

        return {
          success: true,
          pgTransactionId: transactionId,
          metadata: {
            bnplAccountId: bnplAccount.id,
            previousLimit: bnplAccount.approvedLimit,
            newLimit: bnplAccount.approvedLimit - request.amount,
            authorizedAt: new Date().toISOString(),
            hmsMemberId: bnplAccount.paymentMethodId, // HMS 회원 ID는 결제수단 ID와 동일
            isInternalOnly: true, // HMS 출금은 별도 처리됨을 표시
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 결제 승인 실패: ${errorMessage}`);

      return {
        success: false,
        error: 'BNPL 결제 처리 중 오류가 발생했습니다',
      };
    }
  }

  async capture(request: CaptureRequest): Promise<CaptureResponse> {
    this.logger.log(`BNPL 결제 확정: ${request.pgTransactionId}`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. BNPL 트랜잭션 조회
        const [bnplTransaction] = await tx
          .select()
          .from(schema.bnplTransaction)
          .where(eq(schema.bnplTransaction.id, request.pgTransactionId))
          .limit(1);

        if (!bnplTransaction) {
          return {
            success: false,
            pgTransactionId: request.pgTransactionId,
            error: 'BNPL 트랜잭션을 찾을 수 없습니다',
          };
        }

        if (bnplTransaction.status !== 'AUTHORIZED') {
          return {
            success: false,
            pgTransactionId: request.pgTransactionId,
            error: '승인되지 않은 트랜잭션입니다',
          };
        }

        // 2. 실제 HMS 출금 요청
        const hmsResult = await this.bnplService.requestWithdrawal({
          memberId: bnplTransaction.bnplAccountId, // HMS 회원 ID
          amount: request.amount,
          paymentDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
          invoiceId: request.pgTransactionId,
        });

        if (!hmsResult.success) {
          this.logger.error(
            `HMS 출금 요청 실패: ${request.pgTransactionId}`,
            hmsResult.error,
          );
          return {
            success: false,
            pgTransactionId: request.pgTransactionId,
            error: hmsResult.error || 'HMS 출금 요청에 실패했습니다',
          };
        }

        // 3. 트랜잭션 상태 업데이트
        await tx
          .update(schema.bnplTransaction)
          .set({
            status: 'CAPTURED',
          })
          .where(eq(schema.bnplTransaction.id, request.pgTransactionId));

        return {
          success: true,
          pgTransactionId: hmsResult.transactionId, // HMS 트랜잭션 ID로 변경
          metadata: {
            internalTransactionId: request.pgTransactionId,
            hmsTransactionId: hmsResult.transactionId,
            capturedAt: new Date().toISOString(),
            hmsStatus: hmsResult.status,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 결제 확정 실패: ${errorMessage}`);

      return {
        success: false,
        pgTransactionId: request.pgTransactionId,
        error: 'BNPL 결제 확정 처리 중 오류가 발생했습니다',
      };
    }
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `BNPL 환불: ${request.pgTransactionId}, 금액: ${request.amount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 원래 트랜잭션 조회
        const [bnplTransaction] = await tx
          .select()
          .from(schema.bnplTransaction)
          .where(eq(schema.bnplTransaction.id, request.pgTransactionId))
          .limit(1);

        if (!bnplTransaction) {
          return {
            success: false,
            pgTransactionId: request.pgTransactionId,
            error: 'BNPL 트랜잭션을 찾을 수 없습니다',
          };
        }

        // 2. HMS 환불 요청 (기록만)
        const hmsRefundResult = this.bnplService.requestRefund({
          transactionId: request.pgTransactionId,
          amount: request.amount,
          reason: request.reason || '고객 요청',
        });

        // 3. 환불 트랜잭션 생성
        const refundTransactionId = ulid();
        await tx.insert(schema.bnplTransaction).values({
          id: refundTransactionId,
          bnplAccountId: bnplTransaction.bnplAccountId,
          paymentSessionId: bnplTransaction.paymentSessionId,
          transactionType: 'CREDIT', // 환불은 CREDIT
          status: 'CAPTURED', // 환불은 즉시 처리
          amount: request.amount,
        });

        // 4. 한도 복원
        const [bnplAccount] = await tx
          .select()
          .from(schema.bnplAccount)
          .where(eq(schema.bnplAccount.id, bnplTransaction.bnplAccountId))
          .limit(1);

        if (bnplAccount) {
          await tx
            .update(schema.bnplAccount)
            .set({
              approvedLimit: bnplAccount.approvedLimit + request.amount,
              updatedAt: new Date(),
            })
            .where(eq(schema.bnplAccount.id, bnplAccount.id));
        }

        return {
          success: true,
          pgTransactionId: refundTransactionId,
          metadata: {
            originalTransactionId: request.pgTransactionId,
            hmsRefundId: hmsRefundResult.refundId,
            refundedAt: new Date().toISOString(),
            reason: request.reason,
            limitRestored: request.amount,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 환불 실패: ${errorMessage}`);

      return {
        success: false,
        pgTransactionId: request.pgTransactionId,
        error: 'BNPL 환불 처리 중 오류가 발생했습니다',
      };
    }
  }
}
