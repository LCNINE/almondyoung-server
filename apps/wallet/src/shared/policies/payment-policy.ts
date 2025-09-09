// payment-policy.ts - v4 Architecture 정책 시스템
import { PaymentIntentType, PaymentProvider } from '../database/schema';

/**
 * 결제 타입별 정책 인터페이스
 */
export interface PaymentTypePolicy {
  description: string;
  allowed: PaymentProvider[];
  requiresStoredProfile: boolean;
  allowsEphemeral: boolean;
  maxAmount: number;
  minAmount: number;
}

/**
 * Provider별 설정 인터페이스
 */
export interface ProviderConfig {
  enabled: boolean;
  supportedMethods: string[];
  maxRetries: number;
  timeoutMs: number;
}

/**
 * 전체 결제 정책 인터페이스
 */
export interface PaymentPolicyConfig {
  payments: {
    typePolicy: Record<PaymentIntentType, PaymentTypePolicy>;
    providerConfig: Record<PaymentProvider, ProviderConfig>;
    validation: {
      idempotencyKeyTtlHours: number;
      sessionExpiryMinutes: number;
      maxRefundRatio: number;
      allowPartialRefund: boolean;
    };
    security: {
      maskCardNumber: boolean;
      logSensitiveData: boolean;
      requireTlsForWebhooks: boolean;
    };
  };
  refunds: {
    policy: {
      autoApprovalLimit: number;
      requiresManualApproval: boolean;
      maxRefundDays: number;
      allowedReasons: string[];
    };
  };
}

/**
 * 정책 검증 에러 타입
 */
export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any,
  ) {
    super(message);
    this.name = 'PolicyViolationError';
  }
}

/**
 * 정책 검증 함수들
 */
export class PaymentPolicyValidator {
  constructor(private readonly config: PaymentPolicyConfig) {}

  /**
   * Intent 타입과 Provider 조합 검증 (강화 버전)
   */
  validateIntentProvider(
    intentType: PaymentIntentType,
    provider: PaymentProvider,
    hasStoredProfile: boolean,
    hasEphemeralInstrument: boolean,
    amount?: number,
  ): void {
    const policy = this.config.payments.typePolicy[intentType];
    const providerConfig = this.config.payments.providerConfig[provider];

    // 1. Intent Type 존재 여부 확인
    if (!policy) {
      throw new PolicyViolationError(
        `Unknown intent type: ${intentType}`,
        'policy.type.unknown',
        { intentType },
      );
    }

    // 2. Provider 존재 및 활성화 여부 확인
    if (!providerConfig) {
      throw new PolicyViolationError(
        `Unknown provider: ${provider}`,
        'policy.provider.unknown',
        { provider },
      );
    }

    if (!providerConfig.enabled) {
      throw new PolicyViolationError(
        `Provider ${provider} is currently disabled`,
        'policy.provider.disabled',
        { provider, enabled: false },
      );
    }

    // 3. Provider가 해당 Intent Type에 허용되는지 확인
    if (!policy.allowed.includes(provider)) {
      throw new PolicyViolationError(
        `Provider ${provider} not allowed for intent type ${intentType}`,
        'policy.provider.not.allowed',
        { intentType, provider, allowed: policy.allowed },
      );
    }

    // 4. 저장형 Profile 필수 여부 확인
    if (policy.requiresStoredProfile && !hasStoredProfile) {
      throw new PolicyViolationError(
        `Stored profile required for intent type ${intentType}`,
        'policy.profile.required',
        { intentType, requiresStoredProfile: true, hasStoredProfile },
      );
    }

    // 5. Ephemeral Instrument 허용 여부 확인
    if (!policy.allowsEphemeral && hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Ephemeral instruments not allowed for intent type ${intentType}`,
        'policy.ephemeral.not.allowed',
        { intentType, allowsEphemeral: false, hasEphemeralInstrument },
      );
    }

    // 6. Profile과 Instrument의 상호 배타적 관계 확인
    if (hasStoredProfile && hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Cannot use both stored profile and ephemeral instrument`,
        'policy.profile.instrument.conflict',
        { hasStoredProfile, hasEphemeralInstrument },
      );
    }

