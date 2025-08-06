import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';
import { User } from './types';
import { TierInfo } from './plan.type';
import { POLICY_RULE_TYPES } from './requests';

export type SubscriptionPolicy = InferSelectModel<
  typeof schema.subscriptionPolicies
>;
export type NewSubscriptionPolicy = InferInsertModel<
  typeof schema.subscriptionPolicies
>;

// ====== 정책 관련 핵심 타입 ======

/**
 * 정책 검증 결과 - Guard에서 Request에 첨부되는 타입
 */
export interface PolicyCheckResult {
  allowed: boolean;
  policy: SubscriptionPolicy | null;
  validation: PolicyValidationDetails;
  metadata: PolicyMetadata;
}

/**
 * 정책 검증 세부 정보
 */
export interface PolicyValidationDetails {
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  appliedPolicies: AppliedPolicy[];
}

/**
 * 정책 메타데이터 - 컨트롤러에서 활용할 수 있는 추가 정보
 */
export interface PolicyMetadata {
  executionTime: number;
  remainingQuota?: {
    remainingPauses?: number;
    remainingChanges?: number;
    [key: string]: number | undefined;
  };
  context?: Record<string, any>;
}

/**
 * Express Request 확장 - PolicyGuard가 첨부하는 정보
 */
export interface RequestWithPolicy extends Request {
  user: User; // 인증된 사용자 정보
  policyResult: PolicyCheckResult; // PolicyGuard가 첨부하는 정책 검증 결과
}

/**
 * PolicyGuard에서 설정하는 정책 검증 컨텍스트
 */
export interface PolicyValidationContext {
  isValid: boolean;
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  appliedPolicies: AppliedPolicy[];
  executionTime: number;
  remainingQuota?: {
    remainingPauses?: number;
    remainingChanges?: number;
    [key: string]: number | undefined;
  };
}

/**
 * Express Request 확장 - 새로운 PolicyGuard가 첨부하는 정보
 */
export interface RequestWithPolicyValidation extends Request {
  user?: User; // 인증된 사용자 정보 (선택사항)
  policyValidation?: PolicyValidationContext; // PolicyGuard가 첨부하는 정책 검증 결과
}

/**
 * 정책 위반 정보
 */
export interface PolicyViolation {
  policyId: string;
  policyName: string;
  ruleType: string;
  violationType: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  suggestedAction?: string;
}

/**
 * 정책 경고 정보
 */
export interface PolicyWarning {
  policyId: string;
  policyName: string;
  message: string;
  suggestedAction?: string;
}

/**
 * 적용된 정책 정보
 */
export interface AppliedPolicy {
  policyId: string;
  policyName: string;
  ruleType: string;
  appliedValue: any;
  context: Record<string, any>;
}

/**
 * 정책 검증 결과
 */
export interface PolicyValidationResult {
  isValid: boolean;
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  appliedPolicies: AppliedPolicy[];
  executionTime: number;
}

/**
 * PolicyCheck 데코레이터 옵션
 */
export interface PolicyCheckOptions {
  requiresPayment?: boolean;
  tierSpecific?: boolean;
  warningOnly?: boolean;
  additionalContext?: Record<string, any>;
}

export interface ResumePolicyCheckResult extends PolicyCheckResult {
  metadata: PolicyMetadata & {
    resumePolicy?: {
      canResume: boolean;
      currentPauseId?: string;
      pauseStartDate?: string;
      plannedEndDate?: string;
    };
  };
}

export type Policy = SubscriptionPolicy & {
  // 추가 필드가 필요하면 여기에 정의
};

/**
 * 정책 컨텍스트 (사용자 정보 포함)
 */
export interface PolicyContext {
  userId: string;
  tierId?: string;
  subscriptionId?: string;
  currentYear: number;
  currentDate?: string;
  userMetadata?: Record<string, any>;
  [key: string]: any;
}

/**
 * 정책 응답 타입 (API에서 반환되는 정책 정보)
 */
export interface PolicyResponse {
  id: string;
  ruleType: (typeof POLICY_RULE_TYPES)[number];
  ruleValue: Record<string, any>;
  tierId?: string;
  tierInfo?: TierInfo;
  isActive: boolean;
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 적용 가능한 정책 정보
 */
export interface ApplicablePolicy {
  policy: PolicyResponse;
  isApplicable: boolean;
  priority: number;
}

/**
 * 정책 엔진 실행 결과
 */
export interface PolicyEngineResult {
  decision: 'ALLOW' | 'DENY' | 'WARNING';
  policies: AppliedPolicy[];
  violations?: PolicyViolation[];
  warnings?: PolicyWarning[];
  metadata: {
    executionTime: number;
    reason?: string;
    [key: string]: any;
  };
}

// =================================================================
// 정책 관리 서비스 관련 타입들 (PolicyManagementService용)
// =================================================================

/**
 * 정책 조회 쿼리 파라미터
 */

/**
 * 정책 목록 응답 타입
 */
export interface PolicyListResponse {
  policies: PolicyResponse[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 정책 생성 요청 타입
 */

/**
 * 정책 업데이트 요청 타입


/**
 * 정책 버전 정보
 */
export interface PolicyVersion {
  id: string;
  version: number;
  ruleValue: Record<string, any>;
  changeReason?: string;
  changedBy?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 정책 버전 비교 결과
 */
export interface PolicyVersionComparison {
  policyId: string;
  version1: PolicyVersion;
  version2: PolicyVersion;
  differences: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}
