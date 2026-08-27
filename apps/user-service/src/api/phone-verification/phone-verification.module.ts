import { Module } from '@nestjs/common';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { SendMessageController } from './controllers/send-verification-code.controller';
import { VerifyCodeController } from './controllers/verify-code.controller';
import { ExpireExistingCodesService } from './services/expire-existing-codes';
import { SendMessageService } from './services/send-verification-code.service';
import { SmsSenderService } from './services/sms-sender.service';
import { VerifyCodeService } from './services/verify-code.service';

/**
 * 인증번호의 생성·저장·검증만 담당한다. 발송은 notification 이 소유한다 — `SmsSenderService` 참고.
 *
 * 라우트 경로는 `twilio/…` 로 남아 있다. storefront 와 auth-web 이 그 경로를 부르고 있어서,
 * 여기서 바꾸면 프론트 두 개를 같은 순간에 배포해야 하고 순서가 어긋나면 인증이 멈춘다.
 * 경로 정리는 프론트와 같이 할 것.
 */
@Module({
  imports: [SCHEDULE_ROOT],
  controllers: [SendMessageController, VerifyCodeController],
  providers: [SendMessageService, ExpireExistingCodesService, VerifyCodeService, SmsSenderService],
  exports: [],
})
export class PhoneVerificationModule {}
