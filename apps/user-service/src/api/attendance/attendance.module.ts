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
import { WageMeController } from './wage/wage-me.controller';
import { WageSettingsController } from './wage/wage-settings.controller';
import { WageSettlementController } from './wage/wage-settlement.controller';
import { WageSettlementManager } from './wage/wage-settlement.manager';
import { WageSettlementReader } from './wage/wage-settlement.reader';
import { WageSettlementService } from './wage/wage-settlement.service';
import { WageSettingsManager } from './wage/wage-settings.manager';
import { WageSettingsReader } from './wage/wage-settings.reader';
import { WageSettingsService } from './wage/wage-settings.service';
import { WageRepository } from './wage/wage.repository';

@Module({
  controllers: [
    AttendanceController,
    AttendanceRequestsController,
    AttendanceStatisticsController,
    WageSettingsController,
    WageSettlementController,
    WageMeController,
  ],
  providers: [
    AttendanceStatisticsService,
    AttendanceJobsService,
    AttendanceRepository,
    AttendanceService,
    AttendanceCalendarService,
    ActiveAttendanceStaffGuard,
    AttendanceRequestManager,
    WageRepository,
    WageSettingsReader,
    WageSettingsManager,
    WageSettingsService,
    WageSettlementReader,
    WageSettlementManager,
    WageSettlementService,
  ],
})
export class AttendanceModule {}
