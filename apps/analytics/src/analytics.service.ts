import { Injectable, NotImplementedException } from '@nestjs/common';
import { AnalyticsHealthDto, AnalyticsSummaryDto, ProductOrderMetricDto } from './dto';

@Injectable()
export class AnalyticsService {
  getHealth(): AnalyticsHealthDto {
    return {
      status: 'ok',
      service: 'analytics',
      timestamp: new Date().toISOString(),
    };
  }

  getSummary(): AnalyticsSummaryDto {
    throw new NotImplementedException('TODO: summary API is pending agg-backed implementation.');
  }

  getProductOrderMetrics(): ProductOrderMetricDto[] {
    throw new NotImplementedException('TODO: product metrics API is pending agg-backed implementation.');
  }
}
