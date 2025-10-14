import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { walletSchema, DiscountLine } from '../../shared/database/schema';
import { eq } from 'drizzle-orm';
import { PaymentExecutorService } from './payment-executor.service';
import {
  PaymentRequest,
  PaymentResult,
  PaymentType,
  ProviderType,
} from '../../providers/payment-provider.interface';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { PointService } from '../points/point.service';

@Injectable()
export class PaymentOrchestratorService {
  private readonly logger = new Logger(PaymentOrchestratorService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly paymentExecutor: PaymentExecutorService,
    private readonly pointService: PointService,
  ) {}

  /**
   * 결제 승인(Authorization) - Intent 조회부터 승인 상태 업데이트까지 담당합니다.
   * 포인트 + 현금 혼합 결제를 지원합니다.
   *
   * ✅ providerType은 nullable: 포인트 전액 결제 시 불필요
   */
  async authorizePayment(
    intentId: string,
    providerType: ProviderType | null, // ✅ null 허용
    options: {
      usePoints?: number; // 사용할 포인트 금액
      profileId?: string;
      instrumentRef?: string;
      sessionId?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Orchestrating payment authorization for Intent: ${intentId} via ${providerType || '포인트 전액'}`,
    );

    const intent = await this.db.db.query.paymentIntents.findFirst({
      where: eq(schema.paymentIntents.id, intentId),
    });

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    // ✨ [핵심 개선] 모든 DB 업데이트를 하나의 트랜잭션으로 묶어 원자성을 보장합니다.
    return this.db.db.transaction(async (tx) => {
      let pointEventId: number | null = null;
      let finalAmount = Number(intent.amount);
      const discounts: DiscountLine[] = [];

      // 1. 포인트 처리 (사용 요청이 있는 경우)
      if (options.usePoints && options.usePoints > 0) {
        this.logger.log(`포인트 차감 시도: ${options.usePoints}원`);

        // 포인트 잔액 체크
        // partnerId는 customerId를 숫자로 변환 (실제 구현에서는 매핑 테이블 필요)
        const partnerId = Number(intent.customerId);
        this.logger.log(`partnerId 변환: ${intent.customerId} -> ${partnerId}`);

        let balance: number;
        try {
          balance = await this.pointService.getBalance(partnerId);
          this.logger.log(`포인트 잔액 조회 성공: ${balance}원`);
        } catch (error) {
          this.logger.error(
            `포인트 잔액 조회 실패: ${error.message}`,
            error.stack,
          );
          throw error;
        }

        if (balance < options.usePoints) {
          throw new Error(
            `포인트가 부족합니다. 잔액: ${balance}, 요청: ${options.usePoints}`,
          );
        }

        this.logger.log(`잔액 체크 통과. 포인트 차감 시작...`);

        // ⚠️ 중요: 포인트 차감을 동일 트랜잭션에서 실행
        // 외부 결제 실패 시 포인트도 함께 롤백됨
        let redeemResult;
        try {
          redeemResult = await this.pointService.redeem(
            {
              partnerId,
              amount: options.usePoints,
              reason: 'PAYMENT',
              memo: `Intent: ${intentId}`,
            },
            tx, // ✅ 상위 트랜잭션 전파
          );
          this.logger.log(
            `포인트 차감(redeem) 성공. eventId: ${redeemResult.eventId}`,
          );
        } catch (error) {
          this.logger.error(
            `포인트 차감(redeem) 실패: ${error.message}`,
            error.stack,
          );
          throw error;
        }

        pointEventId = redeemResult.eventId;

        // 할인 정보 추가
        discounts.push({
          type: 'POINTS',
          amount: options.usePoints,
          pointEventId: pointEventId!, // redeemResult.eventId로 할당되었으므로 null이 아님
          appliedAt: new Date(),
        });

        finalAmount = Number(intent.amount) - options.usePoints;

        // Intent에 할인 정보 업데이트
        await tx
          .update(schema.paymentIntents)
          .set({
            discounts: discounts as any,
            discountsTotal: String(options.usePoints),
            finalAmount: String(finalAmount),
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentIntents.id, intentId));

        this.logger.log(
          `포인트 차감 완료. eventId: ${pointEventId}, 최종 금액: ${finalAmount}`,
        );
      }

      // 2. 포인트 전액 결제인 경우 바로 CAPTURED 처리
      if (finalAmount === 0) {
        this.logger.log('포인트 전액 결제 - 바로 CAPTURED 처리');

        await tx
          .update(schema.paymentIntents)
          .set({
            status: 'CAPTURED',
            capturedAt: new Date(),
            authorizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentIntents.id, intentId));

        return {
          success: true,
          message: '포인트 전액 결제 완료',
          transactionId: intentId,
          attemptId: null,
          pointEventId,
          breakdown: {
            totalAmount: Number(intent.amount),
            pointsUsed: options.usePoints || 0,
            finalAmount: 0,
          },
        };
      }

      // 3. 외부 결제 필요한 경우 (finalAmount > 0)
      // ✅ provider 필수 검증
      if (!providerType) {
        throw new Error(
          'Provider는 필수입니다. 포인트 전액 결제가 아닌 경우 외부 결제 provider를 지정해야 합니다.',
        );
      }

      const paymentRequest: PaymentRequest = {
        intentId: intent.id,
        attemptId: generateUUIDv7(),
        amount: finalAmount,
        paymentType: intent.type as PaymentType,
        userId: intent.customerId,
        instrumentType: options.profileId ? 'PROFILE' : 'ONE_TIME',
        profileId: options.profileId,
        instrumentRef: options.instrumentRef,
        metadata: {
          sessionId: options.sessionId,
          source: options.source || 'api',
          actor: options.actor || 'SYSTEM',
          pointEventId,
          pointsUsed: options.usePoints || 0,
        },
      };

      // 4. 외부 결제 승인 처리
      try {
        // 1. Executor에게 결제 승인을 위임 (트랜잭션 컨텍스트 전달)
        const result = await this.paymentExecutor.authorize(
          paymentRequest,
          providerType, // 이제 null이 아님이 보장됨
          intent,
          { tx },
        );

        // 2. 성공 시 모든 관련 상태를 이 트랜잭션 안에서 업데이트합니다.
        await this.saveAttemptRecord(
          paymentRequest,
          result,
          providerType,
          'AUTHORIZED',
          tx,
        );
        await this.updateIntentStatus(
          intentId,
          result,
          paymentRequest,
          'AUTHORIZED',
          tx,
        );
        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(options.sessionId, result, tx);
        }

        // ✨ 포인트 정보를 결과에 포함
        result.attemptId = paymentRequest.attemptId;
        result.pointEventId = pointEventId;
        result.breakdown = {
          totalAmount: Number(intent.amount),
          pointsUsed: options.usePoints || 0,
          finalAmount,
        };

        this.logger.log(
          `Authorization successful for Intent: ${intentId}, Success: ${result.success}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Authorization failed for Intent: ${intentId}`,
          error.stack,
        );

        // 3. 실패 시에도 필요한 기록은 남기고, 트랜잭션은 롤백됩니다.
        // ⚠️ 트랜잭션 롤백 시 포인트 차감도 함께 취소됩니다.
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };
        await this.saveAttemptRecord(
          paymentRequest,
          failedResult,
          providerType,
          'FAILED',
          tx,
        );
        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(
            options.sessionId,
            failedResult,
            tx,
          );
        }

        // 에러를 다시 던져서 트랜잭션을 롤백시키고 호출자에게 알림
        // 포인트 차감이 있었다면 함께 롤백됨
        throw error;
      }
    });
  }

  /**
   * 결제 캡처(Capture) - 이미 승인된 결제를 실제로 정산 처리합니다.
   */
  async capturePayment(
    intentId: string,
    attemptId: string,
    amount?: number,
    options: {
      sessionId?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Orchestrating payment capture for Intent: ${intentId}, Attempt: ${attemptId}`,
    );

    // Intent와 Attempt 조회
    const [intent, attempt] = await Promise.all([
      this.db.db.query.paymentIntents.findFirst({
        where: eq(schema.paymentIntents.id, intentId),
      }),
      this.db.db.query.paymentAttempts.findFirst({
        where: eq(schema.paymentAttempts.id, attemptId),
      }),
    ]);

    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    if (!attempt) {
      throw new Error(`Attempt not found: ${attemptId}`);
    }

    if (attempt.status !== 'AUTHORIZED') {
      throw new Error(
        `Attempt ${attemptId} is not in AUTHORIZED status: ${attempt.status}`,
      );
    }

    const captureAmount = amount || attempt.amount;

    return this.db.db.transaction(async (tx) => {
      try {
        // 1. Executor에게 결제 캡처를 위임
        const result = await this.paymentExecutor.capture(
          attemptId,
          attempt.provider as ProviderType,
          captureAmount,
          { tx },
        );

        // 2. 성공 시 Attempt와 Intent 상태를 업데이트
        await this.updateAttemptStatus(attemptId, 'CAPTURED', result, tx);
        await this.updateIntentStatus(intentId, result, null, 'CAPTURED', tx);

        if (options.sessionId) {
          await this.updateCheckoutSessionStatus(options.sessionId, result, tx);
        }

        this.logger.log(
          `Capture successful for Intent: ${intentId}, Attempt: ${attemptId}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Capture failed for Intent: ${intentId}, Attempt: ${attemptId}`,
          error.stack,
        );

        // 실패 시 상태 업데이트
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };

        await this.updateAttemptStatus(
          attemptId,
          'CAPTURE_FAILED',
          failedResult,
          tx,
        );

        throw error;
      }
    });
  }

  // ✨ [신규] Checkout Session의 상태를 업데이트하는 책임 추가
  private async updateCheckoutSessionStatus(
    sessionId: string,
    result: PaymentResult,
    tx: any, // Drizzle 트랜잭션 객체
  ): Promise<void> {
    this.logger.log(
      `Updating Checkout Session ${sessionId} status to ${result.success ? 'COMPLETED' : 'CANCELLED'}`,
    );
    await tx
      .update(schema.checkoutSessions)
      .set({
        status: result.success ? 'COMPLETED' : 'CANCELLED',
      })
      .where(eq(schema.checkoutSessions.id, sessionId));
  }

  // ✨ [수정] 트랜잭션 객체(tx)와 명시적 상태를 받도록 수정
  private async saveAttemptRecord(
    request: PaymentRequest,
    result: PaymentResult,
    providerType: ProviderType,
    status: string,
    tx: any,
  ): Promise<void> {
    await tx.insert(schema.paymentAttempts).values({
      id: request.attemptId,
      intentId: request.intentId,
      provider: providerType,
      instrumentType: request.instrumentType,
      profileId: request.profileId || null,
      amount: request.amount,
      status: result.success ? status : 'FAILED',
      transactionId: result.transactionId ?? null,
      eventContext: JSON.stringify(request.metadata),
    });
  }

  // ✨ [수정] 트랜잭션 객체(tx)와 명시적 상태를 받도록 수정
  private async updateIntentStatus(
    intentId: string,
    result: PaymentResult,
    request: PaymentRequest | null,
    status: string,
    tx: any,
  ): Promise<void> {
    await tx
      .update(schema.paymentIntents)
      .set({
        status: result.success ? status : 'FAILED',
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentIntents.id, intentId));
  }

  // ✨ [신규] Attempt 상태만 업데이트하는 헬퍼 메서드
  private async updateAttemptStatus(
    attemptId: string,
    status: string,
    result: PaymentResult,
    tx: any,
  ): Promise<void> {
    await tx
      .update(schema.paymentAttempts)
      .set({
        status,
        updatedAt: new Date(),
        transactionId: result.transactionId ?? undefined,
      })
      .where(eq(schema.paymentAttempts.id, attemptId));
  }
}
