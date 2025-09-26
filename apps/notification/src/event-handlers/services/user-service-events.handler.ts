import { Controller, Logger } from '@nestjs/common';
import { TypedEventPattern } from '@app/events';
import { UserEvents, UserVerification, UserFindIdPayload, UserResetPasswordPayload } from '@app/shared/events/user.events';
import { EventMappingService } from '../../shared/services/event-mapping.service';
import { NotificationDispatcherService } from '../../dispatcher/services/notification-dispatcher.service';
import { UserNotificationService } from '../../shared/services/user-notification.service';
import { NotificationCategory } from '../../shared/enums';
import { SendNotificationDto } from '../../dispatcher/dto/send-notification.dto';

@Controller()
export class UserServiceEventsHandler {
  private readonly logger = new Logger(UserServiceEventsHandler.name);

  constructor(
    private readonly eventMappingService: EventMappingService,
    private readonly notificationDispatcherService: NotificationDispatcherService,
    private readonly userNotificationService: UserNotificationService,
  ) {}

  @TypedEventPattern<UserEvents, 'USER_VERIFICATION'>('USER_VERIFICATION')
  async onUserVerification(payload: UserVerification) {
    this.logger.log(`Received USER_VERIFICATION event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_VERIFICATION');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_VERIFICATION not found or inactive.`);
        return;
      }

      const userProfile = await this.userNotificationService.getUserProfile(payload.userId);
      if (!userProfile || !userProfile.email) {
        this.logger.warn(`User profile or email not found for userId: ${payload.userId}`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: payload.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: payload.correlationId,
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
      this.logger.log(`Dispatched USER_VERIFICATION notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`Failed to process USER_VERIFICATION notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<UserEvents, 'USER_FIND_ID'>('USER_FIND_ID')
  async onUserFindId(payload: UserFindIdPayload) {
    this.logger.log(`Received USER_FIND_ID event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_FIND_ID');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_FIND_ID not found or inactive.`);
        return;
      }

      const userProfile = await this.userNotificationService.getUserProfileByEmail(payload.email);
      if (!userProfile || !userProfile.email) {
        this.logger.warn(`User profile or email not found for email: ${payload.email}`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: userProfile.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: payload.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          email: payload.email,
          loginId: payload.loginId,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched USER_FIND_ID notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`Failed to process USER_FIND_ID notification: ${error.message}`, error.stack);
    }
  }

  @TypedEventPattern<UserEvents, 'USER_RESET_PASSWORD'>('USER_RESET_PASSWORD')
  async onUserResetPassword(payload: UserResetPasswordPayload) {
    this.logger.log(`Received USER_RESET_PASSWORD event: ${JSON.stringify(payload)}`);
    try {
      const eventMapping = await this.eventMappingService.getEventMapping('USER_RESET_PASSWORD');
      if (!eventMapping || !eventMapping.isActive) {
        this.logger.warn(`Event mapping for USER_RESET_PASSWORD not found or inactive.`);
        return;
      }

      const userProfile = await this.userNotificationService.getUserProfileByEmail(payload.email);
      if (!userProfile || !userProfile.email) {
        this.logger.warn(`User profile or email not found for email: ${payload.email}`);
        return;
      }

      const sendDto: SendNotificationDto = {
        userId: userProfile.userId,
        channels: eventMapping.defaultChannels as any,
        category: eventMapping.category as NotificationCategory,
        templateKey: eventMapping.templateKey,
        eventKey: eventMapping.eventKey,
        payload: payload,
        correlationId: payload.correlationId,
        priority: eventMapping.priority as any,
        variables: {
          email: payload.email,
          verificationToken: payload.verificationToken,
        },
      };
      await this.notificationDispatcherService.send(sendDto);
      this.logger.log(`Dispatched USER_RESET_PASSWORD notification for ${payload.email}`);
    } catch (error) {
      this.logger.error(`Failed to process USER_RESET_PASSWORD notification: ${error.message}`, error.stack);
    }
  }
}
