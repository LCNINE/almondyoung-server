import { Controller, Get, Query, UseGuards, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, User } from '@app/authorization';
import { AnalyticsService } from './analytics.service';
import { AnalyticsHealthDto, AnalyticsSummaryDto } from './dto';
import { ProductOrderMetricDto, ProductRankingQueryDto } from '../product-ranking/api/dto';
import { FrequentlyPurchasedDto, FrequentlyPurchasedQueryDto } from '../user-purchase/api/dto';
import { UserPurchaseQuery } from '../user-purchase/read-model/user-purchase.query';

@ApiTags('Analytics')
@Controller()
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly userPurchaseQuery: UserPurchaseQuery,
  ) { }

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

  @Get('best-product')
  @ApiOperation({
    summary: 'Best product metrics',
    description: 'Returns per-product order counts and quantities for best products.',
  })
  @ApiQuery({
    name: 'categoryId',
    required: false,
    description: 'Filter by category id.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of results to return (default: 10, max: 100).',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Product order metrics response.',
    type: [ProductOrderMetricDto],
  })
  getProductOrderMetrics(@Query() query: ProductRankingQueryDto): Promise<ProductOrderMetricDto[]> {
    return this.analyticsService.getProductOrderMetrics(query.categoryId, query.limit);
  }

  @Get('frequently-purchased')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '자주 산 상품 목록 조회',
    description: '로그인한 사용자가 자주 구매한 상품 목록을 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '자주 산 상품 목록',
    type: [FrequentlyPurchasedDto],
  })
  @ApiResponse({
    status: 401,
    description: '인증 필요',
  })
  async getFrequentlyPurchased(
    @User() user: { userId: string },
    @Query() query: FrequentlyPurchasedQueryDto,
  ): Promise<FrequentlyPurchasedDto[]> {
    try {
      return await this.userPurchaseQuery.getFrequentlyPurchased(user.userId, query.limit);
    } catch (e) {
      const msg = ((e as Error)?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException((e as Error).message);
      if (msg.match(/already|invalid|failed|required|exceed/)) throw new BadRequestException((e as Error).message);
      throw new InternalServerErrorException((e as Error).message);
    }
  }
}
