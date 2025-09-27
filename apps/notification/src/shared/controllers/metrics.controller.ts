// apps/notification/src/shared/controllers/metrics.controller.ts
import {
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';

@Controller('api/v1/metrics')
export class MetricsController {
    constructor(private readonly metricsService: MetricsService) { }

    @Get('daily')
    async getDailyMetrics(@Query('date') date?: string) {
        const targetDate = date ? new Date(date) : new Date();
        return this.metricsService.getDailyMetrics(targetDate);
    }

    @Get('channel-performance')
    async getChannelPerformance(
        @Query('channel') channel: string,
        @Query('days') days?: number,
    ) {
        return this.metricsService.getChannelPerformance(channel, days || 7);
    }

    @Get('provider-health')
    async getProviderHealth() {
        return this.metricsService.getProviderHealth();
    }
}