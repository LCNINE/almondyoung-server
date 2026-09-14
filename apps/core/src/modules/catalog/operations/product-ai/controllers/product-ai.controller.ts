import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import {
  AppendProductAiMessageDto,
  CreateProductAiSessionDto,
  ListProductAiSessionsQueryDto,
  ListProductAiMessagesQueryDto,
  RespondProductAiDto,
  ProductAiSessionParamsDto,
} from '../dto/product-ai.dto';
import { ProductAiService } from '../services/product-ai.service';
import { ProductAiReplyService } from '../services/product-ai.reply.service';

@ApiTags('Product AI')
@UseGuards(RolesGuard('master', 'admin'))
@Controller('product-ai/sessions')
export class ProductAiController {
  constructor(
    private readonly service: ProductAiService,
    private readonly replies: ProductAiReplyService,
  ) {}

  @Post(':id/respond')
  @HttpCode(200)
  @ApiOperation({ summary: '저장된 사용자 메시지에 AI 답변 생성/재시도' })
  respond(
    @User() user: { userId: string },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: RespondProductAiDto,
  ) {
    return this.replies.respond(user.userId, params.id, body.messageId);
  }

  @Post()
  @ApiOperation({ summary: '상품등록 대화 작업 생성 (requestId로 중복 방지)' })
  create(@User() user: { userId: string }, @Body() body: CreateProductAiSessionDto) {
    return this.service.create(user.userId, body);
  }

  @Get()
  @ApiOperation({ summary: '내 상품등록 대화 작업 목록' })
  list(@User() user: { userId: string }, @Query() query: ListProductAiSessionsQueryDto) {
    return this.service.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 상품등록 작업 조회' })
  get(@User() user: { userId: string }, @Param() params: ProductAiSessionParamsDto) {
    return this.service.get(user.userId, params.id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '대화 이력 조회 (after 순번 이후)' })
  messages(
    @User() user: { userId: string },
    @Param() params: ProductAiSessionParamsDto,
    @Query() query: ListProductAiMessagesQueryDto,
  ) {
    return this.service.messages(user.userId, params.id, query);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: '사용자 메시지 저장. respond로 AI 답변을 요청한다.' })
  append(
    @User() user: { userId: string },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: AppendProductAiMessageDto,
  ) {
    return this.service.appendUserMessage(user.userId, params.id, body);
  }
}
