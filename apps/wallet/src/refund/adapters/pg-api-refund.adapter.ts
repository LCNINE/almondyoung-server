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
import {
  RefundRequestedEvent,
  RefundCompletedEvent,
} from '../events/refund.events';

// PG 결제 정보 타입 정의
interface PaymentEvent {
  id: string;
  pgTransactionId: string | null;
  amount: number;
  status: string;
  invoice?: {
    id: string;
    amount: number;
  };
  paymentMethod?: {
    id: string;
    methodType: string;
  };
}

// PG API 응답 타입 정의
interface PgRefundApiResponse {
  success: boolean;
  pgTransactionId?: string;
  refundAmount?: number;
  refundedAt?: Date;
  error?: string;
}

/**
 * PG API 환불 어댑터 (PG API Refund Adapter)
 * 신용카드(토스 등)처럼 PG사 환불 API가 있는 경우 사용
 * PG사 API를 직접 호출하여 즉시 환불 처리
 */
@Injectable()
export class PgApiRefundAdapter extends RefundProcessingPort {
  private readonly logger = new Logger(PgApiRefundAdapter.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  /**
   * PG API 자동 환불 처리
   * 1. PG사 환불 API 호출
   * 2. 결과에 따라 COMPLETED 또는 FAILED 상태로 즉시 기록
   * 3. 환불 계좌 정보 불필요 (원거래로 자동 취소)
   */
  async processRefund(payload: RefundRequestPayload): Promise<RefundResult> {
    this.logger.log(`PG API 환불 처리 시작: ${payload.refundId}`);

    try {
      // 🔍 원본 결제 정보 조회
      const paymentEvent = await this.getOriginalPayment(
        payload.paymentEventId,
      );

      // 🚀 PG사 환불 API 호출 (예: 토스페이먼츠)
      const pgRefundResult = await this.callPgRefundApi(
        paymentEvent,
        payload.amount,
      );

      if (pgRefundResult.success) {
        // ✅ 환불 성공: 즉시 COMPLETED 상태로 처리

        // 1. 환불 요청 이벤트 발행
        this.eventEmitter.emit(
          'refund.requested',
          new RefundRequestedEvent(payload.refundId, {
            paymentEventId: payload.paymentEventId,
            refundAccountId: payload.refundAccountId,
            amount: payload.amount,
            reason: payload.reason,
          }),
        );

        // 2. 환불 완료 이벤트 발행 (즉시 완료)
        this.eventEmitter.emit(
          'refund.completed',
          new RefundCompletedEvent(payload.refundId, {
            pgTransactionId: pgRefundResult.pgTransactionId,
            completedAt: new Date(),
          }),
        );

        this.logger.log(
          `PG API 환불 성공: ${payload.refundId}, PG거래ID: ${pgRefundResult.pgTransactionId}`,
        );

        // RefundSuccessResult 타입에 맞는 반환
        return {
          success: true,
          refundId: payload.refundId,
          status: 'COMPLETED',
          message:
            '환불이 즉시 처리되었습니다. 영업일 기준 3-5일 내 계좌에 입금됩니다.',
          pgTransactionId: pgRefundResult.pgTransactionId,
          refundedAt: pgRefundResult.refundedAt?.toISOString(),
          refundAmount: pgRefundResult.refundAmount,
        };
      } else {
        // ❌ 환불 실패
        this.logger.error(
          `PG API 환불 실패: ${payload.refundId}, 사유: ${pgRefundResult.error}`,
        );

        // RefundFailureResult 타입에 맞는 반환 (error 필드 필수)
        return {
          success: false,
          refundId: payload.refundId,
          status: 'FAILED',
          message: `환불 처리에 실패했습니다: ${pgRefundResult.error}`,
          error: {
            code: 'PG_REFUND_FAILED',
            message: pgRefundResult.error || 'PG 환불 API 호출 실패',
            detail: `원거래ID: ${paymentEvent.pgTransactionId}, 환불금액: ${payload.amount}원`,
          } as RefundError,
        };
      }
    } catch (error) {
      this.logger.error(`PG API 환불 처리 실패: ${payload.refundId}`, error);

      // RefundFailureResult 타입에 맞는 반환 (error 필드 필수)
      return {
        success: false,
        refundId: payload.refundId,
        status: 'FAILED',
        message: `환불 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          code: 'PG_REFUND_EXCEPTION',
          message: error instanceof Error ? error.message : 'Unknown error',
          detail: `환불 요청 처리 중 예외 발생`,
        },
      };
    }
  }

  /**
   * 원본 결제 정보 조회
   */
  private async getOriginalPayment(
    paymentEventId: string,
  ): Promise<PaymentEvent> {
    const paymentEvent = await this.dbService.db.query.paymentEvents.findFirst({
      where: eq(schema.paymentEvents.id, paymentEventId),
      with: {
        invoice: true,
        paymentMethod: true,
      },
    });

    if (!paymentEvent) {
      throw new Error(`원본 결제를 찾을 수 없습니다: ${paymentEventId}`);
    }

    return paymentEvent as PaymentEvent;
  }

  /**
   * PG사 환불 API 호출 (예: 토스페이먼츠)
   * 실제 구현에서는 각 PG사별 SDK나 HTTP API를 호출
   */
  private async callPgRefundApi(
    paymentEvent: PaymentEvent,
    refundAmount: number,
  ): Promise<PgRefundApiResponse> {
    // TODO: 실제 PG사 API 호출 구현
    // 예: 토스페이먼츠 결제 취소 API

    this.logger.log(
      `PG사 환불 API 호출: 원거래ID=${paymentEvent.pgTransactionId}, 환불액=${refundAmount}원`,
    );

    // 임시 구현 (실제로는 PG사 API 호출)
    // 성공 케이스 시뮬레이션
    const mockPgResponse: PgRefundApiResponse = {
      success: true,
      pgTransactionId: `refund_${Date.now()}`,
      refundAmount,
      refundedAt: new Date(),
    };

    // 실제 구현 예시:
    // const tossApi = new TossPaymentsApi();
    // const result = await tossApi.cancelPayment({
    //   paymentKey: paymentEvent.pgTransactionId,
    //   cancelReason: '고객 요청',
    //   cancelAmount: refundAmount,
    // });

    return Promise.resolve(mockPgResponse);
  }
}
