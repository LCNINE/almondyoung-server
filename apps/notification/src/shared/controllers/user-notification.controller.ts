// apps/notification/src/shared/controllers/user-notification.controller.ts
import {
    Controller,
    Get,
    Put,
    Body,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { UserNotificationService } from '../services/user-notification.service';

@Controller('api/v1/users/:userId/notification-settings')
export class UserNotificationController {
    constructor(private readonly notificationService: UserNotificationService) { }

    @Get()
    async getSettings(@Param('userId') userId: string) {
        const settings = await this.notificationService.getUserNotificationSettings(userId);

        return {
            userId,
            isNotificationEnabled: settings?.isNotificationEnabled ?? true,
            preferredLanguage: settings?.preferredLanguage ?? 'ko',
            settings: settings?.settings || {},
        };
    }

    @Put()
    async updateSettings(
        @Param('userId') userId: string,
        @Body(ValidationPipe) dto: any,
    ) {
        return this.notificationService.updateNotificationSettings(userId, dto);
    }
}