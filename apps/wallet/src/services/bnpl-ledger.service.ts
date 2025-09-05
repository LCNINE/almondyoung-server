import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq, and } from 'drizzle-orm';
import { ulid } from 'ulid';
import { Money } from '../shared/utils/money.util';

export interface BnplAuthorizationResult {
  success: boolean;
  authorizationId?: string;
  remainingLimit?: number;
  error?: string;
}

export interface BnplCaptureResult {
  success: boolean;
  captureId?: string;
  capturedAmount?: number;
  error?: string;
}

export interface BnplRefundResult {
  success: boolean;
  refundId?: string;
  refundedAmount?: number;
  error?: string;
}

/**
 * BNPL 원장/한도 관리 전용 도메인 서비스
 * - 내부 한도 체크 및 차감
 * - 승인/캡처/환불 트랜잭션 관리
 * - BNPL 계정 상태 관리
 */
@Injectable()
export class BnplLedgerService {
  private readonly logger = new Logger(BnplLedgerService.name);

  constructor(private readonly db: DbService<typeof schema>) {}

  /**
   * BNPL 승인 처리 (내부 한도 차감)
   */
  async authorize(
    bnplAccountId: string,
    amount: number,
    sessionId: string,
  ): Promise<BnplAuthorizationResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(`BNPL 승인: ${bnplAccountId}, 금액: ${amountKRW}KRW`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. BNPL 계정 조회 및 한도 확인
        const [bnplAccount] = await tx
          .select()
          .from(schema.bnplAccount)
          .where(eq(schema.bnplAccount.id, bnplAccountId))
          .limit(1);

        if (!bnplAccount || bnplAccount.status !== 'ACTIVE') {
          return {
            success: false,
            error: 'BNPL 계정을 찾을 수 없거나 비활성화 상태입니다',
          };
        }

        const currentLimit = Money.toKRWInt(bnplAccount.approvedLimit);
        if (currentLimit < amountKRW) {
          return {
            success: false,
            error: '잔여 한도가 부족합니다',
            remainingLimit: currentLimit,
          };
        }

        // 2. 승인 트랜잭션 생성
        const authorizationId = ulid();
        await tx.insert(schema.bnplEvents).values({
          id: authorizationId,
          bnplAccountId: bnplAccount.id,
          paymentSessionId: sessionId,
          transactionType: 'DEBIT',
          status: 'AUTHORIZED',
          amount: amountKRW,
        });

        // 3. 한도 차감
        await tx
          .update(schema.bnplAccount)
          .set({
            approvedLimit: currentLimit - amountKRW,
          })
          .where(eq(schema.bnplAccount.id, bnplAccount.id));

        this.logger.log(`BNPL 승인 완료: ${authorizationId}`);

        return {
          success: true,
          authorizationId,
          remainingLimit: currentLimit - amountKRW,
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 승인 실패: ${errorMessage}`);
      return {
        success: false,
        error: `BNPL 승인 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * BNPL 배치 캡처 처리 (승인된 트랜잭션들을 실제 출금 상태로 변경)
   */
  async batchCapture(
    bnplAccountId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<BnplCaptureResult> {
    this.logger.log(`BNPL 배치 캡처: ${bnplAccountId}`);

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 승인된 트랜잭션들 조회
        const authorizedTransactions = await tx
          .select()
          .from(schema.bnplEvents)
          .where(
            and(
              eq(schema.bnplEvents.bnplAccountId, bnplAccountId),
              eq(schema.bnplEvents.status, 'AUTHORIZED'),
            ),
          );

        if (authorizedTransactions.length === 0) {
          return {
            success: true,
            captureId: '',
            capturedAmount: 0,
          };
        }

        // 2. 트랜잭션들을 CAPTURED 상태로 변경
        const captureId = ulid();
        const totalAmount = authorizedTransactions.reduce(
          (sum, tx) => sum + Money.toKRWInt(tx.amount),
          0,
        );

        for (const transaction of authorizedTransactions) {
          await tx
            .update(schema.bnplEvents)
            .set({
              status: 'CAPTURED',
            })
            .where(eq(schema.bnplEvents.id, transaction.id));
        }

        this.logger.log(
          `BNPL 배치 캡처 완료: ${captureId}, 총 금액: ${totalAmount}KRW`,
        );

        return {
          success: true,
          captureId,
          capturedAmount: totalAmount,
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 배치 캡처 실패: ${errorMessage}`);
      return {
        success: false,
        error: `BNPL 배치 캡처 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * BNPL 로컬 환불 처리 (내부 원장에만 CREDIT 트랜잭션 추가)
   */
  async refundLocal(
    originalTransactionId: string,
    amount: number,
  ): Promise<BnplRefundResult> {
    const amountKRW = Money.toKRWInt(amount);
    Money.validate(amountKRW);

    this.logger.log(
      `BNPL 로컬 환불: ${originalTransactionId}, 금액: ${amountKRW}KRW`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 1. 원본 트랜잭션 조회
        const [originalTransaction] = await tx
          .select()
          .from(schema.bnplEvents)
          .where(eq(schema.bnplEvents.id, originalTransactionId))
          .limit(1);

        if (!originalTransaction) {
          return {
            success: false,
            error: '원본 BNPL 트랜잭션을 찾을 수 없습니다',
          };
        }

        // 2. 환불 트랜잭션 생성
        const refundId = ulid();
        await tx.insert(schema.bnplEvents).values({
          id: refundId,
          bnplAccountId: originalTransaction.bnplAccountId,
          paymentSessionId: originalTransaction.paymentSessionId,
          transactionType: 'CREDIT',
          status: 'CAPTURED',
          amount: amountKRW,
        });

        // 3. 한도 복구 (환불 시)
        await tx
          .update(schema.bnplAccount)
          .set({
            approvedLimit:
              Money.toKRWInt(originalTransaction.amount) + amountKRW,
          })
          .where(eq(schema.bnplAccount.id, originalTransaction.bnplAccountId));

        this.logger.log(`BNPL 로컬 환불 완료: ${refundId}`);

        return {
          success: true,
          refundId,
          refundedAmount: amountKRW,
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 로컬 환불 실패: ${errorMessage}`);
      return {
        success: false,
        error: `BNPL 로컬 환불 처리 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * BNPL 계정 상태 조회
   */
  async getAccountStatus(bnplAccountId: string): Promise<{
    success: boolean;
    status?: string;
    creditLimit?: number;
    approvedLimit?: number;
    error?: string;
  }> {
    try {
      const [bnplAccount] = await this.db.db
        .select()
        .from(schema.bnplAccount)
        .where(eq(schema.bnplAccount.id, bnplAccountId))
        .limit(1);

      if (!bnplAccount) {
        return {
          success: false,
          error: 'BNPL 계정을 찾을 수 없습니다',
        };
      }

      return {
        success: true,
        status: bnplAccount.status,
        creditLimit: Money.toKRWInt(bnplAccount.creditLimit),
        approvedLimit: Money.toKRWInt(bnplAccount.approvedLimit),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 계정 상태 조회 실패: ${errorMessage}`);
      return {
        success: false,
        error: `BNPL 계정 상태 조회 중 오류: ${errorMessage}`,
      };
    }
  }
}
