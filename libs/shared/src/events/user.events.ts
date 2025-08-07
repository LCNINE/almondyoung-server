import { BaseEventPayload, EventDefinition } from '../../../../libs/events/src';

export interface UserCreatedPayload extends BaseEventPayload {
  userId: string;
  email: string;
  name: string;
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
  DORMANT_ACCOUNT_CONVERTED: {
    topic: 'user.dormant.converted',
    payload: {} as UserDormantConvertedPayload,
  },
} as const satisfies Record<string, EventDefinition>;

export type UserEvents = typeof USER_EVENTS;
