export interface ChannelConfig {
  channelType: 'naver_smartstore' | 'coupang';
  name: string;
  isActive?: boolean;
  apiEndpoint?: string;
  authConfig?: Record<string, any>;
  syncConfig: {
    mode: 'polling' | 'webhook'; // PoC 기본: polling
    webhook?: { url: string; secret?: string };
    polling?: { intervalSeconds: number; endpoint?: string };
  };
  mappingRules?: Record<string, any>; // 내부↔외부 매핑
}

export const channelConfigs: ChannelConfig[] = [
  {
    channelType: 'naver_smartstore',
    name: '네이버 스마트스토어',
    isActive: true,
    apiEndpoint: process.env.NAVER_API_ENDPOINT, // ex) https://api.commerce.naver.com/external/v1
    authConfig: {
      clientId: process.env.NAVER_CLIENT_ID,
      clientSecret: process.env.NAVER_CLIENT_SECRET,
      accessToken: process.env.NAVER_ACCESS_TOKEN, // 토큰 캐시/리프레시 전략은 Strategy에서
    },
    syncConfig: { mode: 'polling', polling: { intervalSeconds: 60 } },
    mappingRules: {
      orderId: 'orderId',
      productOrderId: 'productOrderId',
      status: 'productOrderStatus',
      lastChangedType: 'lastChangedType',
      lastChangedAt: 'lastChangedDate',
    },
  },
  {
    channelType: 'coupang',
    name: '쿠팡',
    isActive: true,
    apiEndpoint: process.env.COUPANG_API_ENDPOINT, // ex) https://api-gateway.coupang.com
    authConfig: {
      accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
    },
    syncConfig: { mode: 'polling', polling: { intervalSeconds: 60 } },
    mappingRules: {
      orderId: 'orderId',
      productOrderId: 'vendorItemId',
      status: 'orderType',
      lastChangedAt: 'orderedAt',
      promiseDeliveryDate: 'promiseDeliveryDate',
    },
  },
];
