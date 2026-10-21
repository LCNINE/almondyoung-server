import { type JwtPayload, MasterRoleGuard, PermissionCheckpoints, RequirePermission } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceRequestManager } from '../services/attendance-request.manager';
import { CancelRequestDto, CreateRequestDto, DecisionDto } from '../dto/attendance.dto';
import { legacyAttendanceManager } from '../attendance-authz';

@Controller('attendance')
@UseGuards(ActiveAttendanceStaffGuard)
export class AttendanceRequestsController {
  constructor(
    private readonly manager: AttendanceRequestManager,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @Get('requests')
  @RequirePermission('attendance.own.write')
  mine(@CurrentUser() user: JwtPayload) {
    return this.manager.list(user.id);
  }

  @Post('requests')
  @RequirePermission('attendance.own.write')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRequestDto) {
    return this.manager.create(user.id, dto);
  }

  @Get('requests/:id/history')
  @RequirePermission('attendance.own.write')
  history(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const canReadStaff = this.checkpoints.compare(
      'attendance.request_history',
      legacyAttendanceManager(user.roles),
      { roles: user.roles ?? [] },
      ['attendance.staff.read'],
    );
    return this.manager.history(user.id, canReadStaff, id);
  }

  @Post('requests/:id/cancel')
  @RequirePermission('attendance.own.write')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() input: CancelRequestDto) {
    return this.manager.cancel(user.id, id, input.version);
  }

  @Get('review')
  @UseGuards(MasterRoleGuard)
  @RequirePermission('attendance.request.review')
  review(@CurrentUser() user: JwtPayload) {
    return this.manager.list(user.id, true);
  }

  @Post('requests/:id/decision')
  @UseGuards(MasterRoleGuard)
  @RequirePermission('attendance.request.review')
  decide(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    const canReview = this.checkpoints.compare(
      'attendance.request_decision',
      legacyAttendanceManager(user.roles),
      { roles: user.roles ?? [] },
      ['attendance.request.review'],
    );
    return this.manager.decide(user.id, canReview, id, dto);
  }

  @Post('requests/:id/resubmit')
  @RequirePermission('attendance.own.write')
  resubmit(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRequestDto) {
    return this.manager.resubmit(user.id, id, dto);
  }
}
