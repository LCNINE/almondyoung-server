import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../shared/database/schema';
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
import { PaymentRequestBuilder } from './payment/payment-request.builder';

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
    private readonly requestBuilder: PaymentRequestBuilder,
  ) {}

  /**
   * 결제 승인 (5줄)
   */
  async authorizePaymentByIntent(
    intentId: string,
    providerType: ProviderType | null,
    options: {
      usePoints?: number;
      profileId?: string;
      instrumentRef?: string;
      instrumentType?: string;
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

      // 6. PaymentRequest 조립
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
          paymentRequest,
          result,
          providerType,
          'AUTHORIZED',
          tx,
        );
        await this.paymentManager.updateStatus(
          intentId,
          paymentRequest.attemptId,
          'AUTHORIZED',
          result,
          tx,
        );

        // 9. 포인트 정보 포함
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
          paymentRequest,
          failedResult,
          providerType,
          'FAILED',
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
}
