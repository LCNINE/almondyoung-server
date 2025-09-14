import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from '../services/metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response) {
    try {
      const metrics = await this.metricsService.getMetrics();

      res.set({
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      });

      res.send(metrics);
    } catch (error) {
      res.status(500).json({
        error: 'Failed to generate metrics',
        message: error.message,
      });
    }
  }
}