import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MasterRoleGuard } from '@app/authorization';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceStatisticsService } from '../services/attendance-statistics.service';

@Controller('attendance')
@UseGuards(MasterRoleGuard, ActiveAttendanceStaffGuard)
export class AttendanceStatisticsController {
  constructor(private readonly statistics: AttendanceStatisticsService) {}

  @Get('statistics/monthly')
  monthly(@Query('month') month: string = '') {
    return this.statistics.monthly(month);
  }
}
