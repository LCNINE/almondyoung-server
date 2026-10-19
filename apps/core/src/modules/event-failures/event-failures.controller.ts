import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
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

  @RequirePermission('system.operations.read')
  @Get('summary')
  @ApiOperation({ summary: '이벤트 실패 요약 — 안 푼 컨슈머 실패·outbox FAILED' })
  summary() {
    return this.deadLetters.summary();
  }

  @RequirePermission('system.operations.read')
  @Get('dead-letters')
  @ApiOperation({ summary: '컨슈머 실패 — 순서 단위 목록(머리 + 뒤 보류 수). topic 으로 거를 수 있다' })
  listDeadLetters(@Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('topic') topic?: string) {
    return this.deadLetters.listSequences(limit, cursor, topic);
  }

  @RequirePermission('system.operations.read')
  @Get('dead-letters/:id')
  @ApiOperation({ summary: '컨슈머 실패 상세 — envelope·같은 순서·조치 기록' })
  deadLetterDetail(@Param('id', ParseIntPipe) id: number) {
    return this.deadLetters.detail(id);
  }

  @RequirePermission('system.operations.write')
  @Post('dead-letters/redrive-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '컨슈머 실패 전체 다시 넣기 — 순서마다 한 번씩. topic 을 주면 그 토픽만' })
  redriveAll(@User() user: unknown, @Query('topic') topic?: string) {
    return this.redriver.redriveAll(actorIdOf(user), topic);
  }

  @RequirePermission('system.operations.write')
  @Post('dead-letters/:id/redrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이 행이 속한 순서를 처음부터 다시 넣는다(한 번만 시도)' })
  redriveDeadLetter(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.redriver.redrive(id, actorIdOf(user));
  }

  @RequirePermission('system.operations.write')
  @Post('dead-letters/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '종결 — 머리면 뒤 보류가 이어서 흐른다' })
  discardDeadLetter(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.redriver.discard(id, actorIdOf(user), dto.reason);
  }

  @RequirePermission('system.operations.read')
  @Get('outbox/failed')
  @ApiOperation({ summary: 'outbox FAILED 목록 — 같은 주문 뒤 대기 수 포함' })
  listOutbox(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.outbox.listFailed(limit, cursor);
  }

  @RequirePermission('system.operations.read')
  @Get('outbox/:id')
  @ApiOperation({ summary: 'outbox 행 상세 — 페이로드·오류·조치 기록' })
  outboxDetail(@Param('id', ParseIntPipe) id: number) {
    return this.outbox.detail(id);
  }

  @RequirePermission('system.operations.write')
  @Post('outbox/resend-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 전체 다시 보내기 — 오래된 순서로 한 번씩' })
  resendAllOutbox(@User() user: unknown) {
    return this.outbox.resendAll(actorIdOf(user));
  }

  @RequirePermission('system.operations.write')
  @Post('outbox/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 다시 보내기(한 번만 시도)' })
  resendOutbox(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.outbox.resend(id, actorIdOf(user));
  }

  @RequirePermission('system.operations.write')
  @Post('outbox/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 종결 — 같은 주문 뒤 행이 흐른다' })
  discardOutbox(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.outbox.discard(id, actorIdOf(user), dto.reason);
  }
}
