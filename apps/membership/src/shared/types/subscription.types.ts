/**
 * 티어 정보 인터페이스
 */
export interface TierInfo {
  id: string;
  code: string;
  name: string;
  priorityLevel: number;
}

/**
 * 플랜 정보 인터페이스
 */
export interface PlanInfo {
  id: string;
  price: number;
  durationDays: number;
  currency: string;
  trialDays?: number;
}

/**
 * 현재 구독 응답 인터페이스
 */
export interface CurrentSubscriptionResponse {
  id: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
  currentTier: TierInfo;
  plan: PlanInfo;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt?: string | null;
}

/**
 * 구독 이력 아이템 인터페이스
 */
export interface SubscriptionHistoryItem {
  id: string;
  planId: string;
  tierCode: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
  startedAt: string;
  endedAt?: string | null;
  changeType: 'UPGRADE' | 'DOWNGRADE' | 'RENEWAL' | 'INITIAL';
}

/**
 * 일시정지 이력 아이템 인터페이스
 */
export interface PauseHistoryItem {
  id: string;
  startsAt: string;
  endsAt: string;
  actualResumedAt?: string | null;
  status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
  createdAt: string;
}

/**
 * 일시정지 자격 확인 결과
 */
export interface PauseEligibilityResult {
  eligible: boolean;
  currentUsage: number;
  maxPauses: number;
  remainingPauses: number;
}

/**
 * 구독 이벤트 페이로드
 */
export interface SubscriptionEventPayload {
  eventId: string;
  eventType: string;
  userId: string;
  subscriptionId: string;
  payload: Record<string, any>;
}

/**
 * 사용자 권한 정보
 */
export interface UserRights {
  userId: string;
  tierId: string;
  tierCode: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  isPaused: boolean;
  pausedAt?: string | null;
}

/**
 * 벌크 구독 확인 요청
 */
export interface BulkSubscriptionCheckRequest {
  userIds: string[];
}

/**
 * 벌크 구독 확인 응답
 */
export interface BulkSubscriptionCheckResponse {
  [userId: string]: {
    hasActiveSubscription: boolean;
    tierCode?: string;
    isPaused?: boolean;
    expiresAt?: string;
  };
}

/**
 * 감사 로그 아이템
 */
export interface AuditLogItem {
  id: string;
  action: string;
  userId: string;
  performedBy: string;
  details: Record<string, any>;
  timestamp: string;
}

/**
 * 정책 규칙 값
 */
export interface PolicyRuleValue {
  limit?: number;
  minDays?: number;
  maxDays?: number;
  [key: string]: any;
}