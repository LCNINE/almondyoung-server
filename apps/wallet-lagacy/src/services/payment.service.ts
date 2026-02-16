import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { paymentIntents, walletSchema } from '../shared/database/schema';
import { OutboxService } from './outbox/outbox.service';
import {
  PaymentResult,
  RefundResult,
  CancelResult,
  RefundRequest,
  CancelRequest,
  PaymentType,
  ProviderType,
  PaymentError,
} from '../providers/payment-provider.interface';
import { PaymentPolicy } from '../providers/payment-policy';
import { ProviderRegistry } from '../providers/provider-registry';
import { PaymentReader } from './payment/payment.reader';
import { PaymentManager } from './payment/payment.manager';
import { PaymentPointManager } from './payment/payment-point.manager';
import { PaymentProviderManager } from './payment/payment-provider.manager';
import { PaymentAttemptRepository } from './payment/payment-attempt.repository';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import type { WalletExecutor } from '../shared/database';
import { PaymentIntent } from '../shared/database/types';

/**
 * PaymentService (Business Layer)
 *
 * 책임: 비즈니스 흐름만 표현 (2-3줄)
 * - Reader/Manager를 통해서만 접근
 * - Provider 세부사항 모름
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly paymentReader: PaymentReader,
    private readonly paymentManager: PaymentManager,
    private readonly pointManager: PaymentPointManager,
    private readonly providerManager: PaymentProviderManager,
    private readonly attemptRepo: PaymentAttemptRepository,
    private readonly outboxService: OutboxService,
  ) { }

  /**
   * 이미 완료된 Intent의 기존 결과를 반환합니다. (멱등성 보장)
   *
   * - Intent가 이미 AUTHORIZED 또는 CAPTURED 상태이면 기존 결과 반환
   * - 요청한 Provider 타입과 기존 타입이 다르면 PROVIDER_MISMATCH 에러
   * - 완료된 상태가 아니면 undefined 반환
   */
  private async _getExistingResult(
    intent: PaymentIntent,
    expectedProvider?: ProviderType | null,
    tx?: WalletExecutor,
  ): Promise<PaymentResult | undefined> {
    return this.paymentManager.getCompletedResult(intent, expectedProvider, tx);
  }

  /**
   * 결제 승인 (5줄)
   */
  async authorizePaymentByIntent(
    intentId: string,
    providerType: ProviderType | null,
    options: {
      usePoints?: number;
      authParams?: Record<string, string>;
      profileId?: string;
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Authorizing payment for intent: ${intentId} with provider: ${providerType || '포인트 전액'}`,
    );

    return this.db.db.transaction(async (tx) => {
      // 1. Intent 조회 및 검증
      const intent = await this.paymentReader.findIntent(intentId);

      // 멱등성 가드: 이미 완료된 결제라면 기존 결과 반환
      const existingResult = await this._getExistingResult(
        intent,
        providerType,
        tx,
      );
      if (existingResult) {
        this.logger.log(
          `기존에 처리된 Intent: ${intentId}의 결과를 반환합니다 (Idempotency 보장).`
        );

        return existingResult;
      }

      await this.paymentManager.prepareIntent(intent);

      // 2. 기존 활성 결제 취소
      await this.paymentManager.cancelActiveAttempts(intentId, tx);

      // 3. 포인트 적용
      const pointResult = await this.pointManager.applyPoints(
        intent,
        options.usePoints,
        tx,
      );

      // 4. 포인트 전액 결제
      if (pointResult.isFullPayment) {
        return await this.pointManager.completePointOnlyPayment(
          intent,
          pointResult,
          tx,
        );
      }

      // 5. 외부 결제 (Provider 필수)
      if (!providerType) {
        throw new Error(
          'Provider is required for non-point payments. External payment provider must be specified.',
        );
      }

      // 6. Attempt ID 생성
      const attemptId = generateUUIDv7();

      try {
        // 7. Provider 호출
        const result = await this.providerManager.authorizeWithProvider(
          intent,
          providerType,
          pointResult,
          options,
          tx,
        );

        // 8. 성공 기록
        await this.attemptRepo.create(
          {
            attemptId,
            intentId: intent.id,
            provider: providerType,
            profileId: options.profileId,
            amount: pointResult.finalAmount,
            metadata: {
              source: options.source || 'api',
              actor: options.actor || 'SYSTEM',
              pointEventId: pointResult.pointEventId,
              pointsUsed: pointResult.pointsUsed,
              authParams: options.authParams,
            },
          },
          result,
          'AUTHORIZED',
          tx,
        );
        await this.paymentManager.updateStatus(
          intentId,
          attemptId,
          'AUTHORIZED',
          result,
          tx,
        );

        // 9. 포인트 정보 포함
        result.attemptId = attemptId;
        result.pointEventId = pointResult.pointEventId;
        result.breakdown = {
          originalAmount: Number(intent.originalAmount),
          pointsUsed: pointResult.pointsUsed,
          finalAmount: pointResult.finalAmount,
        };

        // 10. Outbox에 이벤트 저장 - PaymentAuthorized
        const intentMetadata = intent.metadata as any;
        await this.outboxService.enqueue(
          {
            eventType: 'PaymentAuthorized',
            aggregateType: 'Payment',
            aggregateId: intent.id,
            partitionKey: intent.customerId,
            payload: {
              intentId: intent.id,
              paymentId: attemptId,
              customerId: intent.customerId,
              amount: pointResult.finalAmount,
              currency: 'KRW',
              providerType: providerType,
              providerTransactionId: result.transactionId,
              orderId: intentMetadata?.orderId,
              metadata: {
                pointsUsed: pointResult.pointsUsed,
                originalAmount: Number(intent.originalAmount),
                source: options.source || 'api',
                actor: options.actor || 'SYSTEM',
              },
              authorizedAt: new Date().toISOString(),
            },
          },
          tx,
        );

        this.logger.log(
          `Authorization successful for Intent: ${intent.id}, Success: ${result.success}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Authorization failed for Intent: ${intent.id}`,
          error.stack,
        );

        // UNKNOWN 상태 처리
        if (error.pgApproved === true) {
          this.logger.warn(
            `External payment approved but internal processing failed for Intent: ${intent.id}. Setting status to UNKNOWN.`,
          );
          await this.paymentManager.markAsUnknown(intent.id);
        }

        // 실패 기록
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };
        await this.attemptRepo.create(
          {
            attemptId,
            intentId: intent.id,
            provider: providerType,
            profileId: options.profileId,
            amount: pointResult.finalAmount,
            metadata: {
              source: options.source || 'api',
              actor: options.actor || 'SYSTEM',
              pointEventId: pointResult.pointEventId,
              pointsUsed: pointResult.pointsUsed,
              authParams: options.authParams,
              error: error.message,
            },
          },
          failedResult,
          'FAILED',
          tx,
        );

        // Outbox에 이벤트 저장 - PaymentFailed
        const intentMetadata = intent.metadata as any;
        await this.outboxService.enqueue(
          {
            eventType: 'PaymentFailed',
            aggregateType: 'Payment',
            aggregateId: intent.id,
            partitionKey: intent.customerId,
            payload: {
              intentId: intent.id,
              paymentId: attemptId,
              customerId: intent.customerId,
              amount: pointResult.finalAmount,
              currency: 'KRW',
              providerType: providerType,
              errorCode: error.code || 'UNKNOWN_ERROR',
              errorMessage: error.message || 'Payment authorization failed',
              orderId: intentMetadata?.orderId,
              isRetryable: error.retryable !== false,
              failedAt: new Date().toISOString(),
            },
          },
          tx,
        );

        throw error;
      }
    });
  }

  /**
   * 결제 캡처 (3줄)
   */
  async capturePaymentByIntent(
    intentId: string,
    attemptId: string,
    amount?: number,
    options: {
      actor?: string;
      source?: string;
    } = {},
  ): Promise<PaymentResult> {
    this.logger.log(
      `Capturing payment for intent: ${intentId}, attempt: ${attemptId}`,
    );

    return this.db.db.transaction(async (tx) => {
      // 1. Attempt 조회
      const attempt = await this.paymentReader.findAttempt(attemptId);

      if (attempt.status !== 'AUTHORIZED') {
        throw new Error(
          `Attempt ${attemptId} is not in AUTHORIZED status: ${attempt.status}`,
        );
      }

      const captureAmount = amount || attempt.amount;

      try {
        // 2. Provider 호출
        const result = await this.providerManager.captureWithProvider(
          attempt,
          captureAmount,
          options,
        );

        // 3. 성공 기록
        await this.paymentManager.updateStatus(
          intentId,
          attemptId,
          'CAPTURED',
          result,
          tx,
        );

        // 4. Outbox에 이벤트 저장 - PaymentCaptured
        const intent = await this.paymentReader.findIntent(intentId);
        const intentMetadata = intent.metadata as any;
        await this.outboxService.enqueue(
          {
            eventType: 'PaymentCaptured',
            aggregateType: 'Payment',
            aggregateId: intentId,
            partitionKey: intent.customerId,
            payload: {
              intentId: intentId,
              paymentId: attemptId,
              customerId: intent.customerId,
              amount: captureAmount,
              currency: 'KRW',
              providerType: attempt.provider,
              providerTransactionId: result.transactionId,
              orderId: intentMetadata?.orderId,
              metadata: {
                source: options.source || 'api',
                actor: options.actor || 'SYSTEM',
              },
              capturedAt: new Date().toISOString(),
            },
          },
          tx,
        );

        this.logger.log(
          `Capture successful for Intent: ${intentId}, Attempt: ${attemptId}`,
        );
        return result;
      } catch (error: any) {
        this.logger.error(
          `Capture failed for Intent: ${intentId}, Attempt: ${attemptId}`,
          error.stack,
        );

        // 실패 기록
        const failedResult: PaymentResult = {
          success: false,
          code: error.code,
          message: error.message,
        };

        await this.attemptRepo.updateStatus(
          attemptId,
          'CAPTURE_FAILED',
          failedResult,
          tx,
        );

        // Outbox에 이벤트 저장 - PaymentFailed (Capture 단계)
        const intent = await this.paymentReader.findIntent(intentId);
        const intentMetadata = intent.metadata as any;
        await this.outboxService.enqueue(
          {
            eventType: 'PaymentFailed',
            aggregateType: 'Payment',
            aggregateId: intentId,
            partitionKey: intent.customerId,
            payload: {
              intentId: intentId,
              paymentId: attemptId,
              customerId: intent.customerId,
              amount: captureAmount,
              currency: 'KRW',
              providerType: attempt.provider,
              errorCode: error.code || 'CAPTURE_FAILED',
              errorMessage: error.message || 'Payment capture failed',
              orderId: intentMetadata?.orderId,
              isRetryable: false,
              failedAt: new Date().toISOString(),
            },
          },
          tx,
        );

        throw error;
      }
    });
  }

  /**
   * 환불 처리
   * ✨ [CTO 스타일] 공통 파라미터만 받고, Provider별 DTO 조립은 각 Provider에서 담당
   */
  async refundPayment(
    providerType: ProviderType,
    request: RefundRequest,
  ): Promise<RefundResult> {
    this.logger.log(`Processing refund for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.refund) {
      throw new PaymentError(
        'REFUND_NOT_SUPPORTED',
        `${providerType} does not support refund functionality.`,
      );
    }

    // Provider별 클래스에서 DTO 조립 및 API 호출 담당
    return handle.refund.refund(request);
  }

  /**
   * 결제 취소
   * ✨ [CTO 스타일] 공통 파라미터만 받고, Provider별 DTO 조립은 각 Provider에서 담당
   */
  async cancelPayment(
    providerType: ProviderType,
    request: CancelRequest,
  ): Promise<CancelResult> {
    this.logger.log(`Processing cancellation for provider: ${providerType}`);

    const handle = this.providerRegistry.get(providerType);
    if (!handle.cancel) {
      throw new PaymentError(
        'CANCEL_NOT_SUPPORTED',
        `${providerType} does not support cancel functionality.`,
      );
    }

    // Provider별 클래스에서 DTO 조립 및 API 호출 담당
    return handle.cancel.cancel(request);
  }

  /**
   * 결제 타입에 허용된 Provider 목록 조회 (단순 조회 기능)
   */
  getAllowedProviders(paymentType: PaymentType): ProviderType[] {
    return PaymentPolicy.getAllowedProviders(paymentType);
  }

  /**
   * Phase 2 - 결제 취소 (Intent 기반)
   *
   * 결제가 완료되기 전(PENDING, AUTHORIZED)에 취소
   * CAPTURED 상태는 refundPayment 사용
   */
  async cancelPaymentByIntent(
    intentId: string,
    cancelReason: string = 'CUSTOMER_REQUEST',
    cancelledBy?: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`결제 취소 시작: intentId=${intentId}`);

    return this.db.db.transaction(async (tx) => {
      // 1. Intent 조회
      const intent = await this.paymentReader.findIntent(intentId);

      // 2. 취소 가능 상태 체크
      if (!['PENDING', 'AUTHORIZED'].includes(intent.status)) {
        throw new Error(
          `Cannot cancel payment in ${intent.status} status. Use refund instead.`,
        );
      }

      // 3. 활성 Attempt 취소 (반환값은 취소된 Attempt ID 목록)
      const cancelledIds = await this.paymentManager.cancelActiveAttempts(
        intentId,
        tx,
      );

      // 4. Intent 상태 업데이트
      await this.paymentManager.updateStatus(
        intentId,
        null,
        'CANCELLED',
        { reason: cancelReason },
        tx,
      );

      // 5. 포인트 복원은 이미 cancelActiveAttempts에서 처리됨
      // (PaymentManager.cancelActiveAttempts가 내부적으로 처리)

      // 6. Outbox에 이벤트 저장 - PaymentCancelled
      const metadata = intent.metadata as any;
      const paymentId = cancelledIds.length > 0 ? cancelledIds[0] : '';

      await this.outboxService.enqueue(
        {
          eventType: 'PaymentCancelled',
          aggregateType: 'Payment',
          aggregateId: intentId,
          partitionKey: intent.customerId,
          payload: {
            intentId: intentId,
            paymentId: paymentId,
            customerId: intent.customerId,
            amount: intent.finalAmount,
            currency: 'KRW',
            reason: cancelReason,
            cancelledBy: cancelledBy,
            orderId: metadata?.orderId,
            cancelledAt: new Date().toISOString(),
          },
        },
        tx,
      );

      this.logger.log(
        `PaymentCancelled 이벤트 발행 완료: intentId=${intentId}`,
      );

      return {
        success: true,
        message: `Payment cancelled successfully`,
      };
    });
  }
}
