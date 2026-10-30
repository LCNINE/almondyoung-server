import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '@app/authorization';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceStatisticsService } from '../services/attendance-statistics.service';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

@ServedTenantData()
@Controller('attendance')
@UseGuards(ActiveAttendanceStaffGuard)
export class AttendanceStatisticsController {
  constructor(private readonly statistics: AttendanceStatisticsService) {}

  @Get('statistics/monthly')
  @RequirePermission('attendance.statistics.read')
  monthly(@Query('month') month: string = '') {
    return this.statistics.monthly(month);
  }
}
