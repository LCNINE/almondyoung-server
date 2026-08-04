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

/**
 * 운영이 아닌 환경에서 쓸 대체 수신처.
 * 지정이 없으면 null → 발송이 "연락처 없음"으로 스킵된다 (PUSH 는 대체 불가라 항상 스킵).
 */
const getDevRecipient = (channel: Channel): string | null => {
  switch (channel) {
    case Channel.EMAIL:
      return process.env.NOTIFICATION_DEV_EMAIL || null;
    case Channel.SMS:
    case Channel.KAKAO:
      return process.env.NOTIFICATION_DEV_PHONE || null;
    default:
      return null;
  }
};

const resolveContact = (userProfile: UserProfile, channel: Channel): string | null => {
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

/**
 * 발송 경로(큐 processor / 직접 발송)가 모두 통과하는 유일한 수신자 결정 지점.
 *
 * 로컬이 라이브 복제 DB·복제 이벤트를 물면 실제 고객에게 알림이 나간다
 * (2026-08-04 로컬 채널어댑터가 과거 주문 986건을 재발행 → 774명에게 주문접수 메일 오발송).
 * 그래서 NODE_ENV=production 이 아니면 실제 고객 연락처를 절대 반환하지 않는다.
 * 라이브 ECS 는 baseEnv 로 NODE_ENV=production 이 항상 주입된다 (deployments/lcnine/services/infra/shared.ts).
 */
export const getContactForChannel = (userProfile: UserProfile, channel: Channel): string | null => {
  const contact = resolveContact(userProfile, channel);

  if (contact && process.env.NODE_ENV !== 'production') {
    return getDevRecipient(channel);
  }

  return contact;
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
