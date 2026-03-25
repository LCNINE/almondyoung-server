import { Injectable, NotImplementedException } from '@nestjs/common';
import { AnalyticsHealthDto, AnalyticsSummaryDto } from './dto';
import { ProductOrderMetricDto } from '../product-ranking/api/dto';
import { ProductRankingQuery } from '../product-ranking/read-model/product-ranking.query';

@Injectable()
export class AnalyticsService {
  constructor(private readonly productRankingQuery: ProductRankingQuery) {}

  getHealth(): AnalyticsHealthDto {
    return {
      status: 'ok',
      service: 'analytics',
      timestamp: new Date().toISOString(),
    };
  }

  getSummary(): AnalyticsSummaryDto {
    throw new NotImplementedException('TODO: 뭘 리턴하게 할지 고민중');
  }

  async getProductOrderMetrics(categoryId?: string, limit: number = 10): Promise<ProductOrderMetricDto[]> {
    return this.productRankingQuery.getProductRanking(categoryId, limit);
  }
}
