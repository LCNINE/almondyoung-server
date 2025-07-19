/**
 * 개선된 ID 타입 전략 (기존 시스템 호환)
 * 
 * 원칙:
 * 1. 기존 number ID는 유지 (성능상 이유)
 * 2. 새로운 기능은 string ID 사용 (보안상 이유)
 * 3. 점진적 마이그레이션 지원
 */

import { ulid } from 'ulid';

// ===== 기존 시스템 (number) =====
export type LegacyUserId = number;      // 기존 사용자 ID
export type InvoiceId = string;         // 인보이스 ID (string으로 통일)
export type TransactionId = number;     // 거래 ID (성능상 number 유지)

// ===== 새로운 시스템 (string) =====
export type UserId = string;            // 새 사용자 ID
export type PaymentMethodId = string;   // 결제 수단 ID
export type BnplAccountId = string;     // BNPL 계정 ID
export type PaymentEventId = string;    // 결제 이벤트 ID
export type RefundEventId = string;     // 환불 이벤트 ID

// ===== 호환성 타입 =====
export type CompatibleUserId = UserId | LegacyUserId;

/**
 * 스마트 ID 생성기
 */
export class SmartIdGenerator {
  /**
   * 사용자 ID 생성 (새 형식)
   */
  static newUserId(): UserId {
    return `user_${ulid()}`;
  }

  /**
   * 결제 수단 ID 생성
   */
  static paymentMethodId(): PaymentMethodId {
    return `pm_${ulid()}`;
  }

  /**
   * BNPL 계정 ID 생성
   */
  static bnplAccountId(): BnplAccountId {
    return `bnpl_${ulid()}`;
  }

  /**
   * 결제 이벤트 ID 생성
   */
  static paymentEventId(): PaymentEventId {
    return `pe_${ulid()}`;
  }

  /**
   * 환불 이벤트 ID 생성
   */
  static refundEventId(): RefundEventId {
    return `re_${ulid()}`;
  }
}

/**
 * ID 유틸리티
 */
export class IdUtils {
  /**
   * 사용자 ID 정규화 (레거시 지원)
   */
  static normalizeUserId(id: CompatibleUserId): string {
    if (typeof id === 'number') {
      return `legacy_user_${id}`;
    }
    return id;
  }

  /**
   * 레거시 사용자 ID 추출
   */
  static extractLegacyUserId(id: string): number | null {
    const match = id.match(/^legacy_user_(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * ID 타입 확인
   */
  static isLegacyUserId(id: CompatibleUserId): id is LegacyUserId {
    return typeof id === 'number';
  }

  static isNewUserId(id: CompatibleUserId): id is UserId {
    return typeof id === 'string' && !id.startsWith('legacy_');
  }

  /**
   * ID 검증
   */
  static validateUserId(id: string): boolean {
    return /^user_[0-9A-HJKMNP-TV-Z]{26}$/.test(id) || 
           /^legacy_user_\d+$/.test(id);
  }

  static validatePaymentMethodId(id: string): boolean {
    return /^pm_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
  }

  static validateBnplAccountId(id: string): boolean {
    return /^bnpl_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
  }
}

/**
 * 타입 가드
 */
export const TypeGuards = {
  isUserId: (id: any): id is UserId => 
    typeof id === 'string' && IdUtils.validateUserId(id),
    
  isPaymentMethodId: (id: any): id is PaymentMethodId => 
    typeof id === 'string' && IdUtils.validatePaymentMethodId(id),
    
  isBnplAccountId: (id: any): id is BnplAccountId => 
    typeof id === 'string' && IdUtils.validateBnplAccountId(id),
    
  isInvoiceId: (id: any): id is InvoiceId => 
    typeof id === 'string' && id.length > 0,
};