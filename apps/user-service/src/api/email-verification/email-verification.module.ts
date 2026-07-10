import { EventsModule } from '@app/events';
import { Module } from '@nestjs/common';
import { EmailVerificationController } from './email-verification.controller';
import { ExpireEmailCodesService } from './services/expire-email-codes.service';
import { IdentityVerificationService } from './services/identity-verification.service';
import { SendEmailCodeService } from './services/send-email-code.service';
import { VerifyEmailCodeService } from './services/verify-email-code.service';

@Module({
  imports: [EventsModule],
  controllers: [EmailVerificationController],
  providers: [
    SendEmailCodeService,
    VerifyEmailCodeService,
    ExpireEmailCodesService,
    IdentityVerificationService,
  ],
})
export class EmailVerificationModule {}
