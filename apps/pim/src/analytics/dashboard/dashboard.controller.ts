import { Controller, Get, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import {
  DashboardMetricsResponseDto,
  TopProductItemDto,
  SalesTrendResponseDto,
  TopProductsQueryDto,
  SalesTrendsQueryDto,
} from './dto';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('metrics')
  @ApiOperation({
    summary: '대시보드 메트릭 조회',
    description: '제품 통계 정보를 조회합니다. 전체 제품 수, 오늘 등록 제품 수, 상태별/승인상태별 제품 수 등을 포함합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '메트릭 조회 성공',
    type: DashboardMetricsResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async getMetrics(): Promise<DashboardMetricsResponseDto> {
    try {
      return await this.dashboardService.getMetrics();
    } catch (error) {
      throw new HttpException(
        `Failed to get dashboard metrics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('top-products')
  @ApiOperation({
    summary: '상위 제품 목록 조회',
    description: '활성화된 제품 중 상위 N개를 조회합니다. 현재는 최근 등록순이며, 향후 주문 서비스 연동 시 판매량 기준으로 변경됩니다.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '조회할 제품 수 (기본값: 5)',
    type: Number,
    example: 5,
  })
  @ApiResponse({
    status: 200,
    description: '상위 제품 조회 성공',
    type: [TopProductItemDto],
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (limit 값이 유효하지 않음)',
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async getTopProducts(@Query() query: TopProductsQueryDto): Promise<TopProductItemDto[]> {
    try {
      const limit = query.limit || 5;
      
      if (limit < 1 || limit > 100) {
        throw new Error('Limit must be between 1 and 100');
      }

      return await this.dashboardService.getTopProducts(limit);
    } catch (error) {
      if (error.message.includes('must be between')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to get top products: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('sales-trends')
  @ApiOperation({
    summary: '매출 트렌드 조회',
    description: '지정된 기간 동안의 매출 트렌드 데이터를 조회합니다. 현재는 주문 서비스 연동 대기중으로 빈 구조를 반환합니다.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '조회할 기간 (일 단위, 기본값: 30)',
    type: Number,
    example: 30,
  })
  @ApiResponse({
    status: 200,
    description: '매출 트렌드 조회 성공 (현재는 빈 데이터)',
    type: SalesTrendResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '잘못된 요청 (days 값이 유효하지 않음)',
  })
  @ApiResponse({
    status: 500,
    description: '서버 오류',
  })
  async getSalesTrends(@Query() query: SalesTrendsQueryDto): Promise<SalesTrendResponseDto> {
    try {
      const days = query.days || 30;
      
      if (days < 1 || days > 365) {
        throw new Error('Days must be between 1 and 365');
      }

      return await this.dashboardService.getSalesTrends(days);
    } catch (error) {
      if (error.message.includes('must be between')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        `Failed to get sales trends: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

