import { RequirePermission, type JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import type {
  PayGroup,
  SettlementRecord,
  SettlementResult,
  SettlementSummary,
  WageDecisions,
} from '@packages/domain-types/attendance-wage';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import {
  ConfirmSettlementDto,
  DecideAbsenceDto,
  DecideOvertimeDto,
  ReopenSettlementDto,
  SettlementListQueryDto,
  WagePeriodQueryDto,
} from './dto/wage-settlement.dto';
import { WageSettlementService } from './wage-settlement.service';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

@ServedTenantData()
@Controller('attendance/wage')
@UseGuards(ActiveAttendanceStaffGuard)
export class WageSettlementController {
  constructor(private readonly service: WageSettlementService) {}

  /** 판정 화면의 그룹 고르기 — 급여 조회 권한 없이 판정만 하는 사람도 쓴다(금액·규칙은 담지 않는다). */
  @Get('decisions/groups')
  @RequirePermission('attendance.request.review')
  decisionGroups(): Promise<PayGroup[]> {
    return this.service.groups();
  }

  @Get('decisions')
  @RequirePermission('attendance.request.review')
  decisions(@Query() query: WagePeriodQueryDto): Promise<WageDecisions> {
    return this.service.decisions(query.groupId, query.paydayMonth);
  }

  @Put('overtime/:userId/:workDate')
  @RequirePermission('attendance.request.review')
  decideOvertime(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('workDate') workDate: string,
    @Body() dto: DecideOvertimeDto,
  ): Promise<void> {
    return this.service.decideOvertime(user.id, userId, workDate, dto);
  }

  @Put('absences/:userId/:workDate')
  @RequirePermission('attendance.request.review')
  decideAbsence(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('workDate') workDate: string,
    @Body() dto: DecideAbsenceDto,
  ): Promise<void> {
    return this.service.decideAbsence(user.id, userId, workDate, dto);
  }

  @Delete('overtime/:userId/:workDate')
  @RequirePermission('attendance.request.review')
  clearOvertime(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('workDate') workDate: string,
  ): Promise<void> {
    return this.service.clearDecision(user.id, 'overtime', userId, workDate);
  }

  @Delete('absences/:userId/:workDate')
  @RequirePermission('attendance.request.review')
  clearAbsence(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('workDate') workDate: string,
  ): Promise<void> {
    return this.service.clearDecision(user.id, 'absence', userId, workDate);
  }

  @Get('settlements/preview')
  @RequirePermission('attendance.wage.read')
  preview(@Query() query: WagePeriodQueryDto): Promise<SettlementResult> {
    return this.service.preview(query.groupId, query.paydayMonth);
  }

  @Get('settlements/preview/export')
  @RequirePermission('attendance.wage.export')
  exportPreview(@CurrentUser() user: JwtPayload, @Query() query: WagePeriodQueryDto): Promise<SettlementResult> {
    return this.service.exportPreview(user.id, query.groupId, query.paydayMonth);
  }

  @Get('settlements')
  @RequirePermission('attendance.wage.read')
  settlements(@Query() query: SettlementListQueryDto): Promise<SettlementSummary[]> {
    return this.service.settlements(query.groupId);
  }

  @Get('settlements/:id')
  @RequirePermission('attendance.wage.read')
  settlement(@Param('id', ParseUUIDPipe) id: string): Promise<SettlementRecord> {
    return this.service.settlement(id);
  }

  @Get('settlements/:id/export')
  @RequirePermission('attendance.wage.export')
  exportSettlement(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<SettlementRecord> {
    return this.service.exportSettlement(user.id, id);
  }

  @Post('settlements')
  @RequirePermission('attendance.wage.write')
  confirm(@CurrentUser() user: JwtPayload, @Body() dto: ConfirmSettlementDto): Promise<SettlementRecord> {
    return this.service.confirm(user.id, dto);
  }

  @Post('settlements/:id/reopen')
  @RequirePermission('attendance.wage.write')
  reopen(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReopenSettlementDto,
  ): Promise<SettlementRecord> {
    return this.service.reopen(user.id, id, dto);
  }
}
