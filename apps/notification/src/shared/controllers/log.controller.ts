// apps/notification/src/shared/controllers/log.controller.ts
import {
    Controller,
    Get,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { NotificationLoggerService } from '../services/notification-logger.service';

@Controller('api/v1/logs')
export class LogController {
    constructor(
        private readonly loggerService: NotificationLoggerService,
    ) { }

    @Get('stats')
    async getStats(
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('userId') userId?: string,
        @Query('channel') channel?: string,
    ) {
        return this.loggerService.getStats({
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            userId,
            channel,
        });
    }
}