// apps/notification/src/shared/controllers/user-notification.controller.ts
import {
    Controller,
    Get,
    Post,
    Put,
    Body,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { UserNotificationService } from '../services/user-notification.service';
import { CreateUserNotificationSettingsDto, UpdateUserNotificationSettingsDto } from '../dto/user-notification-settings.dto';

@Controller('api/v1/users/:userId/notification-settings')
export class UserNotificationController {
    constructor(private readonly notificationService: UserNotificationService) { }

    @Get()
    async getSettings(@Param('userId') userId: string) {
        const settings = await this.notificationService.getUserNotificationSettings(userId);

        return {
            userId,
            isMarketingEnabled: settings?.isMarketingEnabled ?? false,
            preferredLanguage: settings?.preferredLanguage ?? 'ko',
            pushSettings: settings?.pushSettings || {},
            settings: settings?.settings || {},
        };
    }

    @Post()
    async createSettings(
        @Param('userId') userId: string,
        @Body(ValidationPipe) dto: CreateUserNotificationSettingsDto,
    ) {
        return this.notificationService.createNotificationSettings(userId, dto);
    }

    @Put()
    async updateSettings(
        @Param('userId') userId: string,
        @Body(ValidationPipe) dto: UpdateUserNotificationSettingsDto,
    ) {
        return this.notificationService.updateNotificationSettings(userId, dto);
    }
}
