// apps/notification/src/provider/provider.module.ts (수정된 버전)
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { ProviderController } from './controllers/provider.controller';
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
  controllers: [ProviderController],
  providers: [
    ProviderManagerService,
    ProviderFactory,
    AlertService, // SharedModule 의존성 제거, 직접 import
  ],
  exports: [ProviderManagerService],
})
export class ProviderModule { }
