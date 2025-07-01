// hms-api.provider.ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HmsAPI } from 'hms-api-wrapper';

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
