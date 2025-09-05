import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentStrategyFactory } from '../factories/payment-strategy.factory';
import { IdempotencyService } from './idempotency.service';
import { BatchCaptureService } from './batch-capture.service';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import {
  PaymentResult,
  RegistrationResult,
  RefundResult,
  CaptureResult,
  StatusResult,
} from '../strategies/payment.strategy.interface';
import { WalletTx } from '../shared/database';

/**
 * @class PaymentService
 * @description 결제 시스템의 통합 진입점(Facade).
 * 모든 결제 관련 요청을 받아 적절한 Strategy로 위임합니다.
 *
 * 역할:
 * - 시스템의 유일한 진입점 역할
 * - Factory를 통해 적절한 Strategy를 선택
 * - 비즈니스 로직은 Strategy에 위임
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly strategyFactory: PaymentStrategyFactory,
    private readonly idempotency: IdempotencyService,
    private readonly batchCaptureService: BatchCaptureService,
  ) {}

  /**
   * 멱등성, 이벤트 기록, 세션 상태 업데이트를 포함한 공통 래퍼
   */
  private async withIdempotency<T>(
    idempotencyKey: string | undefined,
    payload: any,
    path: string,
    operation: () => Promise<T>,
    eventType: 'payment' | 'refund' | 'capture' = 'payment',
  ): Promise<T> {
    if (!idempotencyKey) {
      // 멱등성 키가 없으면 단순 실행
      return await operation();
    }

    return await this.db.db.transaction(async (tx) => {
      // 1. 멱등성 체크
      const idempotencyResult = await this.idempotency.checkOrCreate(
        tx,
        idempotencyKey,
        payload,
        path,
      );
      if (idempotencyResult.hit) return idempotencyResult.response as T;

      // 2. 실제 비즈니스 로직 실행
      const result = await operation();

      // 3. 공통 이벤트 기록
      await this.recordEvent(tx, result, eventType, payload);

      // 4. 세션 상태 업데이트 (해당되는 경우)
      if (payload.sessionId && 'status' in (result as any)) {
        await this.updateSessionStatus(
          tx,
          payload.sessionId,
          (result as any).status,
        );
      }

      // 5. 멱등성 완료
      await this.idempotency.complete(tx, idempotencyKey, result, 201);
      return result;
    });
  }

  /**
   * 이벤트 기록 공통 로직
   */
  private async recordEvent(
    tx: WalletTx,
    result: any,
    eventType: string,
    payload: any,
  ) {
    console.log('recordEvent', eventType, result, payload);
    if (eventType === 'payment' && 'transactionId' in result) {
      await tx.insert(schema.paymentEvents).values({
        paymentSessionId: payload.metadata.sessionId,
        paymentMethodId: payload.metadata.paymentMethodId || '',
        status: result.status || 'COMPLETED',
        amount: payload.amount || 0,
        pgTransactionId: result.transactionId,
        pgResponse: JSON.stringify({
          gateway: this.getGatewayType(payload.methodType),
          originalRequest: payload,
          gatewayResponse: result.metadata,
        }),
        actor: 'USER',
        metadata: JSON.stringify({
          gateway: this.getGatewayType(payload.methodType),
          eventType,
          ...result.metadata,
        }),
      });
    } else if (eventType === 'refund' && 'refundId' in result) {
      await tx.insert(schema.refundEvents).values({
        paymentEventId: payload.transactionId || '',
        status: 'COMPLETED',
        amount: payload.amount || 0,
        reason: payload.reason || '고객 요청',
        completedBy: 'SYSTEM',
        completedAt: new Date(),
        metadata: JSON.stringify({
          gateway: this.getGatewayType(payload.methodType),
          gatewayResponse: result.metadata,
        }),
      });
    }
  }

  /**
   * 세션 상태 업데이트 공통 로직
   */
  private async updateSessionStatus(
    tx: any,
    sessionId: string,
    status: string,
  ) {
    await tx
      .update(schema.paymentSessions)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentSessions.id, sessionId));
  }

  /**
   * 결제수단 타입에 따른 게이트웨이 타입 반환
   */
  private getGatewayType(methodType: string): string {
    switch (methodType) {
      case 'CARD':
        return 'hms_card';
      case 'BNPL':
        return 'hms_bnpl';
      case 'EASY_PAY':
        return 'toss';
      case 'REWARD_POINT':
        return 'internal_point';
      default:
        return 'unknown';
    }
  }

  /**
   * 결제 처리 - 모든 결제수단 통합 (오케스트레이션)
   */
  async processPayment(
    methodType: string,
    amount: number,
    currency: string = 'KRW',
    metadata: {
      userId: string;
      sessionId: string;
      paymentMethodId?: string;
      orderName?: string;
      bnplAccountId?: string;
      hmsMemberId?: string; // hmsMemberId를 받을 수 있도록 타입은 유지
      [key: string]: any;
    },
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    this.logger.log(
      `통합 결제 처리: ${methodType}, 금액: ${amount}${currency}, 세션: ${metadata.sessionId}`,
    );

    // ✅ [수정] 카드 결제 시, card_method 테이블과 JOIN하여 hmsMemberId를 조회합니다.
    if (methodType === 'CARD' && metadata.paymentMethodId) {
      try {
        const results = await this.db.db
          .select()
          .from(schema.paymentMethod)
          .leftJoin(
            // ✅ [수정] JOIN 대상을 cardMethod로 변경
            schema.cardMethod,
            eq(schema.paymentMethod.id, schema.cardMethod.id), // cardMethod의 id가 paymentMethod의 id를 참조한다고 가정
          )
          .where(eq(schema.paymentMethod.id, metadata.paymentMethodId))
          .limit(1);

        const joinedResult = results[0];

        // ✅ [수정] 조인된 card_method 테이블에서 hmsMemberId를 가져옵니다.
        if (joinedResult && joinedResult.card_method?.hmsMemberId) {
          metadata.hmsMemberId = joinedResult.card_method.hmsMemberId;
          this.logger.log(`hmsMemberId 조회 성공: ${metadata.hmsMemberId}`);
        } else {
          // 이 에러가 발생하면 2단계(카드 등록 로직)가 제대로 구현되었는지 확인해야 합니다.
          throw new Error(
            `결제수단(ID: ${metadata.paymentMethodId})에 연결된 hmsMemberId를 찾을 수 없습니다.`,
          );
        }
      } catch (dbError) {
        this.logger.error(`DB에서 결제수단 조회 실패:`, dbError);
        throw new Error(`결제수단 정보를 조회하는 중 오류가 발생했습니다.`);
      }
    }

    const payload = { methodType, amount, currency, metadata };

    return await this.withIdempotency(
      idempotencyKey,
      payload,
      `/payments/process`,
      async () => {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('processPayment' in strategy)) {
          throw new Error(`${methodType}는 결제 처리를 지원하지 않습니다`);
        }

        // Strategy를 통한 순수 결제 처리
        const result = await strategy.processPayment(
          amount,
          currency,
          metadata,
        );

        if (!result.success) {
          throw new Error(result.error || '결제 처리에 실패했습니다');
        }

        return {
          success: true,
          transactionId: result.transactionId,
          captureId: result.captureId,
          amount,
          currency,
          status: result.status || 'CAPTURED',
          metadata: result.metadata,
        };
      },
      'payment',
    );
  }

  /**
   * 결제수단 등록 - 모든 등록 가능한 결제수단 통합 (오케스트레이션)
   */
  async registerPaymentMethod(
    methodType: string,
    request: any,
    idempotencyKey?: string,
    usage?: 'RECURRING' | 'ONE_TIME',
  ): Promise<RegistrationResult> {
    this.logger.log(
      `통합 결제수단 등록: ${methodType} (${usage || 'DEFAULT'}) - ${request.userId}`,
    );

    const payload = { methodType, request, usage };

    return await this.withIdempotency(
      idempotencyKey,
      payload,
      `/payment-methods/register`,
      async () => {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('registerMethod' in strategy)) {
          throw new Error(`${methodType}는 등록을 지원하지 않습니다`);
        }

        // usage 정보를 Strategy에 전달
        const requestWithUsage = { ...request, usage };
        const result = await strategy.registerMethod(requestWithUsage);

        if (!result.success) {
          throw new Error(result.error || '결제수단 등록에 실패했습니다');
        }

        return {
          success: true,
          paymentMethodId: result.paymentMethodId || '',
          hmsMemberId: result.hmsMemberId,
          status: 'PENDING' as const,
          metadata: result.metadata,
        };
      },
      'payment',
    );
  }

  /**
   * 환불 처리 - 모든 결제수단 통합 (오케스트레이션)
   */
  async refundPayment(
    methodType: string,
    transactionId: string,
    amount: number,
    reason?: string,
    idempotencyKey?: string,
  ): Promise<RefundResult> {
    this.logger.log(
      `통합 환불 처리: ${methodType}, 거래ID: ${transactionId}, 금액: ${amount}`,
    );

    const payload = { methodType, transactionId, amount, reason };

    return await this.withIdempotency(
      idempotencyKey,
      payload,
      `/refunds/process`,
      async () => {
        const strategy = this.strategyFactory.getStrategy(methodType);

        if (!('refundPayment' in strategy)) {
          throw new Error(`${methodType}는 환불 처리를 지원하지 않습니다`);
        }

        // Strategy를 통한 순수 환불 처리
        const result = await strategy.refundPayment(
          transactionId,
          amount,
          reason,
        );

        if (!result.success) {
          throw new Error(result.error || '환불 처리에 실패했습니다');
        }

        return {
          success: true,
          refundId: result.refundId,
          refundedAmount: result.refundedAmount,
          metadata: result.metadata,
        };
      },
      'refund',
    );
  }

  /**
   * 배치 처리 - 배치 처리 지원 결제수단만
   */
  async batchCapture(
    methodType: string,
    authorizationIds: string[],
    batchId?: string,
    idempotencyKey?: string,
  ): Promise<CaptureResult> {
    this.logger.log(
      `통합 배치 확정: ${methodType}, ${authorizationIds.length}건`,
    );

    try {
      const strategy =
        this.strategyFactory.getBatchProcessingStrategy(methodType);
      return await strategy.batchCapture(authorizationIds, batchId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 배치 확정 실패: ${methodType} - ${errorMessage}`);

      return {
        success: false,
        captureId: '',
        capturedAmount: 0,
        status: 'FAILED',
        failedIds: authorizationIds,
        error: errorMessage,
      };
    }
  }

  /**
   * 회원 상태 조회 - 상태 조회 지원 결제수단만
   */
  async getMemberStatus(
    methodType: string,
    memberId: string,
  ): Promise<StatusResult> {
    this.logger.log(`통합 회원 상태 조회: ${methodType}, 회원ID: ${memberId}`);

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('getMemberStatus' in strategy)) {
        throw new Error(`${methodType}는 상태 조회를 지원하지 않습니다`);
      }

      return await strategy.getMemberStatus(memberId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 회원 상태 조회 실패: ${methodType} - ${errorMessage}`,
      );

      return {
        success: false,
        status: 'FAILED',
        error: errorMessage,
      };
    }
  }

  /**
   * 계정 활성화 - 계정 관리 지원 결제수단만
   */
  async activateAccount(
    methodType: string,
    paymentMethodId: string,
    approvedLimit: number,
  ): Promise<void> {
    this.logger.log(
      `통합 계정 활성화: ${methodType}, ${paymentMethodId}, 한도: ${approvedLimit}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('activateAccount' in strategy)) {
        throw new Error(`${methodType}는 계정 관리를 지원하지 않습니다`);
      }

      await strategy.activateAccount(paymentMethodId, approvedLimit);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 계정 활성화 실패: ${methodType} - ${errorMessage}`,
      );
      throw new Error(errorMessage);
    }
  }

  /**
   * 계정 비활성화 - 계정 관리 지원 결제수단만
   */
  async deactivateAccount(
    methodType: string,
    paymentMethodId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(
      `통합 계정 비활성화: ${methodType}, ${paymentMethodId}, 사유: ${reason}`,
    );

    try {
      const strategy = this.strategyFactory.getStrategy(methodType);

      if (!('deactivateAccount' in strategy)) {
        throw new Error(`${methodType}는 계정 관리를 지원하지 않습니다`);
      }

      await strategy.deactivateAccount(paymentMethodId, reason);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `통합 계정 비활성화 실패: ${methodType} - ${errorMessage}`,
      );
      throw new Error(errorMessage);
    }
  }

  /**
   * 출금동의서 제출 - BNPL 전용
   */
  async submitConsent(
    memberId: string,
    file: Buffer,
    filename: string,
  ): Promise<{
    success: boolean;
    agreementId?: string;
    error?: string;
    rawResponse: any;
  }> {
    this.logger.log(`통합 출금동의서 제출: ${memberId}`);

    try {
      const strategy = this.strategyFactory.getStrategy('BNPL');

      if (!('submitConsent' in strategy)) {
        throw new Error('BNPL은 출금동의서 제출을 지원하지 않습니다');
      }

      const result = await strategy.submitConsent(memberId, file, filename);
      return {
        ...result,
        rawResponse: result.metadata,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`통합 출금동의서 제출 실패: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
        rawResponse: {},
      };
    }
  }

  /**
   * BNPL 정산 배치 생성 및 실행 (스케줄러 전용)
   */
  async createBnplSettlementBatch(
    bnplAccountId: string,
    periodStart: Date,
    periodEnd: Date,
    idempotencyKey?: string,
  ): Promise<{
    success: boolean;
    batchId?: string;
    totalAmount?: number;
    processedCount?: number;
    failedCount?: number;
    error?: string;
  }> {
    this.logger.log(
      `BNPL 정산 배치 생성 요청: ${bnplAccountId} (${periodStart.toISOString()} ~ ${periodEnd.toISOString()})`,
    );

    try {
      return await this.batchCaptureService.createAndExecuteBnplSettlementBatch(
        bnplAccountId,
        periodStart,
        periodEnd,
        idempotencyKey,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`BNPL 정산 배치 생성 실패: ${errorMessage}`);

      return {
        success: false,
        error: `BNPL 정산 배치 생성 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * 정산 배치 상태 조회
   */
  async getSettlementBatchStatus(batchId: string): Promise<{
    success: boolean;
    batch?: any;
    items?: any[];
    events?: any[];
    error?: string;
  }> {
    this.logger.log(`정산 배치 상태 조회: ${batchId}`);

    try {
      return await this.batchCaptureService.getSettlementBatchStatus(batchId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`정산 배치 상태 조회 실패: ${errorMessage}`);

      return {
        success: false,
        error: `정산 배치 상태 조회 중 오류: ${errorMessage}`,
      };
    }
  }

  /**
   * 대기 중인 정산 배치 목록 조회 (스케줄러 전용)
   */
  async getPendingSettlementBatches(): Promise<any[]> {
    try {
      return await this.batchCaptureService.getPendingSettlementBatches();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`대기 중인 정산 배치 조회 실패: ${errorMessage}`);
      return [];
    }
  }
}
