// apps/notification/src/shared/controllers/log.controller.ts
import {
    Controller,
    Get,
    Query,
    Param,
    ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { NotificationLoggerService } from '../services/notification-logger.service';

@ApiTags('logs')
@Controller('logs')
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

    @Get()
    @ApiOperation({ summary: '알림 로그 목록 조회', description: '알림 발송 로그 목록을 조회합니다.' })
    @ApiQuery({ name: 'notificationId', required: false, description: '알림 ID', example: 'notification-123' })
    @ApiQuery({ name: 'campaignId', required: false, description: '캠페인 ID', example: 'campaign-123' })
    @ApiQuery({ name: 'userId', required: false, description: '사용자 ID', example: 'user-123' })
    @ApiQuery({ name: 'eventKey', required: false, description: '이벤트 키', example: 'OrderCreated' })
    @ApiQuery({ name: 'channel', required: false, description: '채널', example: 'EMAIL' })
    @ApiQuery({ name: 'provider', required: false, description: '프로바이더', example: 'resend' })
    @ApiQuery({ name: 'status', required: false, description: '상태 필터 (쉼표로 구분)', example: 'SENT,FAILED' })
    @ApiQuery({ name: 'startDate', required: false, description: '시작 날짜 (ISO 문자열)', example: '2024-01-01T00:00:00Z' })
    @ApiQuery({ name: 'endDate', required: false, description: '종료 날짜 (ISO 문자열)', example: '2024-01-31T23:59:59Z' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: '페이지 크기', example: 100 })
    @ApiQuery({ name: 'offset', required: false, type: Number, description: '오프셋', example: 0 })
    @ApiResponse({ status: 200, description: '로그 목록 조회 성공' })
    async findAllLogs(
        @Query('notificationId') notificationId?: string,
        @Query('campaignId') campaignId?: string,
        @Query('userId') userId?: string,
        @Query('eventKey') eventKey?: string,
        @Query('channel') channel?: string,
        @Query('provider') provider?: string,
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number,
    ) {
        const statusArray = status ? status.split(',') : undefined;
        return this.loggerService.findAllLogs({
            notificationId,
            campaignId,
            userId,
            eventKey,
            channel,
            provider,
            status: statusArray,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined,
        });
    }

    @Get('notifications/:notificationId')
    @ApiOperation({ summary: '특정 알림의 로그 조회', description: '특정 알림 ID의 모든 로그를 조회합니다.' })
    @ApiParam({ name: 'notificationId', description: '알림 ID', example: 'notification-123' })
    @ApiResponse({ status: 200, description: '로그 조회 성공' })
    async findLogsByNotificationId(@Param('notificationId') notificationId: string) {
        return this.loggerService.findLogsByNotificationId(notificationId);
    }
}
