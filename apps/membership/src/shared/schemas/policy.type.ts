import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import * as schema from './entities/schema';

// DB 스키마에서 추론한 기본 정책 타입
export type Policy = InferSelectModel<typeof schema.subscriptionPolicies>;
export type NewPolicy = InferInsertModel<typeof schema.subscriptionPolicies>;

// API 응답에서 사용될 정책 정보 타입
export interface PolicyResponse {
  id: string;
  ruleType: string;
  ruleValue: Record<string, any>;
  tierId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// 정책 목록 API 응답 타입
export interface PolicyListResponse {
  policies: Policy[]; // 또는 PolicyResponse[]
  total: number;
  page: number;
  limit: number;
}

// 정책 검증 시 서비스에 전달될 컨텍스트 데이터 타입
export type PolicyValidationContext = {
  userId: string;
  tierId?: string;
  // 각 action에 따라 필요한 추가 데이터
  pauseCount?: number; // 예: 'PAUSE_SUBSCRIPTION' 액션 시 필요
  pauseStartDate?: string;
  pauseEndDate?: string;
  // ... 기타 필요한 컨텍스트 데이터
};
