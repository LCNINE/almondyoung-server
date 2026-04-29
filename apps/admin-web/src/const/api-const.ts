// 서비스별 도메인 주소 상수로 관리
// 서버 컴포넌트/서버 액션은 환경변수의 실제 URL을 직접 사용하고,
// 브라우저(클라이언트)는 Next.js 프록시 라우트(/api/proxy/*)를 통해 호출합니다.
const isServer = typeof window === 'undefined';

const ALMONDYOUNG_API_BASE_URL = isServer
  ? (process.env.ALMONDYOUNG_API_URL ?? 'http://localhost:3000')
  : '/proxy/api';

const USER_SERVICE_BASE_URL = isServer
  ? (process.env.USER_SERVICE_URL ?? 'http://localhost:3030')
  : '/proxy/users';

const WALLET_SERVICE_BASE_URL = isServer
  ? (process.env.WALLET_SERVICE_URL ?? 'http://localhost:3040')
  : '/proxy/wallet';

const MEMBERSHIP_SERVICE_BASE_URL = isServer
  ? (process.env.MEMBERSHIP_SERVICE_URL ?? 'http://localhost:3050')
  : '/proxy/membership';

const NOTIFICATION_SERVICE_BASE_URL = isServer
  ? (process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3060')
  : '/proxy/notification';

const CHANNEL_ADAPTER_SERVICE_BASE_URL = isServer
  ? (process.env.CHANNEL_ADAPTER_SERVICE_URL ?? 'http://localhost:3070')
  : '/proxy/channel';

const UGC_SERVICE_BASE_URL = isServer
  ? (process.env.UGC_SERVICE_URL ?? 'http://localhost:3031')
  : '/proxy/ugc';

const FILE_SERVICE_BASE_URL = isServer
  ? (process.env.FILE_SERVICE_URL ?? 'http://localhost:3000')
  : '/api/proxy/file'; // file-service같은경우 /api/를 붙여야 이미지 호출이 가능했습니다.

const MEDUSA_BASE_URL = isServer
  ? (process.env.MEDUSA_API_URL ?? 'http://localhost:9000')
  : '/proxy/medusa';

export {
  ALMONDYOUNG_API_BASE_URL,
  USER_SERVICE_BASE_URL,
  WALLET_SERVICE_BASE_URL,
  MEMBERSHIP_SERVICE_BASE_URL,
  NOTIFICATION_SERVICE_BASE_URL,
  CHANNEL_ADAPTER_SERVICE_BASE_URL,
  UGC_SERVICE_BASE_URL,
  FILE_SERVICE_BASE_URL,
  MEDUSA_BASE_URL,
};
