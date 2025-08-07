import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

export interface UserCreatedPayload extends BaseEventPayload {
  userId: string;
  email: string;
  name: string;
}

export interface UserVerification extends BaseEventPayload {
  userId: string;
  email: string;
  name: string;
  verificationToken: string;
}

export interface UserUpdatedPayload extends BaseEventPayload {
  userId: string;
  email?: string;
  name?: string;
}

export interface UserDeletedPayload extends BaseEventPayload {
  userId: string;
}

export interface UserDormantConvertedPayload extends BaseEventPayload {
  userId: string;
  email: string;
  convertedAt: Date;
}

export interface UserFindIdPayload extends BaseEventPayload {
  email: string;
  loginId: string;
}

export interface UserResetPasswordPayload extends BaseEventPayload {
  email: string;
  verificationToken: string;
}

export const USER_EVENTS = {
  USER_CREATED: {
    topic: 'user.created',
    payload: {} as UserCreatedPayload,
  },
  USER_UPDATED: {
    topic: 'user.updated',
    payload: {} as UserUpdatedPayload,
  },
  USER_DELETED: {
    topic: 'user.deleted',
    payload: {} as UserDeletedPayload,
  },
  USER_VERIFICATION: {
    topic: 'user.verification',
    payload: {} as UserVerification,
  },
  DORMANT_ACCOUNT_CONVERTED: {
    topic: 'user.dormant.converted',
    payload: {} as UserDormantConvertedPayload,
  },
  USER_FIND_ID: {
    topic: 'user.find.id',
    payload: {} as UserFindIdPayload,
  },
  USER_RESET_PASSWORD: {
    topic: 'user.reset.password',
    payload: {} as UserResetPasswordPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type UserEvents = typeof USER_EVENTS;
