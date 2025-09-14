import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/database/schema';
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

@Injectable()
export class PaymentExecutorService {
  private readonly logger = new Logger(PaymentExecutorService.name);

  constructor(
    private readonly db: DbService<typeof schema>,
    private readonly registry: ProviderRegistry,
    private readonly profiles: PaymentProfileService,
  ) {}

  /**
   * 결제 시도(Attempt)를 검증하고 실행합니다.
   * @param request 결제 시도 정보 (Attempt)
   * @param provider 사용할 결제 수단
   * @param intent 원본 결제 의도 객체 (검증용)
   */
  async execute(
    request: PaymentRequest,
    provider: ProviderType,
    intent: PaymentIntent,
  ) {
    return runInTransaction(this.db, async (tx) => {
      this.logger.log(
        `Executing attempt ${request.attemptId} for intent ${request.intentId}`,
      );

      // =======================================================
      // ✨ 바로 이곳이 기존 결제 처리 함수들이 모인 곳입니다 ✨
      // 👮‍♂️ 최후의 방어선 (Final Validation)
      // =======================================================

      // 1. 정책 검증
      const allowed = PaymentPolicy.getAllowedProviders(request.paymentType);
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
      // =======================================================

      // 📝 Payload 조립
      let payload = await this.profiles.resolvePayload(
        request.profileId!,
        provider,
        request.amount,
        { tx },
      );

      if (request.instrumentType === 'ONE_TIME' && request.instrumentRef) {
        if (provider === ProviderType.TOSS) {
          (payload as TossPayload).oneTimeToken = request.instrumentRef;
        }
      }

      // 🚀 실제 결제 실행
      const result = await handle.charge.process(payload as any);

      if (!result.success) {
        throw new PaymentError(
          result.code || 'PAYMENT_PROVIDER_FAILED',
          result.message,
        );
      }

      return result;
    });
  }
}
