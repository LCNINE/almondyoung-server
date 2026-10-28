import { RequirePermission, type JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
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
  UpdateMinimumWageDto,
  UpdatePayGroupDto,
  UpdatePayPolicyDto,
  UpdateWageRateDto,
  UpdateWorkScheduleDto,
} from './dto/wage-settings.dto';
import { WageSettingsService } from './wage-settings.service';

@Controller('attendance/wage')
@UseGuards(ActiveAttendanceStaffGuard)
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

  @Delete('groups/:id')
  @RequirePermission('attendance.wage.write')
  deleteGroup(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.deleteGroup(user.id, id);
  }

  @Patch('groups/:id/policies/:policyId')
  @RequirePermission('attendance.wage.write')
  updatePolicy(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
    @Body() dto: UpdatePayPolicyDto,
  ): Promise<PayPolicy> {
    return this.service.updatePolicy(user.id, id, policyId, dto);
  }

  @Delete('groups/:id/policies/:policyId')
  @RequirePermission('attendance.wage.write')
  deletePolicy(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
  ): Promise<void> {
    return this.service.deletePolicy(user.id, id, policyId);
  }

  @Delete('workers/:userId')
  @RequirePermission('attendance.wage.write')
  removeWorker(@CurrentUser() user: JwtPayload, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.service.removeWorker(user.id, userId);
  }

  @Patch('workers/:userId/rates/:rateId')
  @RequirePermission('attendance.wage.write')
  updateRate(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @Body() dto: UpdateWageRateDto,
  ): Promise<WageRate> {
    return this.service.updateRate(user.id, userId, rateId, dto);
  }

  @Delete('workers/:userId/rates/:rateId')
  @RequirePermission('attendance.wage.write')
  deleteRate(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
  ): Promise<void> {
    return this.service.deleteRate(user.id, userId, rateId);
  }

  @Patch('workers/:userId/schedules/:scheduleId')
  @RequirePermission('attendance.wage.write')
  updateSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() dto: UpdateWorkScheduleDto,
  ): Promise<WorkSchedule> {
    return this.service.updateSchedule(user.id, userId, scheduleId, dto);
  }

  @Delete('workers/:userId/schedules/:scheduleId')
  @RequirePermission('attendance.wage.write')
  deleteSchedule(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ): Promise<void> {
    return this.service.deleteSchedule(user.id, userId, scheduleId);
  }

  @Patch('minimum-wages/:effectiveFrom')
  @RequirePermission('attendance.wage.write')
  updateMinimumWage(
    @CurrentUser() user: JwtPayload,
    @Param('effectiveFrom') effectiveFrom: string,
    @Body() dto: UpdateMinimumWageDto,
  ): Promise<MinimumWage> {
    return this.service.updateMinimumWage(user.id, effectiveFrom, dto);
  }

  @Delete('minimum-wages/:effectiveFrom')
  @RequirePermission('attendance.wage.write')
  deleteMinimumWage(@CurrentUser() user: JwtPayload, @Param('effectiveFrom') effectiveFrom: string): Promise<void> {
    return this.service.deleteMinimumWage(user.id, effectiveFrom);
  }
}
