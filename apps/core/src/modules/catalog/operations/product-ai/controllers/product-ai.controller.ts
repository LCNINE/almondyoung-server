import { Body, Delete, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard, User } from '@app/authorization';
import {
  AppendProductAiMessageDto,
  CreateProductAiSessionDto,
  ListProductAiSessionsQueryDto,
  ListProductAiMessagesQueryDto,
  RespondProductAiDto,
  ProductAiSessionParamsDto,
  ProductAiMessageParamsDto,
  ProductAiFeedbackDto,
  RenameProductAiSessionDto,
} from '../dto/product-ai.dto';
import { ProductAiService } from '../services/product-ai.service';
import { ProductAiReplyService } from '../services/product-ai.reply.service';
import { ProductAiDraftService } from '../services/product-ai-draft.service';

@ApiTags('Product AI')
@UseGuards(RolesGuard('master', 'admin'))
@Controller('product-ai/sessions')
export class ProductAiController {
  constructor(
    private readonly service: ProductAiService,
    private readonly replies: ProductAiReplyService,
    private readonly drafts: ProductAiDraftService,
  ) {}

  @Post(':id/messages/:messageId/save-draft')
  @HttpCode(200)
  @ApiOperation({ summary: '미리보기의 상세페이지·SEO를 내 상품 초안에 저장 (발행하지 않음)' })
  saveDraft(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiMessageParamsDto,
    @Req() request: FastifyRequest,
  ) {
    return this.drafts.save(
      user.userId,
      params.id,
      params.messageId,
      {
        cookie: request.headers.cookie,
        authorization: request.headers.authorization,
      },
      { roles: user.roles },
    );
  }

  @Put(':id/title')
  @ApiOperation({ summary: '내 대화 제목 변경' })
  rename(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: RenameProductAiSessionDto,
  ) {
    return this.service.rename(user.userId, params.id, body.title);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '내 대화 소프트 삭제' })
  async remove(@User() user: { userId: string; roles?: string[] }, @Param() params: ProductAiSessionParamsDto) {
    await this.service.remove(user.userId, params.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: '현재 AI 답변 생성 중지' })
  cancel(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: RespondProductAiDto,
  ) {
    return this.replies.cancel(user.userId, params.id, body.messageId);
  }

  @Put(':id/messages/:messageId/feedback')
  @ApiOperation({ summary: '내 대화의 AI 답변 평가 저장/취소' })
  feedback(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiMessageParamsDto,
    @Body() body: ProductAiFeedbackDto,
  ) {
    return this.service.feedback(user.userId, params.id, params.messageId, body.rating);
  }

  @Post(':id/respond-stream')
  @ApiOperation({ summary: 'AI 답변 스트리밍. done은 저장 완료 후 전송' })
  async stream(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: RespondProductAiDto,
    @Res() reply: FastifyReply,
    @Req() request: FastifyRequest,
  ) {
    await this.service.get(user.userId, params.id);
    const abort = new AbortController();
    const onClose = () => abort.abort();
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.on('close', onClose);
    const emit = (event: object) => {
      if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      emit({ type: 'start' });
      const result = await this.replies.respond(user.userId, params.id, body.messageId, {
        signal: abort.signal,
        fileAuth: { cookie: request.headers.cookie, authorization: request.headers.authorization },
        roles: user.roles,
        onDelta: (text) => emit({ type: 'delta', text }),
      });
      emit({ type: 'done', status: result.status });
    } catch {
      emit({ type: 'error', message: '답변이 중단되었습니다. 저장된 대화를 확인하고 다시 시도해 주세요.' });
    } finally {
      reply.raw.off('close', onClose);
      reply.raw.end();
    }
  }

  @Post(':id/respond')
  @HttpCode(200)
  @ApiOperation({ summary: '저장된 사용자 메시지에 AI 답변 생성/재시도' })
  respond(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: RespondProductAiDto,
    @Req() request: FastifyRequest,
  ) {
    return this.replies.respond(user.userId, params.id, body.messageId, {
      fileAuth: { cookie: request.headers.cookie, authorization: request.headers.authorization },
      roles: user.roles,
    });
  }

  @Post()
  @ApiOperation({ summary: '상품등록 대화 작업 생성 (requestId로 중복 방지)' })
  create(@User() user: { userId: string; roles?: string[] }, @Body() body: CreateProductAiSessionDto) {
    return this.service.create(user.userId, body);
  }

  @Get()
  @ApiOperation({ summary: '내 상품등록 대화 작업 목록' })
  list(@User() user: { userId: string; roles?: string[] }, @Query() query: ListProductAiSessionsQueryDto) {
    return this.service.list(user.userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: '내 상품등록 작업 조회' })
  get(@User() user: { userId: string; roles?: string[] }, @Param() params: ProductAiSessionParamsDto) {
    return this.service.get(user.userId, params.id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: '대화 이력 조회 (after 순번 이후)' })
  messages(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Query() query: ListProductAiMessagesQueryDto,
  ) {
    return this.service.messages(user.userId, params.id, query);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: '사용자 메시지 저장. respond로 AI 답변을 요청한다.' })
  append(
    @User() user: { userId: string; roles?: string[] },
    @Param() params: ProductAiSessionParamsDto,
    @Body() body: AppendProductAiMessageDto,
    @Req() request: FastifyRequest,
  ) {
    return this.service.appendUserMessage(user.userId, params.id, body, {
      cookie: request.headers.cookie,
      authorization: request.headers.authorization,
    });
  }
}
