import { Injectable, Logger } from '@nestjs/common';
import { ProviderRegistry } from '../../providers/provider-registry';
import { PaymentProfileService } from '../profiles/payment-profile.service';
import { BnplService } from '../bnpl/bnpl.service';
import { PaymentPolicy } from '../../providers/payment-policy';
import { PaymentStrategyFactory } from './strategies/payment-strategy.factory';
import type {
  PaymentResult,
  ProviderType,
} from '../../providers/payment-provider.interface';
import type { PaymentIntent } from '../../shared/database/types';
import type { PointResult } from './payment-point.manager';

/**
 * PaymentProviderManager (Implementation Layer)
 *
 * 책임: Provider 관련 모든 로직
 * - Provider 선택
 * - 정책 검증
 * - Payload 조립 (전략 패턴 사용)
 * - Provider 호출
 * - BNPL 특별 처리
 */
@Injectable()
export class PaymentProviderManager {
  private readonly logger = new Logger(PaymentProviderManager.name);

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly profiles: PaymentProfileService,
    private readonly bnplService: BnplService,
    private readonly strategyFactory: PaymentStrategyFactory,
  ) {}

  /**
   * Provider를 통한 결제 승인
   */
  async authorizeWithProvider(
    intent: PaymentIntent,
    providerType: ProviderType,
    pointResult: PointResult,
    options: {
      authParams?: Record<string, string>;
      profileId?: string;
      sessionId?: string;
      actor?: string;
      source?: string;
    },
    tx: any,
  ): Promise<PaymentResult> {
    this.logger.log(
      `Authorizing with provider ${providerType} for intent ${intent.id}`,
    );

    // 1. 정책 검증
    this.validatePolicy(providerType, intent.referenceType as string);

    // 2. BNPL 특별 처리
    if (providerType === 'HMS_BNPL') {
      await this.handleBnplPurchase(intent, pointResult.finalAmount, tx);
    }

    // 3. Provider 선택
    const provider = this.registry.get(providerType);
    if (!provider.charge) {
      throw new Error(
        `Provider ${providerType} does not support charge functionality`,
      );
    }

    // 4. Payload 조립
    const payload = await this.buildPayload(
      intent,
      providerType,
      pointResult.finalAmount,
      options,
      tx,
    );

    // 5. Provider 호출
    const result = provider.charge.authorize
      ? await provider.charge.authorize(payload as any)
      : await provider.charge.process(payload as any);

    if (!result.success) {
      throw new Error(
        result.message ||
          'Payment authorization failed. Provider returned unsuccessful result.',
      );
    }

    this.logger.log(
      `Authorization successful for intent ${intent.id} via ${providerType}`,
    );

    return result;
  }

  /**
   * Provider를 통한 결제 캡처
   */
  async captureWithProvider(
    attempt: any,
    amount: number,
    _options: {
      actor?: string;
      source?: string;
    },
  ): Promise<PaymentResult> {
    this.logger.log(
      `Capturing with provider ${attempt.provider} for attempt ${attempt.id}`,
    );

    // 1. Provider 선택
    const provider = this.registry.get(attempt.provider as ProviderType);
    if (!provider.charge) {
      throw new Error(
        `Provider ${attempt.provider} does not support charge functionality`,
      );
    }

    // 2. Provider 호출
    const result = provider.charge.capture
      ? await provider.charge.capture({
          attemptId: attempt.id,
          amount,
        })
      : {
          success: true,
          transactionId: `capture_${attempt.id}`,
          code: 'CAPTURE_NOT_IMPLEMENTED',
          message: 'Capture not implemented for this provider',
        };

    if (!result.success) {
      throw new Error(
        result.message ||
          'Payment capture failed. Provider returned unsuccessful result.',
      );
    }

    this.logger.log(
      `Capture successful for attempt ${attempt.id} via ${attempt.provider}`,
    );

    return result;
  }

  /**
   * 정책 검증 (내부 메서드)
   */
  private validatePolicy(
    providerType: ProviderType,
    paymentType: string,
  ): void {
    const allowed = PaymentPolicy.getAllowedProviders(paymentType as any);
    if (!allowed.includes(providerType)) {
      throw new Error(
        `Policy violation: ${providerType} not allowed for ${paymentType}`,
      );
    }

    this.logger.log(
      `Policy validation passed for ${providerType} on ${paymentType}`,
    );
  }

  /**
   * BNPL 구매 처리 (내부 메서드)
   */
  private async handleBnplPurchase(
    intent: PaymentIntent,
    amount: number,
    tx: any,
  ): Promise<void> {
    this.logger.log(
      `Processing BNPL purchase for user ${intent.customerId}, amount: ${amount}`,
    );

    await this.bnplService.purchaseWithCredit(
      intent.customerId,
      amount,
      (intent.metadata as any)?.externalOrderId || intent.id,
      intent.id,
      tx,
    );

    this.logger.log(`BNPL credit event created for user ${intent.customerId}`);
  }

  /**
   * Payload 조립 (전략 패턴 사용)
   */
  private async buildPayload(
    intent: PaymentIntent,
    providerType: ProviderType,
    amount: number,
    options: {
      authParams?: Record<string, string>;
      profileId?: string;
    },
    tx: any,
  ): Promise<any> {
    this.logger.log(`Building payload for ${providerType}`);

    // 전략 선택 및 Payload 조립
    const strategy = this.strategyFactory.getStrategy(options);
    return strategy.buildPayload(intent, providerType, amount, options, tx);
  }
}
