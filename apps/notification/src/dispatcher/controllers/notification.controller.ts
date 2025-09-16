// apps/notification/src/dispatcher/controllers/notification.controller.ts
import {
    Controller,
    Post,
    Get,
    Put,
    Body,
    Param,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { UserNotificationService } from '../../shared/services/user-notification.service';
import { CreateUserNotificationSettingsDto, UpdateUserNotificationSettingsDto } from '../../shared/dto/user-notification-settings.dto';

@Controller('api/v1/notifications')
export class NotificationController {
    constructor(
        private readonly dispatcherService: NotificationDispatcherService,
        private readonly userNotificationService: UserNotificationService,
    ) { }

    @Post('send')
    async send(@Body(ValidationPipe) dto: SendNotificationDto) {
        return this.dispatcherService.send(dto);
    }

    @Get(':id')
    async getOne(@Param('id') id: string) {
        return this.dispatcherService.getNotification(id);
    }

    @Get('users/:userId')
    async getUserNotifications(
        @Param('userId') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.dispatcherService.getUserNotifications(userId, limit || 50);
    }

    // 사용자 알림 설정 관련 엔드포인트
    @Get('users/:userId/settings')
    async getUserNotificationSettings(@Param('userId') userId: string) {
        const settings = await this.userNotificationService.getUserNotificationSettings(userId);

        return {
            userId,
            isMarketingEnabled: settings?.isMarketingEnabled ?? false,
            preferredLanguage: settings?.preferredLanguage ?? 'ko',
            pushSettings: settings?.pushSettings || {},
            settings: settings?.settings || {},
        };
    }

    @Post('users/:userId/settings')
    async createUserNotificationSettings(
        @Param('userId') userId: string,
        @Body(ValidationPipe) dto: CreateUserNotificationSettingsDto,
    ) {
        return this.userNotificationService.createNotificationSettings(userId, dto);
    }

    @Put('users/:userId/settings')
    async updateUserNotificationSettings(
        @Param('userId') userId: string,
        @Body(ValidationPipe) dto: UpdateUserNotificationSettingsDto,
    ) {
        return this.userNotificationService.updateNotificationSettings(userId, dto);
    }

    // 이벤트 기반 개별 발송 엔드포인트
    @Post('events/process')
    async processEvent(@Body(ValidationPipe) eventData: {
        eventKey: string;
        userId: string;
        payload: Record<string, any>;
        channels?: string[];
        metadata?: Record<string, any>;
    }) {
        return this.dispatcherService.processEvent(eventData);
    }

    // 카프카 이벤트 수신 엔드포인트 (예시)
    @Post('events/kafka')
    async handleKafkaEvent(@Body() kafkaEvent: {
        topic: string;
        partition: number;
        offset: number;
        key: string;
        value: any;
        timestamp: string;
    }) {
        // 카프카 이벤트를 내부 이벤트 형식으로 변환
        const eventData = {
            eventKey: kafkaEvent.topic,
            userId: kafkaEvent.value.userId,
            payload: kafkaEvent.value.payload || {},
            channels: kafkaEvent.value.channels,
            metadata: {
                kafkaTopic: kafkaEvent.topic,
                kafkaPartition: kafkaEvent.partition,
                kafkaOffset: kafkaEvent.offset,
                kafkaTimestamp: kafkaEvent.timestamp,
            }
        };

        return this.dispatcherService.processEvent(eventData);
    }
}
