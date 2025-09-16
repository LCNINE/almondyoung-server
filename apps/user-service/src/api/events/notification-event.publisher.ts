// apps/user-service/src/events/notification-event.publisher.ts
import { Injectable } from '@nestjs/common';
import { EventPublisherService, InjectEventPublisher } from '@app/events';
import { UserEvents } from '@app/shared/events/user.events';

interface UserVerificationEvent {
  userId: string;
  email: string;
  name: string;
  verificationToken: string;
  callbackUrl: string;
  redirectTo: string;
}

@Injectable()
export class NotificationEventPublisher {
  constructor(
    @InjectEventPublisher()
    private readonly eventPublisher: EventPublisherService<UserEvents>,
  ) {}

  // 회원가입시 이메일 인증 이벤트 발행
  async publishUserVerificationEvent({
    userId,
    email,
    name,
    verificationToken,
    callbackUrl,
    redirectTo,
  }: UserVerificationEvent) {
    return this.eventPublisher.publishEvent('USER_VERIFICATION', {
      userId,
      email,
      name,
      verificationToken,
      callbackUrl,
      redirectTo,
    });
  }

  // ID 찾기 이벤트 발행
  async publishUserFindIdEvent(email: string, loginId: string) {
    return this.eventPublisher.publishEvent('USER_FIND_ID', {
      email,
      loginId,
    });
  }

  // 비밀번호 재설정 이벤트 발행
  async publishUserResetPasswordEvent(
    email: string,
    verificationToken: string,
  ) {
    return this.eventPublisher.publishEvent('USER_RESET_PASSWORD', {
      email,
      verificationToken,
    });
  }
}
