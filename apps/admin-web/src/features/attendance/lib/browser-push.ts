'use client';

import { NOTIFICATION_SERVICE_BASE_URL } from '../../../const/api-const';
import { client } from '../../../lib/api/client';

export async function disableAttendancePush() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  const registration =
    await navigator.serviceWorker.getRegistration('/attendance');

  const subscription = await registration?.pushManager.getSubscription();

  if (!subscription) {
    return;
  }

  await client.delete(
    `${NOTIFICATION_SERVICE_BASE_URL}/web-push/subscriptions`,
    {
      data: { endpoint: subscription.endpoint },
    }
  );

  await subscription.unsubscribe();
}

export async function enableAttendancePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(
      '이 브라우저에서는 알림을 지원하지 않아요. iPhone은 홈 화면에 추가한 뒤 열어 주세요.'
    );
  }

  if (typeof Notification === 'undefined') {
    throw new Error('홈 화면에 설치한 출결 앱에서 알림을 연결해 주세요.');
  }

  // iPhone requires this call to follow the user's tap without a network wait.
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (permission !== 'granted') {
    throw new Error('기기 설정에서 알림을 허용해 주세요.');
  }

  const { data: config } = await client.get<{
    configured: boolean;
    publicKey: string | null;
  }>(`${NOTIFICATION_SERVICE_BASE_URL}/web-push/config`);

  if (!config.configured || !config.publicKey) {
    throw new Error('알림을 아직 준비 중이에요.');
  }

  const registration = await navigator.serviceWorker.register(
    '/attendance-sw.js',
    { scope: '/attendance' }
  );

  if (!registration.active) {
    await new Promise<void>((resolve, reject) => {
      const worker = registration.installing ?? registration.waiting;

      if (!worker) {
        reject(new Error('출결 앱을 다시 열고 시도해 주세요.'));

        return;
      }

      const timeout = window.setTimeout(
        () =>
          reject(new Error('알림 준비에 시간이 걸려요. 다시 시도해 주세요.')),
        10000
      );

      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          window.clearTimeout(timeout);

          resolve();
        }
      });
    });
  }

  const encoded = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const key = Uint8Array.from(
    atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
    (character) => character.charCodeAt(0)
  );

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));

  const { endpoint, keys } = subscription.toJSON();

  await client.post(`${NOTIFICATION_SERVICE_BASE_URL}/web-push/subscriptions`, {
    endpoint,
    keys,
  });
}

export async function sendAttendanceTestPush() {
  if (
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  ) {
    throw new Error(
      '기기 설정에서 알림을 허용하고 알림 연결하기를 눌러 주세요.'
    );
  }

  if (!('serviceWorker' in navigator)) {
    throw new Error(
      '홈 화면에 설치한 출결 앱에서 알림 연결하기를 눌러 주세요.'
    );
  }

  const registration =
    await navigator.serviceWorker.getRegistration('/attendance');
  const subscription = await registration?.pushManager.getSubscription();

  if (!subscription) {
    throw new Error('먼저 알림 연결하기를 눌러 주세요.');
  }

  await client.post(`${NOTIFICATION_SERVICE_BASE_URL}/web-push/test`, {
    endpoint: subscription.endpoint,
  });
}
