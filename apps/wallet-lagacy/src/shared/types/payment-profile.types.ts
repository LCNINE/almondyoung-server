// apps/wallet/src/shared/types/payment-profile.types.ts
// 단일 출처 원칙: schema.ts에서 자동 생성된 타입만 사용

import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from '../database/schema';

// ===============================
// 단일 출처: Schema 기반 타입들
// ===============================

/** 결제 프로필 (Select) */
export type PaymentProfile = InferSelectModel<typeof schema.paymentProfiles>;

/** 결제 프로필 (Insert) */
export type NewPaymentProfile = InferInsertModel<typeof schema.paymentProfiles>;

/** 결제 프로필 (Update) */
export type UpdatePaymentProfile = Partial<
  Omit<NewPaymentProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

/** HMS 카드 프로필 (Select) */
export type CmsCardProfile = InferSelectModel<typeof schema.cmsCardProfiles>;

/** HMS 카드 프로필 (Insert) */
export type NewCmsCardProfile = InferInsertModel<typeof schema.cmsCardProfiles>;

/** HMS 카드 프로필 (Update) */
export type UpdateCmsCardProfile = Partial<
  Omit<NewCmsCardProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

/** HMS 배치 프로필 (Select) */
export type CmsBatchProfile = InferSelectModel<typeof schema.cmsBatchProfiles>;

/** HMS 배치 프로필 (Insert) */
export type NewCmsBatchProfile = InferInsertModel<
  typeof schema.cmsBatchProfiles
>;

/** HMS 배치 프로필 (Update) */
export type UpdateCmsBatchProfile = Partial<
  Omit<NewCmsBatchProfile, 'id' | 'createdAt' | 'updatedAt'>
>;

// ===============================
// DTO 타입들 (공통 인터페이스 + 단일 출처)
// ===============================

/** 결제 프로필 생성 요청 DTO (실용적 접근) */
export interface PaymentProfileCreateV2RequestDto {
  userId: string;
  kind: PaymentProfile['kind']; // 단일 출처: schema에서 추론
  name?: string;

  // HMS 카드 필드 (kind === 'CARD'일 때만 사용)
  paymentNumber?: string;
  validUntil?: string; // MMYY
  password?: string;
  payerName?: string;
  payerNumber?: string;
  phone?: string;
  paymentCompany?: string;

  // HMS 배치 필드 (kind === 'BANK_ACCOUNT'일 때만 사용)
  accountNumber?: string;
  billingDay?: number;

  // 메타데이터
  metadata?: Record<string, any>;
}

/** 결제 프로필 응답 DTO */
export interface PaymentProfileV2ResponseDto {
  profileId: string;
  userId: string;
  kind: PaymentProfile['kind']; // 단일 출처
  status: PaymentProfile['status']; // 단일 출처
  name: string;
  memberId?: string; // HMS에서 생성된 ID
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

/** 결제 프로필 상태 업데이트 DTO */
export interface PaymentProfileStatusUpdateDto {
  status: PaymentProfile['status']; // 단일 출처
  reason?: string;
}

/** CMS 상태 업데이트 DTO (내부용) */
export interface CmsStatusUpdateDto {
  memberId: string;
  cmsStatus: CmsCardProfile['cmsStatus']; // 단일 출처
}
