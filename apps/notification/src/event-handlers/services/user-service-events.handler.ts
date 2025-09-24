// apps/notification/src/event-handlers/services/user-service-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';

@Injectable()
export class UserServiceEventsHandler {
  private readonly logger = new Logger(UserServiceEventsHandler.name);

  constructor(
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @EventPattern('user.verification')
  async onUserVerification(@Payload() payload: any) {
    this.logger.log(`[USER-SERVICE] Received USER_VERIFICATION event for user: ${payload.userId}`);
    
    try {
      // 이벤트 매핑 서비스를 통해 템플릿 정보 조회
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_VERIFICATION');
        return;
      }

      // 이메일 인증 알림 발송 (정보성 알림이므로 동의 불필요)
      const result = await this.notificationDispatcher.send({
        userId: payload.userId,
        channels: ['EMAIL'],
        category: 'SYSTEM',
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
        priority: 'HIGH',
      });

      this.logger.log(`[USER-SERVICE] Email verification notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[USER-SERVICE] Failed to send verification notification: ${error.message}`, error.stack);
    }
  }

  @EventPattern('user.find.id')
  async onUserFindId(@Payload() payload: any) {
    this.logger.log(`[USER-SERVICE] Received USER_FIND_ID event for email: ${payload.email}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_FIND_ID');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_FIND_ID');
        return;
      }

      const result = await this.notificationDispatcher.send({
        userId: payload.userId || 'unknown',
        channels: ['EMAIL'],
        category: 'SYSTEM',
        templateKey: eventMapping.templateKey,
        eventKey: 'USER_FIND_ID',
        payload: {
          email: payload.email,
          loginId: payload.loginId,
        },
        correlationId: payload.correlationId,
        priority: 'HIGH',
      });

      this.logger.log(`[USER-SERVICE] ID find notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[USER-SERVICE] Failed to send ID find notification: ${error.message}`, error.stack);
    }
  }

  @EventPattern('user.reset.password')
  async onUserResetPassword(@Payload() payload: any) {
    this.logger.log(`[USER-SERVICE] Received USER_RESET_PASSWORD event for email: ${payload.email}`);
    
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_RESET_PASSWORD');
      
      if (!eventMapping) {
        this.logger.warn('No event mapping found for USER_RESET_PASSWORD');
        return;
      }

      const result = await this.notificationDispatcher.send({
        userId: payload.userId || 'unknown',
        channels: ['EMAIL'],
        category: 'SYSTEM',
        templateKey: eventMapping.templateKey,
        eventKey: 'USER_RESET_PASSWORD',
        payload: {
          email: payload.email,
          verificationToken: payload.verificationToken,
        },
        correlationId: payload.correlationId,
        priority: 'HIGH',
      });

      this.logger.log(`[USER-SERVICE] Password reset notification sent to ${payload.email}`, result);
    } catch (error) {
      this.logger.error(`[USER-SERVICE] Failed to send password reset notification: ${error.message}`, error.stack);
    }
  }
}
