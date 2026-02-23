import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Get,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import { Public, User } from '@app/authorization';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewListQueryDto } from './dto/review-list-query.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import { ReviewMapper } from './mappers';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) { }

  @Post()
  @ApiOperation({ summary: '리뷰 생성' })
  @ApiBody({ type: CreateReviewDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '리뷰 생성 성공',
    type: ReviewResponseDto,
  })
  async create(
    @User('userId') userId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.reviewsService.create(userId, dto);
    return ReviewMapper.toResponse(review);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: '리뷰 목록 조회' })
  @ApiQuery({
    name: 'productId',
    description: '상품 ID (UUID)',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'rating',
    description: '평점 필터 (1~5 또는 positive/negative)',
    required: false,
    enum: ['1', '2', '3', '4', '5', 'positive', 'negative'],
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
  @ApiQuery({
    name: 'sort',
    description: '정렬 옵션 (기본값: latest)',
    required: false,
    enum: ['latest', 'oldest', 'rating_high', 'rating_low'],
  })
  @ApiOkResponsePaginated(ReviewResponseDto, {
    description: '리뷰 목록 조회 성공',
  })
  async list(
    @Query() query: ReviewListQueryDto,
  ): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const result = await this.reviewsService.listByProduct(query);
    return {
      ...result,
      data: result.data.map(ReviewMapper.toResponse),
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: '리뷰 수정' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: UpdateReviewDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '리뷰 수정 성공',
    type: ReviewResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async update(
    @User('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.reviewsService.update(userId, id, dto);
    return ReviewMapper.toResponse(review);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '리뷰 삭제' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '리뷰 삭제 성공' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async remove(
    @User('userId') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.reviewsService.remove(userId, id);
  }

  @Post(':id/helpful')
  @ApiOperation({ summary: '리뷰 도움이 됨 토글' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '도움이 됨 토글 성공',
    schema: {
      type: 'object',
      properties: {
        marked: { type: 'boolean', description: '현재 도움이 됨 표시 여부' },
        helpfulCount: { type: 'number', description: '총 도움이 됨 수' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async toggleHelpful(
    @User('userId') userId: string,
    @Param('id') id: string,
  ): Promise<{ marked: boolean; helpfulCount: number }> {
    return this.reviewsService.toggleHelpful(userId, id);
  }
}
