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

export interface UserUpdatedPayload {
  userId: string;
  email?: string;
  name?: string;
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
  email: string;
  loginId: string;
}

export interface UserResetPasswordPayload {
  email: string;
  verificationToken: string;
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

const UserUpdatedSchema = z.object({
  userId: z.string().min(1),
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
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
  email: z.string().email(),
  loginId: z.string().min(1),
});

const UserResetPasswordSchema = z.object({
  email: z.string().email(),
  verificationToken: z.string().min(1),
});

// ===== Stream Config (타입 안전 버전) =====

export const USER_STREAM = stream({
  topic: 'users.events.v1',
  partitions: 6,
  aggregateType: 'User',
  events: {
    UserCreated: event<'UserCreated', UserCreatedPayload>('UserCreated', UserCreatedSchema),
    UserVerification: event<'UserVerification', UserVerificationPayload>('UserVerification', UserVerificationSchema),
    UserEmailVerified: event<'UserEmailVerified', UserEmailVerifiedPayload>('UserEmailVerified', UserVerificationSchema),
    UserUpdated: event<'UserUpdated', UserUpdatedPayload>('UserUpdated', UserUpdatedSchema),
    UserDeleted: event<'UserDeleted', UserDeletedPayload>('UserDeleted', UserDeletedSchema),
    UserDormantConverted: event<'UserDormantConverted', UserDormantConvertedPayload>('UserDormantConverted', UserDormantConvertedSchema),
    UserPermanentDeleted: event<'UserPermanentDeleted', UserPermanentDeletedPayload>('UserPermanentDeleted', UserPermanentDeletedSchema),
    UserFindId: event<'UserFindId', UserFindIdPayload>('UserFindId', UserFindIdSchema),
    UserResetPassword: event<'UserResetPassword', UserResetPasswordPayload>('UserResetPassword', UserResetPasswordSchema),
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

