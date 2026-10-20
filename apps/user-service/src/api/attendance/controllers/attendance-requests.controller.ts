import { type JwtPayload, MasterRoleGuard, RolesGuard } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceRequestManager } from '../services/attendance-request.manager';
import { CancelRequestDto, CreateRequestDto, DecisionDto } from '../dto/attendance.dto';

@Controller('attendance')
@UseGuards(RolesGuard('admin', 'master'), ActiveAttendanceStaffGuard)
export class AttendanceRequestsController {
  constructor(private readonly manager: AttendanceRequestManager) {}

  @Get('requests')
  mine(@CurrentUser() user: JwtPayload) {
    return this.manager.list(user.id);
  }

  @Post('requests')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRequestDto) {
    return this.manager.create(user.id, dto);
  }

  @Get('requests/:id/history')
  history(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.manager.history(user.id, user.roles.includes('master'), id);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() input: CancelRequestDto) {
    return this.manager.cancel(user.id, id, input.version);
  }

  @Get('review')
  @UseGuards(MasterRoleGuard)
  review(@CurrentUser() user: JwtPayload) {
    return this.manager.list(user.id, true);
  }

  @Post('requests/:id/decision')
  @UseGuards(MasterRoleGuard)
  decide(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto) {
    return this.manager.decide(user.id, user.roles, id, dto);
  }

  @Post('requests/:id/resubmit')
  resubmit(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRequestDto) {
    return this.manager.resubmit(user.id, id, dto);
  }
}
