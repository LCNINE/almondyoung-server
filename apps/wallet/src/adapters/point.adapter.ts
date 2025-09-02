// adapters/point.adapter.ts
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
import { PointsService } from '../services/point.service';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { ulid } from 'ulid';

/**
 * 포인트 결제 어댑터
 * - 포인트는 즉시 결제이므로 authorize와 capture가 동시에 처리됨
 * - 실제 잔액 차감/복원은 PointService에서 처리
 */
@Injectable()
export class PointAdapter implements PaymentAdapter {
  private readonly logger = new Logger(PointAdapter.name);

  constructor(
    private readonly pointsService: PointsService,
    private readonly db: DbService<typeof schema>,
  ) {}

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResponse> {
    this.logger.log(
      `포인트 결제 승인: ${request.paymentMethodId}, 금액: ${request.amount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 포인트 결제수단에서 userId 추출
        const userId = request.metadata?.userId as string;
        if (!userId) {
          throw new Error('userId가 필요합니다');
        }

        // 포인트는 즉시 결제이므로 승인과 동시에 차감
        const pointBalance = await this.pointsService.getBalance(userId, tx);
        const previousBalance = pointBalance.balance;

        const redeemResult = await this.pointsService.redeem(
          userId,
          request.amount,
          request.orderName || '포인트 결제',
          tx,
        );

        const transactionId = ulid();

        return {
          success: true,
          pgTransactionId: transactionId,
          metadata: {
            previousBalance,
            newBalance: redeemResult.newBalance,
            transactionId: redeemResult.transaction.id,
            authorizedAt: new Date().toISOString(),
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 결제 승인 실패: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage.includes('부족')
          ? errorMessage
          : '포인트 결제 처리 중 오류가 발생했습니다',
      };
    }
  }

  async capture(request: CaptureRequest): Promise<CaptureResponse> {
    // 포인트는 승인과 동시에 확정 처리되므로 별도 capture 불필요
    this.logger.log(
      `포인트 결제 확정 (자동 처리됨): ${request.pgTransactionId}`,
    );

    return {
      success: true,
      pgTransactionId: request.pgTransactionId,
      metadata: {
        capturedAt: new Date().toISOString(),
        autoCapture: true,
      },
    };
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    this.logger.log(
      `포인트 환불: ${request.pgTransactionId}, 금액: ${request.amount}`,
    );

    try {
      return await this.db.db.transaction(async (tx) => {
        // 원래 트랜잭션에서 userId를 찾기 위해 metadata 활용
        // 실제로는 pgTransactionId로 원래 트랜잭션을 조회해야 하지만,
        // 여기서는 metadata에서 userId 추출
        const userId = request.metadata?.userId as string;
        if (!userId) {
          throw new Error('환불을 위한 userId가 필요합니다');
        }

        // 포인트 환불 = 포인트 적립
        const pointBalance = await this.pointsService.getBalance(userId, tx);
        const previousBalance = pointBalance.balance;

        const earnResult = await this.pointsService.earn(
          userId,
          request.amount,
          request.reason || '포인트 결제 환불',
          tx,
        );

        const refundTransactionId = ulid();

        return {
          success: true,
          pgTransactionId: refundTransactionId,
          metadata: {
            previousBalance,
            newBalance: earnResult.newBalance,
            transactionId: earnResult.transaction.id,
            refundedAt: new Date().toISOString(),
            reason: request.reason,
          },
        };
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`포인트 환불 실패: ${errorMessage}`);

      return {
        success: false,
        pgTransactionId: request.pgTransactionId,
        error: '포인트 환불 처리 중 오류가 발생했습니다',
      };
    }
  }
}
