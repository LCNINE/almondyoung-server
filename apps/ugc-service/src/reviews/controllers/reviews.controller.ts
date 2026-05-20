import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, Get, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { Public, RequireScopes, User } from '@app/authorization';
import { ReviewsService } from '../services/reviews.service';
import { CreateReviewDto } from '../dto/create-review.dto';
import { MyReviewListQueryDto } from '../dto/my-review-list-query.dto';
import { RatingSummaryQueryDto, RatingSummaryResponseDto } from '../dto/rating-summary.dto';
import { AdminReviewListQueryDto, ReviewListQueryDto } from '../dto/review-list-query.dto';
import { UpdateReviewDto } from '../dto/update-review.dto';
import { UpdateReviewStatusDto } from '../dto/update-review-status.dto';
import { CommentResponseDto } from '../dto/comment-response.dto';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';
import { ToggleReactionDto } from '../dto/toggle-reaction.dto';
import { ReviewMapper } from '../mappers';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: '리뷰 생성' })
  @ApiBody({ type: CreateReviewDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '리뷰 생성 성공',
    type: ReviewResponseDto,
  })
  async create(@User('userId') userId: string, @Body() dto: CreateReviewDto): Promise<ReviewResponseDto> {
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
  async list(@Query() query: ReviewListQueryDto): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const result = await this.reviewsService.listByProduct(query);
    return {
      ...result,
      data: result.data.map(ReviewMapper.toResponse),
    };
  }

  @Get('me')
  @ApiOperation({ summary: '내 리뷰 목록 조회' })
  @ApiQuery({
    name: 'productId',
    description: '상품 ID 필터 (UUID)',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'sort',
    description: '정렬 옵션 (기본값: latest)',
    required: false,
    enum: ['latest', 'oldest', 'rating_high', 'rating_low'],
  })
  @ApiQuery({
    name: 'period',
    description: '기간 필터 (기본값: all)',
    required: false,
    enum: ['6months', '1year', 'all'],
  })
  @ApiQuery({
    name: 'type',
    description: '리뷰 타입 필터 (기본값: all)',
    required: false,
    enum: ['all', 'photo', 'text'],
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
  @ApiOkResponsePaginated(ReviewResponseDto, {
    description: '내 리뷰 목록 조회 성공',
  })
  async listMine(
    @User('userId') userId: string,
    @Query() query: MyReviewListQueryDto,
  ): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const result = await this.reviewsService.listByUser(userId, query);
    return {
      ...result,
      data: result.data.map((r) => ReviewMapper.toResponse(r)),
    };
  }

  @Get('rating-summary')
  @Public()
  @ApiOperation({ summary: '상품별 레이팅 요약 조회' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '레이팅 요약 조회 성공',
    type: RatingSummaryResponseDto,
  })
  async ratingSummary(@Query() query: RatingSummaryQueryDto): Promise<RatingSummaryResponseDto> {
    return this.reviewsService.getRatingSummary(query.productId);
  }

  // ─── 관리자용 조회 ───

  @Get('admin/reviews')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '전체 리뷰 목록 조회 (관리자)' })
  @ApiQuery({
    name: 'status',
    description: '상태 필터 (미지정 시 deleted 제외)',
    required: false,
    enum: ['active', 'hidden', 'deleted'],
  })
  @ApiQuery({
    name: 'rating',
    description: '평점 필터 (1~5 또는 positive/negative)',
    required: false,
    enum: ['1', '2', '3', '4', '5', 'positive', 'negative'],
  })
  @ApiQuery({ name: 'productId', description: '상품 ID (UUID)', required: false, type: String })
  @ApiQuery({
    name: 'hasComment',
    description: '어드민 댓글 작성 여부 ("true"/"false")',
    required: false,
    enum: ['true', 'false'],
  })
  @ApiQuery({
    name: 'sort',
    description: '정렬 옵션',
    required: false,
    enum: ['latest', 'oldest', 'rating_high', 'rating_low'],
  })
  @ApiQuery({ name: 'q', description: '검색어 (본문, 작성자명)', required: false, type: String })
  @ApiQuery({ name: 'page', description: '페이지 번호', required: false, type: Number })
  @ApiQuery({ name: 'limit', description: '페이지당 아이템 수', required: false, type: Number })
  @ApiOkResponsePaginated(ReviewResponseDto, { description: '전체 리뷰 목록 조회 성공' })
  async listReviewsForAdmin(@Query() query: AdminReviewListQueryDto): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const result = await this.reviewsService.listAllForAdmin(query);
    return {
      ...result,
      data: result.data.map(ReviewMapper.toResponse),
    };
  }

  @Get('admin/reviews/:id')
  @RequireScopes('admin:ugc:read')
  @ApiOperation({ summary: '리뷰 상세 조회 (관리자)' })
  @ApiParam({ name: 'id', description: '리뷰 ID (UUID)' })
  @ApiResponse({ status: HttpStatus.OK, description: '리뷰 상세 조회 성공', type: ReviewResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async getReviewForAdmin(@Param('id') id: string): Promise<ReviewResponseDto> {
    const review = await this.reviewsService.getReviewForAdmin(id);
    return ReviewMapper.toResponse(review);
  }

  @Patch('admin/reviews/:id/status')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 상태 변경 (활성/숨김)' })
  @ApiParam({ name: 'id', description: '리뷰 ID (UUID)' })
  @ApiBody({ type: UpdateReviewStatusDto })
  @ApiResponse({ status: HttpStatus.OK, description: '상태 변경 성공', type: ReviewResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async updateReviewStatus(@Param('id') id: string, @Body() dto: UpdateReviewStatusDto): Promise<ReviewResponseDto> {
    const review = await this.reviewsService.updateStatus(id, dto.status);
    return ReviewMapper.toResponse(review);
  }

  @Delete('admin/reviews/:id')
  @RequireScopes('admin:ugc:modify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '리뷰 삭제 (관리자, soft delete)' })
  @ApiParam({ name: 'id', description: '리뷰 ID (UUID)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '리뷰 삭제 성공' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  async deleteByAdmin(@Param('id') id: string): Promise<void> {
    await this.reviewsService.deleteByAdmin(id);
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
  async remove(@User('userId') userId: string, @Param('id') id: string): Promise<void> {
    await this.reviewsService.remove(userId, id);
  }

  @Post(':id/reactions')
  @ApiOperation({ summary: '리뷰 반응 토글 (helpful, like, dislike)' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: ToggleReactionDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '반응 토글 성공',
    schema: {
      type: 'object',
      properties: {
        marked: { type: 'boolean', description: '현재 반응 표시 여부' },
        count: { type: 'number', description: '해당 반응 총 수' },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: '자기 리뷰에는 반응할 수 없음' })
  async toggleReaction(
    @User('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ToggleReactionDto,
  ): Promise<{ marked: boolean; count: number }> {
    return this.reviewsService.toggleReaction(userId, id, dto.type);
  }

  @Post(':id/comment')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 관리자 댓글 작성' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '댓글 작성 성공',
    type: CommentResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '리뷰를 찾을 수 없음' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: '이미 댓글이 존재함' })
  async createComment(
    @User('userId') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.reviewsService.createComment(adminUserId, id, dto);
    return ReviewMapper.toCommentResponse(comment);
  }

  @Patch(':id/comment')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '리뷰 관리자 댓글 수정' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiBody({ type: CreateCommentDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '댓글 수정 성공',
    type: CommentResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '댓글을 찾을 수 없음' })
  async updateComment(
    @User('userId') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.reviewsService.updateComment(adminUserId, id, dto);
    return ReviewMapper.toCommentResponse(comment);
  }

  @Delete(':id/comment')
  @RequireScopes('admin:ugc:modify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '리뷰 관리자 댓글 삭제' })
  @ApiParam({
    name: 'id',
    description: '리뷰 ID (UUID)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '댓글 삭제 성공' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '댓글을 찾을 수 없음' })
  async deleteComment(@Param('id') id: string): Promise<void> {
    await this.reviewsService.deleteComment(id);
  }
}