    // 7. 최소한 하나의 결제 수단이 있는지 확인
    if (!hasStoredProfile && !hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Either stored profile or ephemeral instrument is required`,
        'policy.payment.method.required',
        { hasStoredProfile, hasEphemeralInstrument },
      );
    }

    // 8. 하드가드: BNPL_CAPTURE는 반드시 CMS만 허용
    if (intentType === 'BNPL_CAPTURE' && provider !== 'CMS') {
      throw new PolicyViolationError(
        `BNPL_CAPTURE intent type requires CMS provider only`,
        'policy.bnpl.capture.cms.only',
        { intentType, provider, required: 'CMS' },
      );
    }

    // 9. 금액 검증 (선택적)
    if (amount !== undefined) {
      this.validateAmount(intentType, amount);
    }

    // 10. Provider별 특수 규칙 검증
    this.validateProviderSpecificRules(
      intentType,
      provider,
      hasStoredProfile,
      hasEphemeralInstrument,
    );
  }

  /**
   * Provider별 특수 규칙 검증
   */
  private validateProviderSpecificRules(
    intentType: PaymentIntentType,
    provider: PaymentProvider,
    hasStoredProfile: boolean,
    hasEphemeralInstrument: boolean,
  ): void {
    switch (provider) {
      case 'BNPL':
        // BNPL은 항상 저장형 Profile 필요
        if (!hasStoredProfile) {
          throw new PolicyViolationError(
            `BNPL provider requires stored profile for credit assessment`,
            'policy.bnpl.profile.required',
            { provider, hasStoredProfile },
          );
        }
        break;

      case 'CMS':
        // CMS는 항상 저장형 Profile 필요 (계좌 정보)
        if (!hasStoredProfile) {
          throw new PolicyViolationError(
            `CMS provider requires stored profile with bank account`,
            'policy.cms.profile.required',
            { provider, hasStoredProfile },
          );
        }
        break;

      case 'POINTS':
        // Points는 일반적으로 저장형 Profile 필요 (잔액 관리)
        if (!hasStoredProfile && intentType !== 'ORDER') {
          throw new PolicyViolationError(
            `Points provider requires stored profile for balance management`,
            'policy.points.profile.required',
            { provider, intentType, hasStoredProfile },
          );
        }
        break;

      case 'TOSS':
      case 'KAKAOPAY':
        // PG사들은 Ephemeral도 허용하지만, MEMBERSHIP_FEE는 저장형 필요
        if (intentType === 'MEMBERSHIP_FEE' && !hasStoredProfile) {
          throw new PolicyViolationError(
            `Recurring payments require stored profile`,
            'policy.recurring.profile.required',
            { provider, intentType, hasStoredProfile },
          );
        }
        break;
    }
  }

  /**
   * 결제 금액 검증
   */
  validateAmount(intentType: PaymentIntentType, amount: number): void {
    const policy = this.config.payments.typePolicy[intentType];

    if (!policy) {
      throw new PolicyViolationError(
        `Unknown intent type: ${intentType}`,
        'policy.type.unknown',
        { intentType },
      );
    }

    if (amount < policy.minAmount) {
      throw new PolicyViolationError(
        `Amount ${amount} is below minimum ${policy.minAmount} for ${intentType}`,
        'policy.amount.too.low',
        { intentType, amount, minAmount: policy.minAmount },
      );
    }

    if (amount > policy.maxAmount) {
      throw new PolicyViolationError(
        `Amount ${amount} exceeds maximum ${policy.maxAmount} for ${intentType}`,
        'policy.amount.too.high',
        { intentType, amount, maxAmount: policy.maxAmount },
      );
    }
  }

  /**
   * Provider 활성화 상태 확인
   */
  validateProviderEnabled(provider: PaymentProvider): void {
    const config = this.config.payments.providerConfig[provider];

    if (!config) {
      throw new PolicyViolationError(
        `Unknown provider: ${provider}`,
        'policy.provider.unknown',
        { provider },
      );
    }

    if (!config.enabled) {
      throw new PolicyViolationError(
        `Provider ${provider} is currently disabled`,
        'policy.provider.disabled',
        { provider },
      );
    }
  }

  /**
   * 환불 정책 검증
   */
  validateRefundPolicy(
    originalAmount: number,
    refundAmount: number,
    reason?: string,
  ): void {
    const refundPolicy = this.config.refunds.policy;

    // 환불 비율 확인
    const refundRatio = refundAmount / originalAmount;
    if (refundRatio > this.config.payments.validation.maxRefundRatio) {
      throw new PolicyViolationError(
        `Refund amount ${refundAmount} exceeds maximum ratio for original amount ${originalAmount}`,
        'policy.refund.ratio.exceeded',
        {
          originalAmount,
          refundAmount,
          maxRatio: this.config.payments.validation.maxRefundRatio,
        },
      );
    }

    // 환불 사유 확인
    if (reason && !refundPolicy.allowedReasons.includes(reason)) {
      throw new PolicyViolationError(
        `Invalid refund reason: ${reason}`,
        'policy.refund.reason.invalid',
        { reason, allowedReasons: refundPolicy.allowedReasons },
      );
    }

    // 자동 승인 한도 확인
    if (
      refundAmount > refundPolicy.autoApprovalLimit &&
      refundPolicy.requiresManualApproval
    ) {
      throw new PolicyViolationError(
        `Refund amount ${refundAmount} requires manual approval`,
        'policy.refund.manual.approval.required',
        { refundAmount, autoApprovalLimit: refundPolicy.autoApprovalLimit },
      );
    }
  }

  /**
   * 허용된 Provider 목록 반환
   */
  getAllowedProviders(intentType: PaymentIntentType): PaymentProvider[] {
    const policy = this.config.payments.typePolicy[intentType];
    return policy ? policy.allowed : [];
  }

  /**
   * Provider 설정 반환
   */
  getProviderConfig(provider: PaymentProvider): ProviderConfig | undefined {
    return this.config.payments.providerConfig[provider];
  }

  /**
   * 특정 Intent Type에 대해 사용 가능한 Provider들을 반환 (활성화된 것만)
   */
  getAvailableProviders(intentType: PaymentIntentType): PaymentProvider[] {
    const policy = this.config.payments.typePolicy[intentType];
    if (!policy) return [];

    return policy.allowed.filter((provider) => {
      const config = this.config.payments.providerConfig[provider];
      return config && config.enabled;
    });
  }

  /**
   * Provider가 특정 결제 방식을 지원하는지 확인
   */
  supportsPaymentMethod(provider: PaymentProvider, method: string): boolean {
    const config = this.config.payments.providerConfig[provider];
    return config ? config.supportedMethods.includes(method) : false;
  }

  /**
   * 정책 검증 결과를 요약해서 반환
   */
  validateAndSummarize(
    intentType: PaymentIntentType,
    provider: PaymentProvider,
    hasStoredProfile: boolean,
    hasEphemeralInstrument: boolean,
    amount?: number,
  ): {
    valid: boolean;
    errors: string[];
    warnings: string[];
    recommendations: string[];
  } {
    const result = {
      valid: true,
      errors: [] as string[],
      warnings: [] as string[],
      recommendations: [] as string[],
    };

    try {
      this.validateIntentProvider(
        intentType,
        provider,
        hasStoredProfile,
        hasEphemeralInstrument,
        amount,
      );
    } catch (error) {
      if (error instanceof PolicyViolationError) {
        result.valid = false;
        result.errors.push(error.message);
      } else {
        result.valid = false;
        result.errors.push('Unknown validation error');
      }
    }

    // 경고 및 권장사항 추가
    const policy = this.config.payments.typePolicy[intentType];
    const providerConfig = this.config.payments.providerConfig[provider];

    if (policy && providerConfig) {
      // 경고: 높은 금액에 대한 권장사항
      if (amount && amount > policy.maxAmount * 0.8) {
        result.warnings.push(
          `Amount ${amount} is close to maximum limit ${policy.maxAmount}`,
        );
      }

      // 권장사항: Ephemeral vs Stored Profile
      if (hasEphemeralInstrument && policy.requiresStoredProfile) {
        result.recommendations.push(
          'Consider using stored profile for better user experience',
        );
      }

      // 권장사항: Provider 선택
      if (
        intentType === 'ORDER' &&
        provider === 'BNPL' &&
        amount &&
        amount < 50000
      ) {
        result.recommendations.push(
          'Consider using PG providers for small amounts instead of BNPL',
        );
      }
    }

    return result;
  }

  /**
   * 정책 설정을 JSON으로 내보내기 (디버깅/모니터링용)
   */
  exportPolicyConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Intent Type별 통계 정보 반환
   */
  getPolicyStats(): Record<
    PaymentIntentType,
    {
      allowedProviders: number;
      enabledProviders: number;
      requiresProfile: boolean;
      allowsEphemeral: boolean;
      amountRange: { min: number; max: number };
    }
  > {
    const stats = {} as any;

    Object.entries(this.config.payments.typePolicy).forEach(
      ([type, policy]) => {
        const intentType = type as PaymentIntentType;
        const enabledProviders = policy.allowed.filter((provider) => {
          const config = this.config.payments.providerConfig[provider];
          return config && config.enabled;
        });

        stats[intentType] = {
          allowedProviders: policy.allowed.length,
          enabledProviders: enabledProviders.length,
          requiresProfile: policy.requiresStoredProfile,
          allowsEphemeral: policy.allowsEphemeral,
          amountRange: {
            min: policy.minAmount,
            max: policy.maxAmount,
          },
        };
      },
    );

    return stats;
  }
}

/**
 * 기본 정책 설정 (fallback)
 */
export const DEFAULT_PAYMENT_POLICY: PaymentPolicyConfig = {
  payments: {
    typePolicy: {
      ORDER: {
        description: '일반 주문 결제',
        allowed: ['TOSS', 'KAKAOPAY', 'BNPL', 'POINTS'],
        requiresStoredProfile: false,
        allowsEphemeral: true,
        maxAmount: 10000000,
        minAmount: 100,
      },
      BNPL_CAPTURE: {
        description: 'BNPL 월말 캡처 (CMS 전용)',
        allowed: ['CMS'],
        requiresStoredProfile: true,
        allowsEphemeral: false,
        maxAmount: 5000000,
        minAmount: 1000,
      },
      MEMBERSHIP_FEE: {
        description: '멤버십 정기결제',
        allowed: ['TOSS', 'BNPL'],
        requiresStoredProfile: true,
        allowsEphemeral: false,
        maxAmount: 1000000,
        minAmount: 10000,
      },
    },
    providerConfig: {
      TOSS: {
        enabled: true,
        supportedMethods: ['card', 'bank_transfer'],
        maxRetries: 3,
        timeoutMs: 30000,
      },
      KAKAOPAY: {
        enabled: true,
        supportedMethods: ['wallet'],
        maxRetries: 2,
        timeoutMs: 25000,
      },
      CMS: {
        enabled: true,
        supportedMethods: ['bank_account'],
        maxRetries: 1,
        timeoutMs: 60000,
      },
      BNPL: {
        enabled: true,
        supportedMethods: ['credit_limit'],
        maxRetries: 2,
        timeoutMs: 15000,
      },
      POINTS: {
        enabled: true,
        supportedMethods: ['balance'],
        maxRetries: 1,
        timeoutMs: 5000,
      },
    },
    validation: {
      idempotencyKeyTtlHours: 24,
      sessionExpiryMinutes: 30,
      maxRefundRatio: 1.0,
      allowPartialRefund: true,
    },
    security: {
      maskCardNumber: true,
      logSensitiveData: false,
      requireTlsForWebhooks: true,
    },
  },
  refunds: {
    policy: {
      autoApprovalLimit: 100000,
      requiresManualApproval: true,
      maxRefundDays: 30,
      allowedReasons: [
        'customer_request',
        'order_cancelled',
        'product_defect',
        'system_error',
      ],
    },
  },
};

/**
 * 정책 설정 로더 (환경변수/파일에서 로드)
 */
export function loadPaymentPolicy(): PaymentPolicyConfig {
  // 실제 구현에서는 환경변수나 설정 파일에서 로드
  // 예: JSON.parse(process.env.PAYMENT_POLICY || '{}')
  return DEFAULT_PAYMENT_POLICY;
}
