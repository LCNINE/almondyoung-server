import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsHealthDto,
  AnalyticsSummaryDto,
} from './dto';
import {
  ProductOrderMetricDto,
  ProductRankingQueryDto,
} from '../product-ranking/api/dto';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Returns service status information.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy.',
    type: AnalyticsHealthDto,
  })
  getHealth(): AnalyticsHealthDto {
    return this.analyticsService.getHealth();
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Summary metrics',
    description: 'Returns a minimal analytics summary.',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary metrics response.',
    type: AnalyticsSummaryDto,
  })
  getSummary(): AnalyticsSummaryDto {
    return this.analyticsService.getSummary();
  }

  @Get('orders/products')
  @ApiOperation({
    summary: 'Product order metrics',
    description: 'Returns per-product order counts and quantities.',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Filter by category id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Product order metrics response.',
    type: [ProductOrderMetricDto],
  })
  getProductOrderMetrics(
    @Query() query: ProductRankingQueryDto,
  ): Promise<ProductOrderMetricDto[]> {
    return this.analyticsService.getProductOrderMetrics(query.categoryId);
  }
}
