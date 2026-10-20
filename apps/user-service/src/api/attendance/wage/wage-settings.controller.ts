import { MasterRoleGuard, RequirePermission, type JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type {
  MinimumWage,
  PayGroup,
  PayPolicy,
  WageRate,
  WageWorker,
  WageWorkerDetail,
  WorkSchedule,
} from '@packages/domain-types/attendance-wage';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import {
  CreateMinimumWageDto,
  CreatePayGroupDto,
  CreatePayPolicyDto,
  CreateWageRateDto,
  CreateWorkScheduleDto,
  SaveWorkerDto,
  UpdatePayGroupDto,
} from './dto/wage-settings.dto';
import { WageSettingsService } from './wage-settings.service';

// 옛 가드: 급여 권한은 첫 부여가 없다(= master 만) — 근태 통계와 같은 옛 가드로 맞춘다.
@Controller('attendance/wage')
@UseGuards(MasterRoleGuard, ActiveAttendanceStaffGuard)
export class WageSettingsController {
  constructor(private readonly service: WageSettingsService) {}

  @Get('groups')
  @RequirePermission('attendance.wage.read')
  groups(): Promise<PayGroup[]> {
    return this.service.groups();
  }

  @Post('groups')
  @RequirePermission('attendance.wage.write')
  createGroup(@CurrentUser() user: JwtPayload, @Body() dto: CreatePayGroupDto): Promise<PayGroup> {
    return this.service.createGroup(user.id, dto);
  }

  @Patch('groups/:id')
  @RequirePermission('attendance.wage.write')
  updateGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayGroupDto,
  ): Promise<PayGroup> {
    return this.service.updateGroup(user.id, id, dto);
  }

  @Get('groups/:id/policies')
  @RequirePermission('attendance.wage.read')
  policies(@Param('id', ParseUUIDPipe) id: string): Promise<PayPolicy[]> {
    return this.service.policies(id);
  }

  @Post('groups/:id/policies')
  @RequirePermission('attendance.wage.write')
  addPolicy(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePayPolicyDto,
  ): Promise<PayPolicy> {
    return this.service.addPolicy(user.id, id, dto);
  }

  @Get('workers')
  @RequirePermission('attendance.wage.read')
  workers(): Promise<WageWorker[]> {
    return this.service.workers();
  }

  @Get('workers/:userId')
  @RequirePermission('attendance.wage.read')
  worker(@Param('userId', ParseUUIDPipe) userId: string): Promise<WageWorkerDetail> {
    return this.service.worker(userId);
  }

  @Put('workers/:userId')
  @RequirePermission('attendance.wage.write')
  saveWorker(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SaveWorkerDto,
  ): Promise<WageWorkerDetail> {
    return this.service.saveWorker(user.id, userId, dto);
  }

  @Post('workers/:userId/rates')
  @RequirePermission('attendance.wage.write')
  addRate(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateWageRateDto,
  ): Promise<WageRate> {
    return this.service.addRate(user.id, userId, dto);
  }

  @Post('workers/:userId/schedules')
  @RequirePermission('attendance.wage.write')
  addSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: CreateWorkScheduleDto,
  ): Promise<WorkSchedule> {
    return this.service.addSchedule(user.id, userId, dto);
  }

  @Get('minimum-wages')
  @RequirePermission('attendance.wage.read')
  minimumWages(): Promise<MinimumWage[]> {
    return this.service.minimumWages();
  }

  @Post('minimum-wages')
  @RequirePermission('attendance.wage.write')
  addMinimumWage(@CurrentUser() user: JwtPayload, @Body() dto: CreateMinimumWageDto): Promise<MinimumWage> {
    return this.service.addMinimumWage(user.id, dto);
  }
}
