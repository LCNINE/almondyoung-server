/**
 * 정책 검증 DTO
 * 정책 검증 관련 데이터 전송 객체들
 */

// Additional validation DTOs
export interface PolicyComplianceCheckDto {
  userId: string;
  policyIds: string[];
  context: Record<string, any>;
}

export interface ViolationQueryDto {
  userId?: string;
  policyId?: string;
  violationType?: string;
  startDate?: string;
  endDate?: string;
  isResolved?: boolean;
  page?: number;
  limit?: number;
}

export interface StatisticsQueryDto {
  startDate?: string;
  endDate?: string;
  ruleType?: string;
  tierId?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface DashboardQueryDto {
  timeRange?: '24h' | '7d' | '30d' | '90d';
  includeMetrics?: string[];
}

export interface AnalyticsQueryDto {
  policyId?: string;
  startDate: string;
  endDate: string;
  metrics: string[];
}

// Specialized validation DTOs for specific policy types
export interface PausePolicyValidationDto {
  userId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface PlanChangePolicyValidationDto {
  userId: string;
  currentPlanId: string;
  newPlanId: string;
  changeType: 'UPGRADE' | 'DOWNGRADE';
}

export interface TierPolicyValidationDto {
  userId: string;
  tierId: string;
  action: string;
  metadata?: Record<string, any>;
}
