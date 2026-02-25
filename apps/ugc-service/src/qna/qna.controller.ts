import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public, RequireScopes, User } from '@app/authorization';
import { ApiOkResponsePaginated } from '@app/shared/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '@app/shared/dto';
import { QnaService } from './qna.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionListQueryDto } from './dto/question-list-query.dto';
import { CreateAnswerDto } from './dto/create-answer.dto';
import { AnswerResponseDto } from './dto/answer-response.dto';
import { QuestionResponseDto } from './dto/question-response.dto';
import { QnaMapper } from './mappers';

@ApiTags('Q&A')
@Controller('qna')
export class QnaController {
  constructor(private readonly qnaService: QnaService) {}

  // ─── 질문 ───

  @Post('questions')
  @ApiOperation({ summary: '질문 작성' })
  @ApiBody({ type: CreateQuestionDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: '질문 작성 성공',
    type: QuestionResponseDto,
  })
  async createQuestion(@User('userId') userId: string, @Body() dto: CreateQuestionDto): Promise<QuestionResponseDto> {
    const question = await this.qnaService.createQuestion(userId, dto);
    return QnaMapper.toQuestionResponse(question);
  }

  @Get('questions')
  @Public()
  @ApiOperation({ summary: '질문 목록 조회' })
  @ApiQuery({ name: 'productId', description: '상품 ID (UUID)', required: true, type: String })
  @ApiQuery({ name: 'sort', description: '정렬 옵션', required: false, enum: ['latest', 'oldest'] })
  @ApiQuery({ name: 'page', description: '페이지 번호', required: false, type: Number })
  @ApiQuery({ name: 'limit', description: '페이지당 아이템 수', required: false, type: Number })
  @ApiOkResponsePaginated(QuestionResponseDto, { description: '질문 목록 조회 성공' })
  async listQuestions(
    @Query() query: QuestionListQueryDto,
    @User('userId') userId?: string,
  ): Promise<PaginatedResponseDto<QuestionResponseDto>> {
    const result = await this.qnaService.listByProduct(query, userId ?? null, false);
    return {
      ...result,
      data: result.data.map((q) => QnaMapper.toQuestionResponse(q, { hideSecret: q.hideSecret })),
    };
  }

  @Get('questions/:id')
  @Public()
  @ApiOperation({ summary: '질문 상세 조회' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiResponse({ status: HttpStatus.OK, description: '질문 상세 조회 성공', type: QuestionResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '질문을 찾을 수 없음' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: '비밀글 접근 권한 없음' })
  async getQuestion(@Param('id') id: string, @User('userId') userId?: string): Promise<QuestionResponseDto> {
    const question = await this.qnaService.getQuestion(id, userId ?? null, false);
    return QnaMapper.toQuestionResponse(question);
  }

  @Patch('questions/:id')
  @ApiOperation({ summary: '질문 수정 (본인만)' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiBody({ type: UpdateQuestionDto })
  @ApiResponse({ status: HttpStatus.OK, description: '질문 수정 성공', type: QuestionResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '질문을 찾을 수 없음' })
  async updateQuestion(
    @User('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateQuestionDto,
  ): Promise<QuestionResponseDto> {
    const question = await this.qnaService.updateQuestion(userId, id, dto);
    return QnaMapper.toQuestionResponse(question);
  }

  @Delete('questions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '질문 삭제 (본인만, soft delete)' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '질문 삭제 성공' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '질문을 찾을 수 없음' })
  async deleteQuestion(@User('userId') userId: string, @Param('id') id: string): Promise<void> {
    await this.qnaService.deleteQuestion(userId, id);
  }

  // ─── 답변 (관리자) ───

  @Post('questions/:id/answer')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '답변 작성 (관리자)' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiBody({ type: CreateAnswerDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: '답변 작성 성공', type: AnswerResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '질문을 찾을 수 없음' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: '이미 답변이 존재함' })
  async createAnswer(
    @User('userId') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: CreateAnswerDto,
  ): Promise<AnswerResponseDto> {
    const answer = await this.qnaService.createAnswer(adminUserId, id, dto);
    return QnaMapper.toAnswerResponse(answer);
  }

  @Patch('questions/:id/answer')
  @RequireScopes('admin:ugc:modify')
  @ApiOperation({ summary: '답변 수정 (관리자)' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiBody({ type: CreateAnswerDto })
  @ApiResponse({ status: HttpStatus.OK, description: '답변 수정 성공', type: AnswerResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '답변을 찾을 수 없음' })
  async updateAnswer(
    @User('userId') adminUserId: string,
    @Param('id') id: string,
    @Body() dto: CreateAnswerDto,
  ): Promise<AnswerResponseDto> {
    const answer = await this.qnaService.updateAnswer(adminUserId, id, dto);
    return QnaMapper.toAnswerResponse(answer);
  }

  @Delete('questions/:id/answer')
  @RequireScopes('admin:ugc:modify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '답변 삭제 (관리자)' })
  @ApiParam({ name: 'id', description: '질문 ID (UUID)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: '답변 삭제 성공' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: '답변을 찾을 수 없음' })
  async deleteAnswer(@Param('id') id: string): Promise<void> {
    await this.qnaService.deleteAnswer(id);
  }
}
