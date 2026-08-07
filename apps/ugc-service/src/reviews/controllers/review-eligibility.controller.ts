import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { UgcInternalAuth } from '../../shared/decorators/internal-auth.decorator';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';
import { ReviewEligibilityListQueryDto } from '../dto/review-eligibility-query.dto';
import { CreateReviewEligibilityDto } from '../dto/create-review-eligibility.dto';
import { ReviewEligibilityResponseDto } from '../dto/review-eligibility-response.dto';
import { ReviewMapper } from '../mappers';
import { ReviewEligibilityService } from '../services/review-eligibility.service';

@ApiTags('Reviews')
@Controller('reviews/eligibilities')
export class ReviewEligibilityController {
  constructor(private readonly eligibilityService: ReviewEligibilityService) {}

  /**
   * 내부 서비스 전용: Medusa 구매확정(confirm-purchase) 시 서버에서 호출.
   *
   * `userId` 를 바디로 받아 그대로 믿는다 — 자격 → 리뷰 → 포인트 적립으로 이어지므로 무인증이면
   * 임의 사용자에게 포인트를 발행할 수 있다. `@Public()` 단독으로 두지 말 것.
   */
  @Post()
  @UgcInternalAuth()
  @ApiOperation({ summary: '구매확정 후 리뷰 작성 자격 등록 (내부 호출)' })
  async create(@Body() dto: CreateReviewEligibilityDto): Promise<ReviewEligibilityResponseDto[]> {
    const created = await this.eligibilityService.create(dto);
    return created.map((e) => ReviewMapper.toEligibilityResponse(e));
  }

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
