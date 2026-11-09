import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { RequirePermission, User } from '@app/authorization';
import { actorIdOf } from '@app/events';
import { GlobalExceptionFilter } from '@app/shared';
import { ReservationReconcileRunsService } from '../services/reservation-projection/reservation-reconcile-runs.service';

export class CloseReconcileRunDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reason!: string;
}

/** «Medusa 예약 대사 멈춤» (#1247). 인가는 전역 가드 — 어긋남 목록 컨트롤러와 같다. */
@ApiTags('adapter-reservation-reconcile-runs')
@UseFilters(GlobalExceptionFilter)
@Controller('adapter/reservation-reconcile-runs')
export class ReservationReconcileRunsController {
  constructor(private readonly service: ReservationReconcileRunsService) {}

  @RequirePermission('channel.account.read')
  @Get()
  @ApiOperation({ summary: '멈춘(열린) 예약 대사 회차와 마지막 회차' })
  async overview() {
    return { data: await this.service.overview() };
  }

  @RequirePermission('order.order.write')
  @Post(':id/apply')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '확인했으니 고치기 — 한도 없이 도는 회차를 뒤에서 시작하고 그 회차(running)를 202 로 돌려준다',
    description: '도는 회차가 있으면 409. 새 회차가 applied 로 끝나면 원래 회차를 닫는다.',
  })
  async apply(@Param('id', ParseUUIDPipe) id: string, @User() user: unknown) {
    return { data: await this.service.apply(id, actorIdOf(user) ?? 'unknown') };
  }

  @RequirePermission('order.order.write')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '사유를 남기고 종결' })
  async close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseReconcileRunDto, @User() user: unknown) {
    return { data: await this.service.close(id, actorIdOf(user) ?? 'unknown', dto.reason) };
  }
}
