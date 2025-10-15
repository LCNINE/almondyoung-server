import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { walletSchema, DiscountLine } from '../../shared/database/schema';
import { eq } from 'drizzle-orm';

import {
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';
import { PointService } from '../points/point.service';
import { IntentManager } from '../intents/intent.manager';

import { PaymentRequestBuilder } from './payment-request.builder';
import type { PaymentIntent } from '../../shared/database/types';
import { PaymentExecutorServiceImpl } from './payment-executor.service';
import { PaymentAttemptRepository } from './payment-attempt.repository';

/**
 * PaymentOrchestratorService 구현체 (Business Layer)
 *
 * 책임: 결제 플로우 전체 조율 (비즈니스 흐름 중심)
 * - Intent 준비 → 포인트 적용 → 외부 결제 → 기록
 * - 상세 구현은 Implement Layer(Manager)에 위임
 *
 * 블로그 철학:
 * "상세 구현 로직은 잘 모르더라도 비즈니스의 흐름은 이해 가능한 로직"
 *
 * 레이어 구조:
 * Business Layer (Orchestrator) → Implement Layer (Manager) → Data Access Layer (Repository)
 *
 * 의존성 주입:
 * - IntentManager: Intent 관련 구현 로직 (Implement Layer)
 * - PaymentAttemptManager: Attempt 관련 구현 로직 (Implement Layer)
 * - PointService: 포인트 차감/복원
 * - PaymentExecutorService: 외부 결제 실행
 * - PaymentRequestBuilder: PaymentRequest 객체 조립
 */
@Injectable()
export class PaymentOrchestratorServiceImpl {
  private readonly logger = new Logger(PaymentOrchestratorServiceImpl.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly intentManager: IntentManager,
    private readonly attemptManager: PaymentAttemptRepository,
    private readonly pointService: PointService,
    private readonly paymentExecutor: PaymentExecutorServiceImpl,
    private readonly requestBuilder: PaymentRequestBuilder,
  ) {}

  /**
   * 결제 승인(Authorization) - Intent 조회부터 승인 상태 업데이트까지 담당합니다.
   * 포인트 + 현금 혼합 결제를 지원합니다.
   *
   * ✅ 비즈니스 흐름 중심:
   * 1. Intent 조회 및 검증
   * 2. 기존 활성 결제 취소
   * 3. 포인트 차감 및 할인 계산
   * 4. 포인트 전액 결제 시 바로 완료
   * 5. 외부 결제 필요 시 요청 생성 및 실행
   * 6. 결제 기록 및 결과 반환
   *
   * ✅ providerType은 nullable: 포인트 전액 결제 시 불필요
   */
  async authorizePayment(
    intentId: string,
    providerType: ProviderType | null,
    options: {
      usePoints?: number;
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

    // ✅ 1. Intent 조회 및 검증
    const intent = await this.prepareIntent(intentId, providerType);

    // ✅ 2-6. 트랜잭션 안에서 모든 결제 처리
    return this.db.db.transaction(async (tx) => {
      // ✅ 2. 기존 활성 결제 취소 (동시 결제 방지)
      const canceledIds = await this.attemptManager.cancelActiveAttempts(
        intentId,
        tx,
      );
      if (canceledIds.length > 0) {
        this.logger.log(
          `Previous active attempts canceled: ${canceledIds.join(', ')}`,
        );
      }

      // ✅ 3. 포인트 차감 및 할인 계산
      const pointResult = await this.applyPoints(intent, options.usePoints, tx);

      // ✅ 4. 포인트 전액 결제 시 바로 완료
      if (pointResult.isFullPayment) {
        return await this.completePointOnlyPayment(
          intent,
          pointResult,
          options,
          tx,
        );
      }

      // ✅ 5. 외부 결제 필요 - 요청 생성 및 실행
      return await this.executeExternalPayment(
        intent,
        providerType!,
        pointResult,
        options,
        tx,
      );
    });
  }

  /**
   * Intent를 조회하고 결제 가능한 상태인지 검증합니다.
   * UNKNOWN 상태인 경우 복구를 시도합니다.
   */
  private async prepareIntent(
    intentId: string,
    providerType: ProviderType | null,
  ): Promise<PaymentIntent> {
    return this.intentManager.prepareForPayment(
      intentId,
      providerType,
      this.attemptRecovery.bind(this),
    );
  }

  /**
   * UNKNOWN 상태의 Intent 복구를 시도합니다.
   */
  private async attemptRecovery(
    intent: PaymentIntent,
    providerType: ProviderType | null,
  ): Promise<void> {
    this.logger.log(
      `Intent ${intent.id} is in UNKNOWN state. Attempting recovery...`,
    );

    if (!providerType) return;

    try {
      const inquiry = await this.paymentExecutor.inquire(
        intent.id,
        providerType,
      );
      if (inquiry?.status === 'AUTHORIZED' || inquiry?.status === 'CAPTURED') {
        await this.db.db
          .update(schema.paymentIntents)
          .set({
            status: inquiry.status as any,
            updatedAt: new Date(),
          })
          .where(eq(schema.paymentIntents.id, intent.id));

        this.logger.log(
          `Successfully recovered intent ${intent.id} status to ${inquiry.status}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to recover UNKNOWN state for intent ${intent.id}:`,
        error,
      );
      // 복구 실패 시에도 계속 진행 (새로운 결제 시도)
    }
  }

  /**
   * 포인트를 차감하고 할인 정보를 생성합니다.
   */
  private async applyPoints(
    intent: PaymentIntent,
    usePoints: number | undefined,
    tx: any,
  ): Promise<{
    pointEventId: number | null;
    pointsUsed: number;
    finalAmount: number;
    isFullPayment: boolean;
    discounts: DiscountLine[];
  }> {
    // 포인트 사용 요청이 없는 경우
    if (!usePoints || usePoints <= 0) {
      return {
        pointEventId: null,
        pointsUsed: 0,
        finalAmount: Number(intent.amount),
        isFullPayment: false,
        discounts: [],
      };
    }

    this.logger.log(`Applying ${usePoints} points to intent ${intent.id}`);

    // partnerId 변환
    const partnerId = Number(intent.customerId);
    this.logger.log(
      `Converted customerId ${intent.customerId} to partnerId ${partnerId}`,
    );

    // 포인트 잔액 체크
    const balance = await this.pointService.getBalance(partnerId);
    this.logger.log(`Current point balance: ${balance}`);

    if (balance < usePoints) {
      throw new Error(
        `Insufficient points. Balance: ${balance}, Required: ${usePoints}`,
      );
    }

    // 포인트 차감
    const redeemResult = await this.pointService.redeem(
      {
        partnerId,
        amount: usePoints,
        reason: 'PAYMENT',
        memo: `Intent: ${intent.id}`,
      },
      tx,
    );

    this.logger.log(
      `Points redeemed successfully. EventId: ${redeemResult.eventId}`,
    );

    // 할인 정보 생성
    const discounts: DiscountLine[] = [
      {
        type: 'POINTS',
        amount: usePoints,
        pointEventId: redeemResult.eventId,
        appliedAt: new Date(),
      },
    ];

    const finalAmount = Number(intent.amount) - usePoints;
    const isFullPayment = finalAmount === 0;

    // Intent에 할인 정보 업데이트
    await this.intentManager.applyDiscounts(
      intent.id,
      discounts,
      String(usePoints),
      String(finalAmount),
      tx,
    );

    this.logger.log(
      `Points applied. Final amount: ${finalAmount}, Full payment: ${isFullPayment}`,
    );

    return {
      pointEventId: redeemResult.eventId,
      pointsUsed: usePoints,
      finalAmount,
      isFullPayment,
      discounts,
    };
  }

  /**
   * 포인트 전액 결제를 완료 처리합니다.
   */
  private async completePointOnlyPayment(
    intent: PaymentIntent,
    pointResult: {
      pointEventId: number | null;
      pointsUsed: number;
      finalAmount: number;
      isFullPayment: boolean;
      discounts: DiscountLine[];
    },
    options: {
      sessionId?: string;
      actor?: string;
      source?: string;
    },
    tx: any,
  ): Promise<PaymentResult> {
    this.logger.log('포인트 전액 결제 - 바로 CAPTURED 처리');

    await this.intentManager.completeAsPointOnly(intent.id, tx);

    return {
      success: true,
      message: '포인트 전액 결제 완료',
      transactionId: intent.id,
      attemptId: null,
      pointEventId: pointResult.pointEventId,
      breakdown: {
        totalAmount: Number(intent.amount),
        pointsUsed: pointResult.pointsUsed,
        finalAmount: 0,
      },
    };
  }

  /**
   * 외부 결제를 실행하고 결과를 기록합니다.
   */
  private async executeExternalPayment(
    intent: PaymentIntent,
    providerType: ProviderType,
    pointResult: {
      pointEventId: number | null;
      pointsUsed: number;
      finalAmount: number;
      isFullPayment: boolean;
      discounts: DiscountLine[];
    },
    options: {
      profileId?: string;
      instrumentRef?: string;
      sessionId?: string;
      actor?: string;
      source?: string;
    },
    tx: any,
  ): Promise<PaymentResult> {
    // Provider 필수 검증
    if (!providerType) {
      throw new Error(
        'Provider is required for non-point payments. External payment provider must be specified.',
      );
    }

    // PaymentRequest 객체 조립
    const paymentRequest = this.requestBuilder.build(
      intent,
      pointResult.finalAmount,
      {
        ...options,
        pointEventId: pointResult.pointEventId,
        pointsUsed: pointResult.pointsUsed,
      },
    );

    try {
      // 외부 결제 승인 실행
      const result = await this.paymentExecutor.authorize(
        paymentRequest,
        providerType,
        intent,
        { tx },
      );

      // 성공 시 Attempt와 Intent 상태 업데이트
      await this.attemptManager.create(
        paymentRequest,
        result,
        providerType,
        'AUTHORIZED',
        tx,
      );
      await this.intentManager.updateStatus(intent.id, 'AUTHORIZED', tx);

      // 포인트 정보를 결과에 포함
      result.attemptId = paymentRequest.attemptId;
      result.pointEventId = pointResult.pointEventId;
      result.breakdown = {
        totalAmount: Number(intent.amount),
        pointsUsed: pointResult.pointsUsed,
        finalAmount: pointResult.finalAmount,
      };

      this.logger.log(
        `Authorization successful for Intent: ${intent.id}, Success: ${result.success}`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        `Authorization failed for Intent: ${intent.id}`,
        error.stack,
      );

      // ✨ [UNKNOWN 상태 처리] 외부 결제 승인 성공했지만 내부 처리 도중 에러 가능성 대비
      if (error.pgApproved === true) {
        this.logger.warn(
          `External payment approved but internal processing failed for Intent: ${intent.id}. Setting status to UNKNOWN.`,
        );
        await this.intentManager.markAsUnknown(intent.id);
      }

      // 실패 기록
      const failedResult: PaymentResult = {
        success: false,
        code: error.code,
        message: error.message,
      };
      await this.attemptManager.create(
        paymentRequest,
        failedResult,
        providerType,
        'FAILED',
        tx,
      );

      // 에러를 다시 던져서 트랜잭션을 롤백시키고 호출자에게 알림
      throw error;
    }
  }

  /**
   * 결제 캡처(Capture) - 이미 승인된 결제를 실제로 정산 처리합니다.
   */
  async capturePayment(
    intentId: string,
    attemptId: string,
    amount?: number,
    _options: {
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
      this.intentManager.findByIdOrFail(intentId),
      this.attemptManager.findByIdOrFail(attemptId),
    ]);

    if (attempt.status !== 'AUTHORIZED') {
      throw new Error(
        `Attempt ${attemptId} is not in AUTHORIZED status: ${attempt.status}`,
      );
    }

    const captureAmount = amount || attempt.amount;

    return this.db.db.transaction(async (tx) => {
      try {
        // Executor에게 결제 캡처를 위임
        const result = await this.paymentExecutor.capture(
          attemptId,
          attempt.provider as ProviderType,
          captureAmount,
          { tx },
        );

        // 성공 시 Attempt와 Intent 상태를 업데이트
        await this.attemptManager.updateStatus(
          attemptId,
          'CAPTURED',
          result,
          tx,
        );
        await this.intentManager.updateStatus(intentId, 'CAPTURED', tx);

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

        await this.attemptManager.updateStatus(
          attemptId,
          'CAPTURE_FAILED',
          failedResult,
          tx,
        );

        throw error;
      }
    });
  }
}
