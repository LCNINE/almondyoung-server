import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';
import { ReviewEligibilityListQueryDto } from '../dto/review-eligibility-query.dto';
import { ReviewEligibilityResponseDto } from '../dto/review-eligibility-response.dto';
import { ReviewMapper } from '../mappers';
import { ReviewEligibilityService } from '../services/review-eligibility.service';

@ApiTags('Reviews')
@Controller('reviews/eligibilities')
export class ReviewEligibilityController {
  constructor(private readonly eligibilityService: ReviewEligibilityService) {}

  @Get()
  @ApiOperation({ summary: '내 리뷰 작성 자격 목록 조회' })
  @ApiQuery({
    name: 'productId',
    description: '상품 ID (UUID)',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'orderId',
    description: '주문 ID (UUID)',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'status',
    description: '자격 상태 필터 (기본값: available)',
    required: false,
    enum: ['available', 'consumed'],
  })
  @ApiQuery({
    name: 'page',
    description: '페이지 번호 (1부터 시작)',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    description: '페이지당 아이템 수',
    required: false,
    type: Number,
  })
  @ApiOkResponsePaginated(ReviewEligibilityResponseDto, {
    description: '리뷰 작성 자격 목록 조회 성공',
  })
  async list(
    @User('userId') userId: string,
    @Query() query: ReviewEligibilityListQueryDto,
  ): Promise<PaginatedResponseDto<ReviewEligibilityResponseDto>> {
    const result = await this.eligibilityService.listByUser(userId, query);
    return {
      ...result,
      data: result.data.map((e) => ReviewMapper.toEligibilityResponse(e)),
    };
  }
}
