// apps/notification/src/shared/utils/contact.utils.ts
import { Channel } from '../enums';

// User-service에서 가져오는 user profile 타입
export interface UserProfile {
  userId: string;
  email?: string;
  phoneNumber?: string;
  pushToken?: string;
  name?: string;
  [key: string]: any;
}

export const getContactForChannel = (userProfile: UserProfile, channel: Channel): string | null => {
  switch (channel) {
    case Channel.EMAIL:
      return userProfile.email || null;
    case Channel.SMS:
    case Channel.KAKAO:
      return userProfile.phoneNumber || null;
    case Channel.PUSH:
      return userProfile.pushToken || null;
    default:
      return null;
  }
};

export const validateContactForChannel = (contact: string, channel: Channel): boolean => {
  switch (channel) {
    case Channel.EMAIL:
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    case Channel.SMS:
    case Channel.KAKAO:
      return /^01[0-9]-?[0-9]{3,4}-?[0-9]{4}$/.test(contact);
    case Channel.PUSH:
      return contact.length > 0;
    default:
      return false;
  }
};
