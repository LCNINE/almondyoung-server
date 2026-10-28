import { BadRequestException, Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@app/authorization';
import { AdminReviewStatisticsQueryDto, AdminReviewStatisticsResponseDto } from '../dto/review-statistics.dto';
import { ReviewStatisticsService } from '../services/review-statistics.service';

/**
 * 관리자 리뷰 통계. admin-web 프록시를 통해서만 호출된다.
 * 전역 JwtAuthGuard 뒤에서 PermissionGuard 가 `cs.review.read` 로 판정한다.
 */
@ApiTags('Reviews')
@Controller('reviews/admin/statistics')
export class ReviewStatisticsController {
  constructor(private readonly reviewStatisticsService: ReviewStatisticsService) {}

  @RequirePermission('cs.review.read')
  @Get()
  @ApiOperation({ summary: '리뷰 통계 (관리자)' })
  @ApiResponse({ status: HttpStatus.OK, description: '리뷰 통계 조회 성공', type: AdminReviewStatisticsResponseDto })
  async getStatistics(@Query() query: AdminReviewStatisticsQueryDto): Promise<AdminReviewStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.reviewStatisticsService.getStatistics(
      query.from,
      query.to,
      query.limit,
      query.lowRatedPage,
      query.topProductsPage,
    );
  }
}
