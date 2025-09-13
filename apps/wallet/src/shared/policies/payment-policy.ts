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
  /**
   * 조건부 허용/주의사항(삼각형)
   * 예: ["사업자만 허용", "신용등급 B 이상"]
   */
  conditions?: string[];
  // ❌ maxAmount/minAmount는 하드가드 모듈로 이동
}

/**
 * Provider별 설정 인터페이스
 */
export interface ProviderConfig {
  enabled: boolean;
  // ❌ supportedMethods는 Provider Layer로 이동
  // ❌ maxRetries, timeoutMs는 인프라/연동 설정으로 이동
}

/**
 * 전체 결제 정책 인터페이스
 */
export interface PaymentPolicyConfig {
  payments: {
    typePolicy: Record<PaymentIntentType, PaymentTypePolicy>;
    providerConfig: Record<PaymentProvider, ProviderConfig>;
  };
  // ❌ validation/security 섹션은 시스템 설정/보안 모듈로 이동
  refunds: {
    policy: {
      allowedReasons: string[]; // 환불 사유만 유지
      // ❌ autoApprovalLimit/maxRefundDays는 환불 하드가드 모듈로 이동
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
 * 정책 검증 클래스
 */
export class PaymentPolicyValidator {
  constructor(private readonly config: PaymentPolicyConfig) {}

  validateIntentProvider(
    intentType: PaymentIntentType,
    provider: PaymentProvider,
    hasStoredProfile: boolean,
    hasEphemeralInstrument: boolean,
  ): void {
    const policy = this.config.payments.typePolicy[intentType];
    const providerConfig = this.config.payments.providerConfig[provider];

    if (!policy) {
      throw new PolicyViolationError(
        `Unknown intent type: ${intentType}`,
        'policy.type.unknown',
        { intentType },
      );
    }

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
        { provider },
      );
    }

    if (!policy.allowed.includes(provider)) {
      throw new PolicyViolationError(
        `Provider ${provider} not allowed for intent type ${intentType}`,
        'policy.provider.not.allowed',
        { intentType, provider, allowed: policy.allowed },
      );
    }

    if (policy.requiresStoredProfile && !hasStoredProfile) {
      throw new PolicyViolationError(
        `Stored profile required for intent type ${intentType}`,
        'policy.profile.required',
        { intentType, requiresStoredProfile: true, hasStoredProfile },
      );
    }

    if (!policy.allowsEphemeral && hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Ephemeral instruments not allowed for intent type ${intentType}`,
        'policy.ephemeral.not.allowed',
        { intentType, allowsEphemeral: false, hasEphemeralInstrument },
      );
    }

    if (hasStoredProfile && hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Cannot use both stored profile and ephemeral instrument`,
        'policy.profile.instrument.conflict',
        { hasStoredProfile, hasEphemeralInstrument },
      );
    }

    if (!hasStoredProfile && !hasEphemeralInstrument) {
      throw new PolicyViolationError(
        `Either stored profile or ephemeral instrument is required`,
        'policy.payment.method.required',
        { hasStoredProfile, hasEphemeralInstrument },
      );
    }
  }

  getAllowedProviders(intentType: PaymentIntentType): PaymentProvider[] {
    const policy = this.config.payments.typePolicy[intentType];
    return policy ? policy.allowed : [];
  }

  getProviderConfig(provider: PaymentProvider): ProviderConfig | undefined {
    return this.config.payments.providerConfig[provider];
  }
}

/**
 * 선언적 기본 정책 설정
 */
const TYPE_POLICY: Record<PaymentIntentType, PaymentTypePolicy> = {
  ORDER: {
    description: '일반 주문 결제',
    allowed: ['TOSS', 'KAKAOPAY', 'HMS_BNPL', 'HMS_CARD', 'POINTS'],
    requiresStoredProfile: false,
    allowsEphemeral: true,
  },
  BNPL_CAPTURE: {
    description: 'BNPL 월말 캡처 (CMS 전용)',
    allowed: ['HMS_BNPL'],
    requiresStoredProfile: true,
    allowsEphemeral: false,
  },
  MEMBERSHIP_FEE: {
    description: '멤버십 정기결제',
    allowed: ['HMS_CARD'],
    requiresStoredProfile: true,
    allowsEphemeral: false,
    conditions: ['사업자만 허용', '신용등급 B 이상'], // 삼각형 조건부 예시
  },
};

const PROVIDER_CONFIG: Record<PaymentProvider, ProviderConfig> = {
  TOSS: { enabled: true },
  KAKAOPAY: { enabled: true },
  HMS_CARD: { enabled: true },
  HMS_BNPL: { enabled: true },
  POINTS: { enabled: true },
};

export const DEFAULT_PAYMENT_POLICY: PaymentPolicyConfig = {
  payments: {
    typePolicy: TYPE_POLICY,
    providerConfig: PROVIDER_CONFIG,
  },
  refunds: {
    policy: {
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
  return DEFAULT_PAYMENT_POLICY;
}
