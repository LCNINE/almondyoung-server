import { BadRequestException } from '@nestjs/common';

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

export function validateSubscription(value: BrowserPushSubscription): void {
  let url: URL;

  try {
    url = new URL(value.endpoint);
  } catch {
    throw new BadRequestException('알림 구독 주소를 확인해 주세요.');
  }

  const allowed =
    url.hostname === 'fcm.googleapis.com' ||
    url.hostname === 'web.push.apple.com' ||
    url.hostname.endsWith('.push.services.mozilla.com') ||
    url.hostname.endsWith('.notify.windows.com');

  if (
    !allowed ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    value.endpoint.length > 4096
  ) {
    throw new BadRequestException('지원하는 브라우저 알림 구독 주소가 아니에요.');
  }

  if (
    !value.keys ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(value.keys.auth) ||
    !/^[A-Za-z0-9_-]+={0,2}$/.test(value.keys.p256dh) ||
    Buffer.from(value.keys.auth, 'base64url').length !== 16 ||
    Buffer.from(value.keys.p256dh, 'base64url').length !== 65
  ) {
    throw new BadRequestException('알림 구독 키를 확인해 주세요.');
  }
}

export function safeAttendanceUrl(path: string): string {
  if (!/^\/(attendance|company\/attendance)(\/[a-z-]+)?$/.test(path)) {
    throw new BadRequestException('출결 페이지 주소만 허용돼요.');
  }

  return path;
}
