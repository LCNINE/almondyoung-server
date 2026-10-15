import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import {
  DeadLetterQueryService,
  DeadLetterRedriver,
  DiscardFailureDto,
  OutboxFailuresService,
  actorIdOf,
} from '@app/events';

/**
 * 이벤트 실패 출구 (#1016 7·8번, 스펙 §9). 전역 가드(admin·master)만 — 정체 보드와 같다.
 * 컨트롤러가 앱에 있는 이유: 앱마다 전역 가드가 달라 라이브러리가 인가를 고를 수 없다(#705).
 */
@ApiTags('Event Failures')
@Controller('event-failures')
export class EventFailuresController {
  constructor(
    private readonly deadLetters: DeadLetterQueryService,
    private readonly redriver: DeadLetterRedriver,
    private readonly outbox: OutboxFailuresService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '이벤트 실패 요약 — 안 푼 컨슈머 실패·outbox FAILED' })
  summary() {
    return this.deadLetters.summary();
  }

  @Get('dead-letters')
  @ApiOperation({ summary: '컨슈머 실패 — 순서 단위 목록(머리 + 뒤 보류 수)' })
  listDeadLetters(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.deadLetters.listSequences(limit, cursor);
  }

  @Get('dead-letters/:id')
  @ApiOperation({ summary: '컨슈머 실패 상세 — envelope·같은 순서·조치 기록' })
  deadLetterDetail(@Param('id', ParseIntPipe) id: number) {
    return this.deadLetters.detail(id);
  }

  @Post('dead-letters/redrive-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '컨슈머 실패 전체 다시 넣기 — 순서마다 한 번씩' })
  redriveAll(@User() user: unknown) {
    return this.redriver.redriveAll(actorIdOf(user));
  }

  @Post('dead-letters/:id/redrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이 행이 속한 순서를 처음부터 다시 넣는다(한 번만 시도)' })
  redriveDeadLetter(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.redriver.redrive(id, actorIdOf(user));
  }

  @Post('dead-letters/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '종결 — 머리면 뒤 보류가 이어서 흐른다' })
  discardDeadLetter(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.redriver.discard(id, actorIdOf(user), dto.reason);
  }

  @Get('outbox/failed')
  @ApiOperation({ summary: 'outbox FAILED 목록 — 같은 주문 뒤 대기 수 포함' })
  listOutbox(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.outbox.listFailed(limit, cursor);
  }

  @Get('outbox/:id')
  @ApiOperation({ summary: 'outbox 행 상세 — 페이로드·오류·조치 기록' })
  outboxDetail(@Param('id', ParseIntPipe) id: number) {
    return this.outbox.detail(id);
  }

  @Post('outbox/resend-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 전체 다시 보내기 — 오래된 순서로 한 번씩' })
  resendAllOutbox(@User() user: unknown) {
    return this.outbox.resendAll(actorIdOf(user));
  }

  @Post('outbox/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 다시 보내기(한 번만 시도)' })
  resendOutbox(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.outbox.resend(id, actorIdOf(user));
  }

  @Post('outbox/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 종결 — 같은 주문 뒤 행이 흐른다' })
  discardOutbox(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.outbox.discard(id, actorIdOf(user), dto.reason);
  }
}
