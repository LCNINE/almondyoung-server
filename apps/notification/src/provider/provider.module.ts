import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { ProviderController } from './controllers/provider.controller';
import { ProviderManagerService } from './services/provider-manager.service';
import { SharedModule } from '../shared/shared.module';

import { ResendProvider } from './providers/email/resend.provider';
import { TwilioProvider } from './providers/sms/twilio.provider';
import { NHNProvider } from './providers/kakao/nhn.provider';
import { FCMProvider } from './providers/push/fcm.provider';

@Module({
  imports: [
    ConfigModule,
    DbModule.forRoot({
      config: {
        connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    SharedModule,
  ],
  controllers: [ProviderController],
  providers: [
    ProviderManagerService,
    ResendProvider,  // SendGrid 대신 Resend
    TwilioProvider,
    NHNProvider,
    FCMProvider,
  ],
  exports: [ProviderManagerService],
})
export class ProviderModule { }
