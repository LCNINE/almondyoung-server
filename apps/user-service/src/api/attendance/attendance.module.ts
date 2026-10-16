import { Module } from '@nestjs/common';
import { AttendanceRequestsController } from './controllers/attendance-requests.controller';
import { AttendanceRequestManager } from './services/attendance-request.manager';
import { AttendanceController } from './controllers/attendance.controller';
import { ActiveAttendanceStaffGuard } from './guards/active-attendance-staff.guard';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceService } from './services/attendance.service';
import { AttendanceCalendarService } from './services/attendance-calendar.service';

@Module({
  controllers: [AttendanceController, AttendanceRequestsController],
  providers: [
    AttendanceRepository,
    AttendanceService,
    AttendanceCalendarService,
    ActiveAttendanceStaffGuard,
    AttendanceRequestManager,
  ],
})
export class AttendanceModule {}
