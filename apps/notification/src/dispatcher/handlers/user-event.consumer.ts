// apps/notification/src/dispatcher/handlers/user-event.consumer.ts
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { USER_STREAM } from '@packages/event-contracts/streams/user.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

/**
 * User Service 이벤트 컨슈머
 *
 * user-service가 발행한 이벤트를 수신하여 알림을 발송합니다.
 * - UserVerification: 회원가입 이메일 인증
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class UserEventConsumer {
  private readonly logger = new Logger(UserEventConsumer.name);

  constructor(
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly eventMappingService: EventMappingService,
  ) {}

  @On(USER_STREAM, 'UserVerification')
  async onUserVerification(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserVerification'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserVerification'>,
  ) {
    this.logger.log(`[Event] Received UserVerification: ${payload.userId} (correlationId: ${envelope.correlationId})`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_VERIFICATION not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          name: payload.name,
          email: payload.email,
          verificationToken: payload.verificationToken,
          callbackUrl: payload.callbackUrl,
          redirectTo: payload.redirectTo,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_VERIFICATION notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_VERIFICATION notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @On(USER_STREAM, 'UserVerificationCode')
  async onUserVerificationCode(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserVerificationCode'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserVerificationCode'>,
  ) {
    this.logger.log(
      `[Event] Received UserVerificationCode: ${payload.userId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION_CODE');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_VERIFICATION_CODE not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          name: payload.name,
          code: payload.code,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_VERIFICATION_CODE notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_VERIFICATION_CODE notification: ${error.message}`, error.stack);
      throw error;
    }
  }

  @On(USER_STREAM, 'UserPasswordChanged')
  async onUserPasswordChanged(
    @EventEnvelope() envelope: EnvelopeOf<typeof USER_STREAM, 'UserPasswordChanged'>,
    @EventPayload() payload: EventPayloadOf<typeof USER_STREAM, 'UserPasswordChanged'>,
  ) {
    this.logger.log(
      `[Event] Received UserPasswordChanged: ${payload.userId} (correlationId: ${envelope.correlationId})`,
    );
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_PASSWORD_CHANGED');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_PASSWORD_CHANGED not found or inactive.`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: envelope.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          name: payload.name,
          accountUrl: payload.accountUrl,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`[Event] Dispatched USER_PASSWORD_CHANGED notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`[Event] Failed to process USER_PASSWORD_CHANGED notification: ${error.message}`, error.stack);
      throw error;
    }
  }
}
