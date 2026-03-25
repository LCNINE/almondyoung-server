import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Twilio } from 'twilio';
import { LookupController } from './controllers/lookup.controller';
import { SendMessageController } from './controllers/send-verify-code.controller';
import { VerifyCodeController } from './controllers/verify-code.controller';
import { ExpireExistingCodesService } from './services/expire-existing-codes';
import { LookupService } from './services/lookup.service';
import { SendMessageService } from './services/send-verify-code.service';
import { VerifyCodeService } from './services/verify-code.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [SendMessageController, LookupController, VerifyCodeController],
  providers: [
    SendMessageService,
    LookupService,
    {
      provide: 'TWILIO_CLIENT',
      useFactory: (configService: ConfigService) => {
        const accountSid = configService.get<string>('TWILIO_ACCOUNT_SID');
        const authToken = configService.get<string>('TWILIO_AUTH_TOKEN');
        return new Twilio(accountSid, authToken);
      },
      inject: [ConfigService],
    },
    {
      provide: 'TWILIO_PHONE_NUMBER',
      useFactory: (configService: ConfigService) => {
        return configService.get<string>('TWILIO_PHONE_NUMBER');
      },
      inject: [ConfigService],
    },
    {
      provide: 'TWILIO_SERVICE_ID',
      useFactory: (configService: ConfigService) => {
        return configService.get<string>('TWILIO_SERVICE_ID');
      },
      inject: [ConfigService],
    },
    ExpireExistingCodesService,
    VerifyCodeService,
  ],
  exports: [],
})
export class TwilioModule {}
