// apps/notification/src/dispatcher/controllers/notification.controller.ts
import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { NotificationDispatcherService } from '../services/notification-dispatcher.service';
import { SendNotificationDto } from '../dto/send-notification.dto';

@Controller('api/v1/notifications')
export class NotificationController {
    constructor(
        private readonly dispatcherService: NotificationDispatcherService,
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
}
