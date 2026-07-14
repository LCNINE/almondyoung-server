/**
 * User Domain Stream Configuration
 * 
 * 사용자 도메인 이벤트 스트림 정의
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payload 타입 정의 =====

export interface UserCreatedPayload {
  userId: string;
  email: string;
  name: string;
}

export interface UserVerificationPayload {
  userId: string;
  email: string;
  name: string;
  verificationToken: string;
  callbackUrl: string;
  redirectTo: string;
}

export interface UserEmailVerifiedPayload {
  userId: string;
  email: string;
  name: string;
}

/** 이메일로 6자리 인증 코드(OTP) 발송 요청 — 문자 대신 이메일로 코드 받기 */
export interface UserVerificationCodePayload {
  userId: string;
  email: string;
  name: string;
  code: string;
}

/** 비밀번호 변경 완료 알림 (넷플릭스식 보안 알림 메일 트리거) */
export interface UserPasswordChangedPayload {
  userId: string;
  email: string;
  name: string;
  /** 계정 페이지 링크 (메일 내 "계정 페이지" 버튼) */
  accountUrl: string;
}

export interface UserUpdatedAddressPayload {
  address_1: string;
  address_2?: string;
  city: string;
  country_code: string;
  postal_code: string;
  province?: string;
  is_default_shipping?: boolean;
}

export interface UserUpdatedPayload {
  userId: string;
  /** 이메일 변경 시에만 포함 (예: cafe24 이메일 이관). Medusa customer email 동기화 트리거. */
  email?: string;
  username?: string;
  nickname?: string;
  phoneNumber?: string;
  birthDate?: string;
  profileImageUrl?: string;
  address?: UserUpdatedAddressPayload | null;
}

export interface UserDeletedPayload {
  userId: string;
}

export interface UserDormantConvertedPayload {
  userId: string;
  email: string;
  convertedAt: string; // ISO 8601
}

export interface UserPermanentDeletedPayload {
  userId: string;
  deletedAt: string; // ISO 8601
}

export interface UserFindIdPayload {
  phoneNumber: string;
  loginId: string;
}

export interface UserResetPasswordPayload {
  phoneNumber: string;
}

export interface BusinessLicenseApprovedPayload {
  userId: string;
  email: string;
  name: string;
}

export interface Cafe24LinkedPayload {
  userId: string;
  cafe24MemberId: string;
  mallId: string;
  email: string;
  linkedAt: string; // ISO 8601
}

export interface Cafe24UnlinkedPayload {
  userId: string;
  cafe24MemberId: string;
  mallId: string;
  email: string;
  unlinkedAt: string; // ISO 8601
}

export interface SocialIdentityLinkedPayload {
  userId: string;
  provider: 'kakao' | 'naver' | 'google';
  linkedAt: string; // ISO 8601
}

export interface SocialIdentityUnlinkedPayload {
  userId: string;
  provider: 'kakao' | 'naver' | 'google';
  unlinkedAt: string; // ISO 8601
}

// ===== Zod 스키마 정의 =====

const UserCreatedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});

const UserVerificationSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  verificationToken: z.string().min(1),
  callbackUrl: z.string().url(),
  redirectTo: z.string(),
});

const UserEmailVerifiedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});

const UserVerificationCodeSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  code: z.string().min(4).max(8),
});

const UserPasswordChangedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  accountUrl: z.string().url(),
});

const UserUpdatedAddressSchema = z.object({
  address_1: z.string().min(1),
  address_2: z.string().optional(),
  city: z.string().min(1),
  country_code: z.string().min(1),
  postal_code: z.string().min(1),
  province: z.string().optional(),
  is_default_shipping: z.boolean().optional(),
});

const UserUpdatedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  username: z.string().min(1).optional(),
  nickname: z.string().optional(),
  phoneNumber: z.string().optional(),
  birthDate: z.string().optional(),
  profileImageUrl: z.string().optional(),
  address: UserUpdatedAddressSchema.nullable().optional(),
});

const UserDeletedSchema = z.object({
  userId: z.string().min(1),
});

const UserDormantConvertedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  convertedAt: z.string().datetime(),
});

