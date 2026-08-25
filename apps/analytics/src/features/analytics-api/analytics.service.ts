import { Injectable } from '@nestjs/common';
import { AnalyticsHealthDto, AnalyticsSummaryDto } from './dto';
import { ProductOrderMetricDto } from '../product-ranking/api/dto';
import { ProductRankingQuery } from '../product-ranking/read-model/product-ranking.query';
import { StatisticsQuery } from '../statistics/read-model/statistics.query';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly productRankingQuery: ProductRankingQuery,
    private readonly statisticsQuery: StatisticsQuery,
  ) {}

  getHealth(): AnalyticsHealthDto {
    return {
      status: 'ok',
      service: 'analytics',
      timestamp: new Date().toISOString(),
    };
  }

  getSummary(): Promise<AnalyticsSummaryDto> {
    return this.statisticsQuery.getOverview();
  }

  async getProductOrderMetrics(categoryId?: string, limit: number = 10): Promise<ProductOrderMetricDto[]> {
    return this.productRankingQuery.getProductRanking(categoryId, limit);
  }
}
