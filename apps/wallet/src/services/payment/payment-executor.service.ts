import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { PaymentPolicy } from '../../providers/payment-policy';
import { ProviderRegistry } from '../../providers/provider-registry';
import {
  PaymentError,
  PaymentRequest,
  PaymentResult,
  ProviderType,
  TossPayload,
} from '../../providers/payment-provider.interface';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import {
  assertIntentIsPending,
  assertIntentIsNotExpired,
} from '../intents/intent.assets';
import type { PaymentIntent } from '../../shared/database/types';
import { BnplService } from '../bnpl/bnpl.service';

/**
 * PaymentExecutorService 구현체 (Adapter)
 *
 * 책임:
 * - 결제 승인/캡처/조회 실행
 * - Provider 호출 및 정책 검증
 * - DB 트랜잭션 처리
 */
@Injectable()
export class PaymentExecutorServiceImpl {
  private readonly logger = new Logger(PaymentExecutorServiceImpl.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly registry: ProviderRegistry,
    private readonly profiles: PaymentProfileService,
    private readonly bnplService: BnplService,
  ) {}

  async authorize(
    request: PaymentRequest,
    provider: ProviderType,
    intent: PaymentIntent,
    options?: { tx?: any },
  ): Promise<PaymentResult> {
    const transaction = options?.tx ?? this.db.db;

    this.logger.log(
      `Authorizing attempt ${request.attemptId} for intent ${request.intentId}`,
    );

    // =======================================================
    // 👮‍♂️ 최후의 방어선 (Final Validation)
    // =======================================================

    // 1. 정책 검증
    const allowed = PaymentPolicy.getAllowedProviders(request.paymentType);
    if (!allowed.includes(provider)) {
      throw new Error(
        `Policy violation: ${provider} not allowed for ${request.paymentType}`,
      );
    }

    // 2. Intent 상태 및 만료 검증 (Assert 함수 사용)
    assertIntentIsPending(intent);
    assertIntentIsNotExpired(intent);

    // 3. Provider의 능력(Capability) 확인
    const handle = this.registry.get(provider);
    if (!handle.charge) {
      throw new Error(
        `Provider ${provider} does not support charge functionality`,
      );
    }

    // 4. BNPL 특별 처리: 한도 차감 및 신용 사용 이벤트 생성
    if (provider === ProviderType.HMS_BNPL) {
      await this.bnplService.purchaseWithCredit(
        intent.customerId,
        request.amount,
        request.metadata?.externalOrderId || request.intentId,
        request.intentId,
        transaction,
      );

      this.logger.log(
        `BNPL credit event created for user ${intent.customerId}, amount: ${request.amount}`,
      );
    }
    // =======================================================

    // 📝 Payload 조립
    // ✨ [수정] 상위 컨텍스트의 트랜잭션(transaction)을 사용합니다.
    let payload = await this.profiles.resolvePayload(
      request.profileId!,
      provider,
      request.amount,
      { tx: transaction },
    );

    if (request.instrumentType === 'ONE_TIME' && request.instrumentRef) {
      if (provider === ProviderType.TOSS) {
        (payload as TossPayload).oneTimeToken = request.instrumentRef;
        // intentId를 metadata로 전달 (토스 orderId로 사용)
        (payload as TossPayload).metadata = {
          ...(payload as TossPayload).metadata,
          intentId: request.intentId,
        };
      }
    }

    // 🚀 실제 결제 승인 실행 (authorize 모드)
    const result = handle.charge.authorize
      ? await handle.charge.authorize(payload as any)
      : await handle.charge.process(payload as any);

    if (!result.success) {
      throw new Error(
        result.message ||
          'Payment authorization failed. Provider returned unsuccessful result.',
      );
    }

    return result;
  }

  async capture(
    attemptId: string,
    provider: ProviderType,
    amount: number,
    options?: { tx?: any },
  ): Promise<PaymentResult> {
    const _transaction = options?.tx ?? this.db.db;

    this.logger.log(`Capturing attempt ${attemptId} with amount ${amount}`);

    // Provider의 capture 능력 확인
    const handle = this.registry.get(provider);
    if (!handle.charge) {
      throw new Error(
        `Provider ${provider} does not support charge functionality`,
      );
    }

    // 🚀 실제 결제 캡처 실행
    const result = handle.charge.capture
      ? await handle.charge.capture({
          attemptId,
          amount,
        })
      : {
          success: true,
          transactionId: `capture_${attemptId}`,
          code: 'CAPTURE_NOT_IMPLEMENTED',
          message: 'Capture not implemented for this provider',
        };

    if (!result.success) {
      throw new Error(
        result.message ||
          'Payment capture failed. Provider returned unsuccessful result.',
      );
    }

    return result;
  }

  async inquire(
    intentId: string,
    provider: ProviderType,
  ): Promise<{ status: string; transactionId: string }> {
    this.logger.log(
      `Inquiring payment status for intent ${intentId} via ${provider}`,
    );

    const handle = this.registry.get(provider);
    if (!handle) {
      throw new Error(`Provider not found for inquiry: ${provider}`);
    }

    try {
      // 실제 구현에서는 각 provider의 inquire 메서드를 호출해야 합니다
      // 현재는 기본적인 구조만 제공합니다
      return {
        status: 'AUTHORIZED', // 임시로 AUTHORIZED 반환
        transactionId: `temp_${intentId}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to inquire payment status for intent ${intentId}:`,
        error,
      );
      throw error;
    }
  }
}
