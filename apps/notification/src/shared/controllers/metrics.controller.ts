// apps/notification/src/shared/controllers/metrics.controller.ts
import {
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MetricsService } from '../services/metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
    constructor(private readonly metricsService: MetricsService) { }

    @Get('daily')
    @ApiOperation({ summary: '일일 메트릭 조회', description: '지정된 날짜의 일일 알림 메트릭을 조회합니다.' })
    @ApiQuery({ name: 'date', required: false, description: '조회할 날짜 (ISO 문자열)', example: '2024-01-15' })
    @ApiResponse({ status: 200, description: '일일 메트릭 조회 성공' })
    async getDailyMetrics(@Query('date') date?: string) {
        const targetDate = date ? new Date(date) : new Date();
        return this.metricsService.getDailyMetrics(targetDate);
    }

    @Get('channel-performance')
    @ApiOperation({ summary: '채널 성능 조회', description: '특정 채널의 성능 지표를 조회합니다.' })
    @ApiQuery({ name: 'channel', description: '채널명', example: 'EMAIL' })
    @ApiQuery({ name: 'days', required: false, description: '조회 기간 (일)', example: 7 })
    @ApiResponse({ status: 200, description: '채널 성능 조회 성공' })
    async getChannelPerformance(
        @Query('channel') channel: string,
        @Query('days') days?: number,
    ) {
        return this.metricsService.getChannelPerformance(channel, days || 7);
    }

    @Get('provider-health')
    @ApiOperation({ summary: '프로바이더 상태 조회', description: '모든 프로바이더의 상태를 조회합니다.' })
    @ApiResponse({ status: 200, description: '프로바이더 상태 조회 성공' })
    async getProviderHealth() {
        return this.metricsService.getProviderHealth();
    }
}