const UserPermanentDeletedSchema = z.object({
  userId: z.string().min(1),
  deletedAt: z.string().datetime(),
});

const UserFindIdSchema = z.object({
  phoneNumber: z.string().min(1),
  loginId: z.string().min(1),
});

const UserResetPasswordSchema = z.object({
  phoneNumber: z.string().min(1),
});

const BusinessLicenseApprovedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
});

const Cafe24LinkedSchema = z.object({
  userId: z.string().min(1),
  cafe24MemberId: z.string().min(1),
  mallId: z.string().min(1),
  email: z.string().email(),
  linkedAt: z.string().datetime(),
});

const Cafe24UnlinkedSchema = z.object({
  userId: z.string().min(1),
  cafe24MemberId: z.string().min(1),
  mallId: z.string().min(1),
  email: z.string().email(),
  unlinkedAt: z.string().datetime(),
});

const SocialIdentityLinkedSchema = z.object({
  userId: z.string().min(1),
  provider: z.enum(['kakao', 'naver', 'google']),
  linkedAt: z.string().datetime(),
});

const SocialIdentityUnlinkedSchema = z.object({
  userId: z.string().min(1),
  provider: z.enum(['kakao', 'naver', 'google']),
  unlinkedAt: z.string().datetime(),
});

// ===== Stream Config (타입 안전 버전) =====

export const USER_STREAM = stream({
  topic: 'users.events.v1',
  partitions: 6,
  aggregateType: 'User',
  events: {
    UserCreated: event<'UserCreated', UserCreatedPayload>('UserCreated', UserCreatedSchema),
    UserVerification: event<'UserVerification', UserVerificationPayload>('UserVerification', UserVerificationSchema),
    UserEmailVerified: event<'UserEmailVerified', UserEmailVerifiedPayload>('UserEmailVerified', UserEmailVerifiedSchema),
    UserVerificationCode: event<'UserVerificationCode', UserVerificationCodePayload>(
      'UserVerificationCode',
      UserVerificationCodeSchema,
    ),
    UserPasswordChanged: event<'UserPasswordChanged', UserPasswordChangedPayload>(
      'UserPasswordChanged',
      UserPasswordChangedSchema,
    ),
    UserUpdated: event<'UserUpdated', UserUpdatedPayload>('UserUpdated', UserUpdatedSchema),
    UserDeleted: event<'UserDeleted', UserDeletedPayload>('UserDeleted', UserDeletedSchema),
    UserDormantConverted: event<'UserDormantConverted', UserDormantConvertedPayload>('UserDormantConverted', UserDormantConvertedSchema),
    UserPermanentDeleted: event<'UserPermanentDeleted', UserPermanentDeletedPayload>('UserPermanentDeleted', UserPermanentDeletedSchema),
    UserFindId: event<'UserFindId', UserFindIdPayload>('UserFindId', UserFindIdSchema),
    UserResetPassword: event<'UserResetPassword', UserResetPasswordPayload>('UserResetPassword', UserResetPasswordSchema),
    BusinessLicenseApproved: event<'BusinessLicenseApproved', BusinessLicenseApprovedPayload>('BusinessLicenseApproved', BusinessLicenseApprovedSchema),
    Cafe24Linked: event<'Cafe24Linked', Cafe24LinkedPayload>('Cafe24Linked', Cafe24LinkedSchema),
    Cafe24Unlinked: event<'Cafe24Unlinked', Cafe24UnlinkedPayload>('Cafe24Unlinked', Cafe24UnlinkedSchema),
    SocialIdentityLinked: event<'SocialIdentityLinked', SocialIdentityLinkedPayload>('SocialIdentityLinked', SocialIdentityLinkedSchema),
    SocialIdentityUnlinked: event<'SocialIdentityUnlinked', SocialIdentityUnlinkedPayload>('SocialIdentityUnlinked', SocialIdentityUnlinkedSchema),
  },
});

// ===== 타입 추론 =====

export type UserEvents = typeof USER_STREAM.events;

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const USER_EVENTS = {
  USER_PERMANENT_DELETED: {
    topic: USER_STREAM.topic.topic,
    messageType: 'UserPermanentDeleted' as const,
  },
} as const;
