// apps/notification/src/event-handlers/user-event.handler.ts
import { Controller, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { UserEvents, UserVerification, UserFindIdPayload, UserResetPasswordPayload } from '../events/user.events';
import { NotificationDispatcherService } from '../dispatcher/services/notification-dispatcher.service';
import { EventMappingService } from './services/event-mapping.service';
import { Channel, NotificationCategory, NotificationPriority } from '../shared/enums';

@Controller()
export class UserEventHandler {
  private readonly logger = new Logger(UserEventHandler.name);

  constructor(
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @TypedEventPattern<UserEvents, 'USER_VERIFICATION'>('USER_VERIFICATION')
  async onUserVerification(payload: UserVerification) {
    this.logger.log(`Received USER_VERIFICATION event for user: ${payload.userId}`);
    
    try {
      // 이벤트 매핑 서비스를 통해 템플릿 정보 조회
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_VERIFICATION');
        return;
      }

      // 이메일 인증 알림 발송
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: [Channel.EMAIL],
        category: NotificationCategory.SYSTEM,
        templateKey: eventMapping.templateKey,
        eventKey: 'USER_VERIFICATION',
        payload: {
          email: payload.email,
          name: payload.name,
          verificationToken: payload.verificationToken,
          callbackUrl: payload.callbackUrl,
          redirectTo: payload.redirectTo,
        },
        correlationId: payload.correlationId,
        priority: NotificationPriority.HIGH,
      });

      this.logger.log(`Email verification notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`Failed to send verification notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<UserEvents, 'USER_FIND_ID'>('USER_FIND_ID')
  async onUserFindId(payload: UserFindIdPayload) {
    this.logger.log(`Received USER_FIND_ID event for email: ${payload.email}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_FIND_ID');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_FIND_ID');
        return;
      }

      const result = await this.notificationDispatcher.send({
        userId: payload.userId || 'unknown',
        channels: [Channel.EMAIL],
        category: NotificationCategory.SYSTEM,
        templateKey: eventMapping.templateKey,
        eventKey: 'USER_FIND_ID',
        payload: {
          email: payload.email,
          loginId: payload.loginId,
        },
        correlationId: payload.correlationId,
        priority: NotificationPriority.HIGH,
      });

      this.logger.log(`ID find notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`Failed to send ID find notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<UserEvents, 'USER_RESET_PASSWORD'>('USER_RESET_PASSWORD')
  async onUserResetPassword(payload: UserResetPasswordPayload) {
    this.logger.log(`Received USER_RESET_PASSWORD event for email: ${payload.email}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_RESET_PASSWORD');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_RESET_PASSWORD');
        return;
      }

      const result = await this.notificationDispatcher.send({
        userId: payload.userId || 'unknown',
        channels: [Channel.EMAIL],
        category: NotificationCategory.SYSTEM,
        templateKey: eventMapping.templateKey,
        eventKey: 'USER_RESET_PASSWORD',
        payload: {
          email: payload.email,
          verificationToken: payload.verificationToken,
        },
        correlationId: payload.correlationId,
        priority: NotificationPriority.HIGH,
      });

      this.logger.log(`Password reset notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`Failed to send password reset notification: ${error.message}`, error.stack);
    }
  }
}
