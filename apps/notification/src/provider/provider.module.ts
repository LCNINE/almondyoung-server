// apps/notification/src/provider/provider.module.ts (수정된 버전)
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { INTERNAL_KEY_ENV } from '@app/authorization';
import { ProviderController } from './controllers/provider.controller';
import { SmsInternalController } from './controllers/sms-internal.controller';
import { ProviderManagerService } from './services/provider-manager.service';
import { ProviderFactory } from './factories/provider.factory';
import { AlertService } from '../shared/services/alert.service';

@Module({
  imports: [
    ConfigModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
  ],
  controllers: [ProviderController, SmsInternalController],
  providers: [
    ProviderManagerService,
    ProviderFactory,
    AlertService, // SharedModule 의존성 제거, 직접 import
    // `InternalKeyGuard` 가 읽을 env 이름. notification 으로 들어오는 서비스 간 호출은 이 키를 쓴다.
    { provide: INTERNAL_KEY_ENV, useValue: 'NOTIFICATION_INTERNAL_KEY' },
  ],
  exports: [ProviderManagerService],
})
export class ProviderModule {}
