import { Module } from '@nestjs/common';
import { AttendanceStatisticsController } from './controllers/attendance-statistics.controller';
import { AttendanceStatisticsService } from './services/attendance-statistics.service';
import { AttendanceJobsService } from './services/attendance-jobs.service';
import { AttendanceRequestsController } from './controllers/attendance-requests.controller';
import { AttendanceRequestManager } from './services/attendance-request.manager';
import { AttendanceController } from './controllers/attendance.controller';
import { ActiveAttendanceStaffGuard } from './guards/active-attendance-staff.guard';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceService } from './services/attendance.service';
import { AttendanceCalendarService } from './services/attendance-calendar.service';

@Module({
  controllers: [AttendanceController, AttendanceRequestsController, AttendanceStatisticsController],
  providers: [
    AttendanceStatisticsService,
    AttendanceJobsService,
    AttendanceRepository,
    AttendanceService,
    AttendanceCalendarService,
    ActiveAttendanceStaffGuard,
    AttendanceRequestManager,
  ],
})
export class AttendanceModule {}
