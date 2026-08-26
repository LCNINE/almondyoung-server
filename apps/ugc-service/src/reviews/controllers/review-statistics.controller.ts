import { BadRequestException, Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes } from '@app/authorization';
import { AdminReviewStatisticsQueryDto, AdminReviewStatisticsResponseDto } from '../dto/review-statistics.dto';
import { ReviewStatisticsService } from '../services/review-statistics.service';

/**
 * 관리자 리뷰 통계. admin-web 프록시를 통해서만 호출된다.
 * 전역 JwtAuthGuard + ScopeGuard 아래에서 admin:ugc:read 스코프를 강제한다 —
 * 이 앱의 다른 관리자 라우트(/reviews/admin/reviews)와 같은 짝.
 */
@ApiTags('Reviews')
@Controller('reviews/admin/statistics')
export class ReviewStatisticsController {
  constructor(private readonly reviewStatisticsService: ReviewStatisticsService) {}

  @Get()
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '리뷰 통계 (관리자)' })
  @ApiResponse({ status: HttpStatus.OK, description: '리뷰 통계 조회 성공', type: AdminReviewStatisticsResponseDto })
  async getStatistics(@Query() query: AdminReviewStatisticsQueryDto): Promise<AdminReviewStatisticsResponseDto> {
    if (query.from > query.to) {
      throw new BadRequestException(`조회 기간이 뒤집혔습니다: ${query.from} > ${query.to}`);
    }
    return this.reviewStatisticsService.getStatistics(query.from, query.to, query.limit);
  }
}
