import { RolesGuard, type JwtPayload, MasterRoleGuard } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  clockMinutes,
  isWorkDate,
  seoulDate,
  validatePlannedTimes,
  type AttendanceMe,
} from '@packages/domain-types/attendance';
import { attendanceAudit, attendancePreferences, attendanceWorksites } from '../../../../database/drizzle/schema';
import { AttendanceRepository, serializeSession } from '../repositories/attendance.repository';
import { ActiveAttendanceStaffGuard } from '../guards/active-attendance-staff.guard';
import { AttendanceService } from '../services/attendance.service';
import { AttendanceCalendarService } from '../services/attendance-calendar.service';
import { AttendanceSettingsDto, LeaveBatchDto, LeaveDayDto, PunchDto, WorksiteDto } from '../dto/attendance.dto';

@Controller('attendance')
@UseGuards(RolesGuard('admin', 'master'), ActiveAttendanceStaffGuard)
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly repo: AttendanceRepository,
    private readonly calendar: AttendanceCalendarService,
  ) {}

  @Get('me')
  async me(@CurrentUser() user: JwtPayload): Promise<AttendanceMe> {
    const today = seoulDate(new Date());

    const [session, settings, leaves, sites, staff] = await Promise.all([
      this.repo.withUserLock(
        user.id,
        async (tx) => (await this.repo.findOpen(tx, user.id)) ?? (await this.repo.findDay(tx, user.id, today)),
      ),
      this.repo.settings(user.id),
      this.calendar.list(today, today),
      this.repo.db.select().from(attendanceWorksites).where(eq(attendanceWorksites.active, true)),
      this.repo.staff(),
    ]);

    return {
      userId: user.id,
      name: staff.find((person) => person.userId === user.id)?.name ?? '',
      today,
      status: session ? (session.checkOut ? 'done' : 'working') : 'before',
      session: session ? serializeSession(session) : null,
      leave: leaves.find((item) => item.userId === user.id) ?? null,
      settings,
      worksites: sites.map((site) => ({ ...site, latitude: Number(site.latitude), longitude: Number(site.longitude) })),
      isMaster: user.roles.includes('master'),
    };
  }

  @Post('punch')
  punch(@CurrentUser() user: JwtPayload, @Body() dto: PunchDto) {
    return this.service.punch(user.id, dto);
  }

  @Get('records')
  async records(@CurrentUser() user: JwtPayload) {
    return (await this.repo.records(user.id)).map(serializeSession);
  }

  @Get('calendar')
  calendarList(@Query('from') from: string, @Query('to') to: string) {
    return this.calendar.list(from, to);
  }

  @Get('recommendations')
  recommendations(@CurrentUser() user: JwtPayload) {
    return this.calendar.recommendations(user.id);
  }

  @Post('leaves')
  saveLeaves(@CurrentUser() user: JwtPayload, @Body() dto: LeaveBatchDto) {
    return this.calendar.save(user.id, dto.days);
  }

  @Delete('leaves/:id')
  removeLeave(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(user.id, id);
  }

  @Put('leaves/:id')
  updateLeave(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveDayDto) {
    return this.calendar.update(user.id, id, dto);
  }

  @Get('overview')
  overview() {
    return this.calendar.overview();
  }

  @Put('settings')
  async saveSettings(@CurrentUser() user: JwtPayload, @Body() dto: AttendanceSettingsDto) {
    const message = validatePlannedTimes(dto.normalStart, dto.normalEnd);

    if (
      message ||
      clockMinutes(dto.inTime) === null ||
      clockMinutes(dto.outTime) === null ||
      (dto.skipDate && !isWorkDate(dto.skipDate))
    ) {
      throw new BadRequestException(message ?? '알림 시각과 날짜를 확인해 주세요.');
    }

    await this.repo.withUserLock(user.id, async (tx) => {
      await tx
        .insert(attendancePreferences)
        .values({ userId: user.id, settings: dto })
        .onConflictDoUpdate({ target: attendancePreferences.userId, set: { settings: dto, updatedAt: new Date() } });
    });

    return dto;
  }

  @Get('worksites')
  sites() {
    return this.repo.db.select().from(attendanceWorksites).where(eq(attendanceWorksites.active, true));
  }

  @Post('worksites')
  @UseGuards(MasterRoleGuard)
  async createSite(@CurrentUser() user: JwtPayload, @Body() dto: WorksiteDto) {
    if (dto.accuracyMeters >= dto.radiusMeters || !dto.name.trim()) {
      throw new BadRequestException('근무지 이름과 반경·정확도를 확인해 주세요.');
    }

    return this.repo.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(attendanceWorksites)
        .values({ ...dto, latitude: String(dto.latitude), longitude: String(dto.longitude) })
        .returning();

      await tx
        .insert(attendanceAudit)
        .values({ actorId: user.id, subjectId: user.id, kind: 'worksite.created', entityId: row.id, after: row });

      return row;
    });
  }
}
