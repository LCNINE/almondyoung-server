import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import {
  appendProductAiMessageSchema,
  createProductAiSessionSchema,
  productAiListQuerySchema,
  productAiMessagesQuerySchema,
  productAiSessionIdSchema,
  type AppendProductAiMessageInput,
  type CreateProductAiSessionInput,
  type ListProductAiSessionsQuery,
  type ListProductAiMessagesQuery,
} from './product-ai.schema';
import { ProductAiService } from './product-ai.service';

@ApiTags('Product AI')
@UseGuards(RolesGuard('master', 'admin'))
@Controller('product-ai/sessions')
export class ProductAiController {
  constructor(private readonly service: ProductAiService) {}

  @Post()
  @ApiOperation({ summary: '상품등록 대화 작업 생성 (requestId로 중복 방지)' })
  create(
    @User() user: { userId: string },
    @Body(new ZodValidationPipe(createProductAiSessionSchema)) body: CreateProductAiSessionInput,
  ) {
    return this.service.create(user.userId, body);
  }

  @Get()
  @ApiOperation({ summary: '내 상품등록 대화 작업 목록' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  list(
    @User() user: { userId: string },
    @Query(new ZodValidationPipe(productAiListQuerySchema)) query: ListProductAiSessionsQuery,
  ) {
    return this.service.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 상품등록 작업 조회' })
  get(@User() user: { userId: string }, @Param('id', new ZodValidationPipe(productAiSessionIdSchema)) id: string) {
    return this.service.get(user.userId, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '대화 이력 조회 (after 순번 이후)' })
  @ApiQuery({ name: 'after', required: false, type: Number, example: 0 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  messages(
    @User() user: { userId: string },
    @Param('id', new ZodValidationPipe(productAiSessionIdSchema)) id: string,
    @Query(new ZodValidationPipe(productAiMessagesQuerySchema)) query: ListProductAiMessagesQuery,
  ) {
    return this.service.messages(user.userId, id, query);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: '사용자 메시지 저장. AI 응답 생성은 후속 단계에서 연결한다.' })
  append(
    @User() user: { userId: string },
    @Param('id', new ZodValidationPipe(productAiSessionIdSchema)) id: string,
    @Body(new ZodValidationPipe(appendProductAiMessageSchema)) body: AppendProductAiMessageInput,
  ) {
    return this.service.appendUserMessage(user.userId, id, body);
  }
}
