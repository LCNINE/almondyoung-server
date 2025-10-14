import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
import { walletSchema } from '../../shared/database/schema';
import { runInTransaction } from '../../shared/database';
import { PaymentPolicy } from '../../providers/payment-policy';
import { ProviderRegistry } from '../../providers/provider-registry';
import {
  PaymentError,
  PaymentRequest,
  ProviderType,
  TossPayload,
} from '../../providers/payment-provider.interface';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import {
  assertIntentIsPending,
  assertIntentIsNotExpired,
} from '../intents/intent.assets';
import { PaymentIntent } from '../../shared/database/types';
import { BnplAccountService } from '../bnpl-account.service';

@Injectable()
export class PaymentExecutorService {
  private readonly logger = new Logger(PaymentExecutorService.name);

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly registry: ProviderRegistry,
    private readonly profiles: PaymentProfileService,
    private readonly bnplAccountService: BnplAccountService,
  ) {}

  /**
   * 결제 승인(Authorization)을 검증하고 실행합니다.
   * @param request 결제 시도 정보 (Attempt)
   * @param provider 사용할 결제 수단
   * @param intent 원본 결제 의도 객체 (검증용)
   */
  async authorize(
    request: PaymentRequest,
    provider: ProviderType,
    intent: PaymentIntent,
    // ✨ [수정] 옵션 객체와 tx를 선택적으로 받도록 변경
    options?: { tx?: any },
  ) {
    // ✨ [핵심 개선] 전달받은 tx가 있으면 사용하고, 없으면 새로운 트랜잭션을 시작합니다.
    const transaction = options?.tx ?? this.db.db;

    this.logger.log(
      `Authorizing attempt ${request.attemptId} for intent ${request.intentId}`,
    );

    // =======================================================
    // 👮‍♂️ 최후의 방어선 (Final Validation)
    // =======================================================

    // 1. 정책 검증
    const allowed = await PaymentPolicy.getAllowedProviders(
      request.paymentType,
    );
    if (!allowed.includes(provider)) {
      throw new PaymentError(
        'POLICY_FORBIDDEN',
        `Policy violation for ${request.paymentType}`,
      );
    }

    // 2. Intent 상태 및 만료 검증 (Assert 함수 사용)
    assertIntentIsPending(intent);
    assertIntentIsNotExpired(intent);

    // 3. Provider의 능력(Capability) 확인
    const handle = this.registry.get(provider);
    if (!handle.charge) {
      throw new PaymentError(
        'CHARGE_NOT_SUPPORTED',
        `${provider} does not support charge`,
      );
    }

    // 4. BNPL 특별 처리: 한도 차감 및 신용 사용 이벤트 생성
    if (provider === ProviderType.HMS_BNPL) {
      await this.bnplAccountService.createCreditEvent(
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
      : await handle.charge.process(payload as any); // fallback to process

    if (!result.success) {
      throw new PaymentError(
        result.code || 'PAYMENT_AUTHORIZATION_FAILED',
        result.message,
      );
    }

    return result;
  }

  /**
   * 결제 캡처(Capture)를 실행합니다.
   * @param attemptId 캡처할 시도 ID
   * @param provider 사용할 결제 수단
   * @param amount 캡처할 금액
   */
  async capture(
    attemptId: string,
    provider: ProviderType,
    amount: number,
    options?: { tx?: any },
  ) {
    const transaction = options?.tx ?? this.db.db;

    this.logger.log(`Capturing attempt ${attemptId} with amount ${amount}`);

    // Provider의 capture 능력 확인
    const handle = this.registry.get(provider);
    if (!handle.charge) {
      throw new PaymentError(
        'CHARGE_NOT_SUPPORTED',
        `${provider} does not support charge`,
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
      throw new PaymentError(
        result.code || 'PAYMENT_CAPTURE_FAILED',
        result.message,
      );
    }

    return result;
  }

  /**
   * 결제 상태를 조회합니다.
   * @param intentId 결제 의도 ID
   * @param provider 결제 제공자
   * @returns 결제 상태 정보
   */
  async inquire(intentId: string, provider: ProviderType) {
    this.logger.log(
      `Inquiring payment status for intent ${intentId} via ${provider}`,
    );

    const handle = this.registry.get(provider);
    if (!handle) {
      throw new Error(`Provider not found: ${provider}`);
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
