import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { RequirePermission, User } from '@app/authorization';
import { actorIdOf } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { ChannelOrderReconcileService } from '../services/order-reconcile/channel-order-reconcile.service';
import type { FindingStatus } from '../services/order-reconcile/order-reconcile.types';

export class CloseFindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  memo!: string;
}

const STATUSES: readonly FindingStatus[] = ['open', 'resolved', 'closed'];
/** 없으면 open, `all` 이면 전부(undefined), 모르는 값은 400 — 조용히 «전부»로 읽지 않는다. */
const parseStatus = (value?: string): FindingStatus | undefined => {
  if (value === undefined || value === '') return 'open';
  if (value === 'all') return undefined;
  const status = STATUSES.find((candidate) => candidate === value);
  if (!status) throw new BadRequestException(`Unknown status: ${value}`);
  return status;
};
const clampInt = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

/** «채널과 어긋남» (#1016 45번 스펙 §8). 인가는 전역 `JwtAuthGuard`·`PermissionGuard` — 격리 컨트롤러와 같다. */
@ApiTags('adapter-order-reconcile-findings')
@UseFilters(GlobalExceptionFilter)
@Controller('adapter/order-reconcile-findings')
export class OrderReconcileFindingsController {
  constructor(private readonly service: ChannelOrderReconcileService) {}

  @RequirePermission('channel.account.read')
  @Get()
  @ApiOperation({ summary: '채널과 어긋난 주문 목록 (기본 open)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'resolved', 'closed', 'all'] })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async list(@Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const data = await this.service.list({
      status: parseStatus(status),
      limit: clampInt(limit, 50, 200),
      offset: clampInt(offset, 0, Number.MAX_SAFE_INTEGER),
    });
    return { success: true, data };
  }

  // `:id` 보다 먼저 선언해야 한다 — 뒤에 두면 'summary' 가 id 로 잡힌다.
  @RequirePermission('channel.account.read')
  @Get('summary')
  @ApiOperation({ summary: '채널과 어긋남 요약 (정체 보드 0단계)' })
  async summary() {
    return { success: true, data: await this.service.summary(), timestamp: new Date().toISOString() };
  }

  @RequirePermission('order.order.write')
  @Post(':id/redeliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '사람의 [다시 배달] — 창·모드와 무관하게 한 번' })
  redeliver(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.redeliverFinding(id);
  }

  @RequirePermission('order.order.write')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '메모를 남기고 종결' })
  async close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseFindingDto, @User() user: unknown) {
    return { data: await this.service.closeFinding(id, actorIdOf(user), dto.memo) };
  }
}
