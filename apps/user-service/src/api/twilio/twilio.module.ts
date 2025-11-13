import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Twilio } from 'twilio';
import { LookupController } from './controllers/lookup.controller';
import { SendMessageController } from './controllers/send-verify-code.controller';
import { VerifyCodeController } from './controllers/verify-code.controller';
import { CheckResendService } from './services/check-resend.service';
import { ExpireExistingCodesService } from './services/expire-existing-codes';
import { LookupService } from './services/lookup.service';
import { SendMessageService } from './services/send-verify-code.service';
import { VerifyCodeService } from './services/verify-code.service';

@Module({
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
    CheckResendService,
    ExpireExistingCodesService,
    VerifyCodeService,
  ],
  exports: [],
})
export class TwilioModule {}
