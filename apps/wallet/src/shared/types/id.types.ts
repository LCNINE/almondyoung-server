/**
 * ID 타입 정의 및 유틸리티
 * 
 * 설계 원칙:
 * 1. 모든 사용자 관련 ID는 string (UUID/ULID)
 * 2. 내부 시퀀스 ID는 number (성능상 이유)
 * 3. 외부 노출 ID는 string (보안상 이유)
 */

import { ulid } from 'ulid';
import { randomUUID } from 'crypto';

// 사용자 관련 ID 타입들
export type UserId = string;           // 사용자 고유 식별자
export type UserLoginId = string;      // 로그인 ID (이메일, 아이디 등)
export type PaymentMethodId = string;  // 결제 수단 ID
export type BnplAccountId = string;    // BNPL 계정 ID

// 내부 시퀀스 ID (DB 성능상 number 유지)
export type InvoiceId = number;        // 인보이스 ID (내부 시퀀스)
export type TransactionId = number;    // 거래 ID (내부 시퀀스)

// 이벤트 ID (추적 가능성을 위해 string)
export type EventId = string;          // 이벤트 ID
export type PaymentEventId = string;   // 결제 이벤트 ID
export type RefundEventId = string;    // 환불 이벤트 ID

/**
 * ID 생성 유틸리티
 */
export const IdGenerator = {
  /**
   * 사용자 ID 생성 (ULID 사용 - 시간순 정렬 가능)
   */
  userId(): UserId {
    return `user_${ulid()}`;
  },

  /**
   * 결제 수단 ID 생성
   */
  paymentMethodId(): PaymentMethodId {
    return `pm_${ulid()}`;
  },

  /**
   * BNPL 계정 ID 생성
   */
  bnplAccountId(): BnplAccountId {
    return `bnpl_${ulid()}`;
  },

  /**
   * 이벤트 ID 생성 (UUID 사용 - 완전 랜덤)
   */
  eventId(): EventId {
    return randomUUID();
  },

  /**
   * 결제 이벤트 ID 생성
   */
  paymentEventId(): PaymentEventId {
    return `pe_${ulid()}`;
  },

  /**
   * 환불 이벤트 ID 생성
   */
  refundEventId(): RefundEventId {
    return `re_${ulid()}`;
  },
};

/**
 * ID 검증 유틸리티
 */
export const IdValidator = {
  /**
   * 사용자 ID 형식 검증
   */
  isValidUserId(id: string): id is UserId {
    return /^user_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
  },

  /**
   * 결제 수단 ID 형식 검증
   */
  isValidPaymentMethodId(id: string): id is PaymentMethodId {
    return /^pm_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
  },

  /**
   * BNPL 계정 ID 형식 검증
   */
  isValidBnplAccountId(id: string): id is BnplAccountId {
    return /^bnpl_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
  },

  /**
   * 이벤트 ID 형식 검증 (UUID)
   */
  isValidEventId(id: string): id is EventId {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  },
};

/**
 * ID 파싱 유틸리티
 */
export const IdParser = {
  /**
   * 사용자 ID에서 ULID 부분 추출
   */
  extractUlid(id: UserId | PaymentMethodId | BnplAccountId): string {
    return id.split('_')[1] || '';
  },

  /**
   * ID에서 타입 접두사 추출
   */
  extractPrefix(id: string): string {
    return id.split('_')[0] || '';
  },

  /**
   * ULID에서 타임스탬프 추출
   */
  extractTimestamp(ulid: string): Date {
    // ULID의 첫 10자리는 타임스탬프
    const timestamp = ulid.substring(0, 10);
    const decoded = parseInt(timestamp, 32);
    return new Date(decoded);
  },
};

/**
 * 레거시 ID 변환 유틸리티 (마이그레이션용)
 */
export const LegacyIdConverter = {
  /**
   * 숫자 사용자 ID를 새 형식으로 변환
   */
  convertLegacyUserId(legacyId: number): UserId {
    // 기존 숫자 ID를 새 형식으로 변환 (마이그레이션 시 사용)
    return `user_legacy_${legacyId.toString().padStart(10, '0')}`;
  },

  /**
   * 새 형식 ID가 레거시인지 확인
   */
  isLegacyId(id: string): boolean {
    return id.includes('_legacy_');
  },

  /**
   * 레거시 ID에서 원본 숫자 추출
   */
  extractLegacyNumber(id: string): number | null {
    const match = id.match(/_legacy_(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  },
};