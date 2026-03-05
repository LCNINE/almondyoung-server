// 서비스별 도메인 주소 상수로 관리
function getBaseUrl(envKey: string, fallback: string) {
  const isServer = typeof window === 'undefined';

  // 서버에서 실행 중일 때
  if (isServer) {
    return process.env[envKey] ?? fallback;
  } else {
    // 브라우저(클라이언트)에서 실행 중일 때
    return process.env[`NEXT_PUBLIC_${envKey}`] ?? fallback;
  }
}

const PIM_BASE_URL = getBaseUrl('PIM_SERVICE_URL', 'http://localhost:3020');
const WMS_BASE_URL = getBaseUrl('WMS_SERVICE_URL', 'http://localhost:3010');
const USER_SERVICE_BASE_URL = getBaseUrl(
  'USER_SERVICE_URL',
  'http://localhost:3030'
);
const WALLET_SERVICE_BASE_URL = getBaseUrl(
  'WALLET_SERVICE_URL',
  'http://localhost:3040'
);
const MEMBERSHIP_SERVICE_BASE_URL = getBaseUrl(
  'MEMBERSHIP_SERVICE_URL',
  'http://localhost:3050'
);
const NOTIFICATION_SERVICE_BASE_URL = getBaseUrl(
  'NOTIFICATION_SERVICE_URL',
  'http://localhost:3060'
);
const CHANNEL_ADAPTER_SERVICE_BASE_URL = getBaseUrl(
  'CHANNEL_ADAPTER_SERVICE_URL',
  'http://localhost:3070'
);

export {
  PIM_BASE_URL,
  WMS_BASE_URL,
  USER_SERVICE_BASE_URL,
  WALLET_SERVICE_BASE_URL,
  MEMBERSHIP_SERVICE_BASE_URL,
  NOTIFICATION_SERVICE_BASE_URL,
  CHANNEL_ADAPTER_SERVICE_BASE_URL,
};
