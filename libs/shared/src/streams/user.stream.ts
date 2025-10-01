/**
 * User Domain Stream Configuration
 * 
 * 사용자 도메인 이벤트 스트림 정의
 */

import { StreamConfig, EventType } from '@app/events';
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

// ===== Event Types Map =====

export type UserEvents = {
  UserCreated: EventType<UserCreatedPayload>;
  UserVerification: EventType<UserVerificationPayload>;
  UserUpdated: EventType<UserUpdatedPayload>;
  UserDeleted: EventType<UserDeletedPayload>;
  UserDormantConverted: EventType<UserDormantConvertedPayload>;
  UserPermanentDeleted: EventType<UserPermanentDeletedPayload>;
  UserFindId: EventType<UserFindIdPayload>;
  UserResetPassword: EventType<UserResetPasswordPayload>;
};

// ===== Stream Config =====

export const USER_STREAM: StreamConfig<UserEvents> = {
  topic: {
    topic: 'users.events.v1',
    partitions: 6,
  },
  aggregateType: 'User',
  events: {
    UserCreated: {
      messageType: 'UserCreated',
      payloadType: {} as UserCreatedPayload,
      schema: UserCreatedSchema,
    },
    UserVerification: {
      messageType: 'UserVerification',
      payloadType: {} as UserVerificationPayload,
      schema: UserVerificationSchema,
    },
    UserUpdated: {
      messageType: 'UserUpdated',
      payloadType: {} as UserUpdatedPayload,
      schema: UserUpdatedSchema,
    },
    UserDeleted: {
      messageType: 'UserDeleted',
      payloadType: {} as UserDeletedPayload,
      schema: UserDeletedSchema,
    },
    UserDormantConverted: {
      messageType: 'UserDormantConverted',
      payloadType: {} as UserDormantConvertedPayload,
      schema: UserDormantConvertedSchema,
    },
    UserPermanentDeleted: {
      messageType: 'UserPermanentDeleted',
      payloadType: {} as UserPermanentDeletedPayload,
      schema: UserPermanentDeletedSchema,
    },
    UserFindId: {
      messageType: 'UserFindId',
      payloadType: {} as UserFindIdPayload,
      schema: UserFindIdSchema,
    },
    UserResetPassword: {
      messageType: 'UserResetPassword',
      payloadType: {} as UserResetPasswordPayload,
      schema: UserResetPasswordSchema,
    },
  },
};

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const USER_EVENTS = {
  USER_PERMANENT_DELETED: { topic: USER_STREAM.topic.topic },
} as const;

