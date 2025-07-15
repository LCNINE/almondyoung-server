// hms-api.provider.ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HmsAPI } from 'hms-api-wrapper';

// 기본 HMS API Provider (실서버)
export const HmsApiProvider: Provider = {
  provide: HmsAPI,
  useFactory: (configService: ConfigService) => {
    return new HmsAPI({
      swKey: configService.get<string>('SW_KEY')!,
      custKey: configService.get<string>('CUST_KEY')!,
      isTest: configService.get<string>('HMS_ENVIRONMENT') !== 'production',
      timeout: parseInt(configService.get<string>('HMS_TIMEOUT') || '30000'),
    });
  },
  inject: [ConfigService],
};

// 배치 CMS mock 용 HMS API Provider
export const BatchCmsMockHmsApiProvider: Provider = {
  provide: 'BATCH_CMS_MOCK_HMS_API',
  useFactory: () => {
    return new HmsAPI({
      swKey: 'mock-sw-key',
      custKey: 'mock-cust-key',
      isTest: true,
      timeout: 30000,
      baseURL: 'http://localhost:3005/v1', // mock 서버
    });
  },
};
