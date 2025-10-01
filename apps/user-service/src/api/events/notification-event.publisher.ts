// apps/user-service/src/events/notification-event.publisher.ts
import { Injectable } from '@nestjs/common';
import { StreamPublisher, InjectStreamPublisher } from '@app/events';
import { UserEvents } from '@app/shared/streams';

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
    @InjectStreamPublisher('users.events.v1')
    private readonly eventPublisher: StreamPublisher<UserEvents>,
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
    return this.eventPublisher.publishEvent({
      eventType: 'UserVerification',
      aggregateId: userId,
      payload: {
        userId,
        email,
        name,
        verificationToken,
        callbackUrl,
        redirectTo,
      },
    });
  }

  // ID 찾기 이벤트 발행
  async publishUserFindIdEvent(email: string, loginId: string) {
    return this.eventPublisher.publishEvent({
      eventType: 'UserFindId',
      aggregateId: email,
      payload: {
        email,
        loginId,
      },
    });
  }

  // 비밀번호 재설정 이벤트 발행
  async publishUserResetPasswordEvent(
    email: string,
    verificationToken: string,
  ) {
    return this.eventPublisher.publishEvent({
      eventType: 'UserResetPassword',
      aggregateId: email,
      payload: {
        email,
        verificationToken,
      },
    });
  }
}
