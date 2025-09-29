// apps/notification/src/shared/controllers/log.controller.ts
import {
    Controller,
    Get,
    Query,
    ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationLoggerService } from '../services/notification-logger.service';

@ApiTags('logs')
@Controller('api/v1/logs')
export class LogController {
    constructor(
        private readonly loggerService: NotificationLoggerService,
    ) { }

    @Get('stats')
    @ApiOperation({ summary: '알림 통계 조회', description: '지정된 조건에 따른 알림 발송 통계를 조회합니다.' })
    @ApiQuery({ name: 'startDate', required: false, description: '시작 날짜 (ISO 문자열)', example: '2024-01-01T00:00:00Z' })
    @ApiQuery({ name: 'endDate', required: false, description: '종료 날짜 (ISO 문자열)', example: '2024-01-31T23:59:59Z' })
    @ApiQuery({ name: 'userId', required: false, description: '사용자 ID', example: 'user-123' })
    @ApiQuery({ name: 'channel', required: false, description: '채널', example: 'EMAIL' })
    @ApiResponse({ status: 200, description: '통계 조회 성공' })
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
