import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import * as schema from '../../shared/schemas/schema';
import { eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  RefundProcessingPort,
  RefundRequestPayload,
  RefundResult,
  RefundError,
} from '../port/refund-processing.port';
import { RefundRequestedEvent } from '../events/refund.events';

// 환불 계좌 타입 정의
interface RefundAccount {
  id: string;
  userId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  isDefault: boolean;
}

/**
 * 수동 환불 어댑터 (Manual Refund Adapter)
 * BNPL(효성 CMS)처럼 PG사 환불 API가 없는 경우 사용
 * CS팀이 수동으로 처리할 수 있도록 환불 요청을 대기열에 추가
 */
@Injectable()
export class ManualRefundAdapter extends RefundProcessingPort {
  private readonly logger = new Logger(ManualRefundAdapter.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  /**
   * 수동 환불 처리
   * 1. 환불 요청을 REQUESTED 상태로 기록
   * 2. CS팀 대기열에 추가
   * 3. 환불 요청 이벤트 발행 (CQRS 패턴)
   */
  async processRefund(payload: RefundRequestPayload): Promise<RefundResult> {
    this.logger.log(`수동 환불 처리 시작: ${payload.refundId}`);

    try {
      // 🔍 환불 계좌 유효성 검사
      const refundAccount = await this.validateRefundAccount(
        payload.refundAccountId,
        payload.userId,
      );

      // 🎯 환불 요청 이벤트 발행 (Event Sourcing)
      // RefundEventHandler에서 실제 DB 기록을 담당
      this.eventEmitter.emit(
        'refund.requested',
        new RefundRequestedEvent(payload.refundId, {
          paymentEventId: payload.paymentEventId,
          refundAccountId: payload.refundAccountId,
          amount: payload.amount,
          reason: payload.reason,
        }),
      );

      this.logger.log(`수동 환불 요청 이벤트 발행 완료: ${payload.refundId}`);

      // RefundSuccessResult 타입에 맞는 반환
      return {
        success: true,
        refundId: payload.refundId,
        status: 'REQUESTED',
        message: `환불 요청이 접수되었습니다. CS팀에서 ${refundAccount.bankName} ${refundAccount.accountNumber} 계좌로 처리해드리겠습니다.`,
      };
    } catch (error) {
      this.logger.error(`수동 환불 처리 실패: ${payload.refundId}`, error);

      // RefundFailureResult 타입에 맞는 반환 (error 필드 필수)
      return {
        success: false,
        refundId: payload.refundId,
        status: 'FAILED',
        message: `환불 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          code: 'MANUAL_REFUND_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
          detail: `환불 계좌: ${payload.refundAccountId}, 사용자: ${payload.userId}`,
        } as RefundError,
      };
    }
  }

  /**
   * 환불 계좌 유효성 검사
   * 사용자가 등록한 환불 계좌인지 확인
   */
  private async validateRefundAccount(
    refundAccountId: string,
    userId: string,
  ): Promise<RefundAccount> {
    const refundAccount =
      await this.dbService.db.query.userRefundAccounts.findFirst({
        where: eq(schema.userRefundAccounts.id, refundAccountId),
      });

    if (!refundAccount) {
      throw new Error(`환불 계좌를 찾을 수 없습니다: ${refundAccountId}`);
    }

    if (refundAccount.userId !== userId) {
      throw new Error(
        `환불 계좌 소유자가 일치하지 않습니다: ${refundAccountId}`,
      );
    }

    return refundAccount as RefundAccount;
  }
}
