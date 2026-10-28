import { type JwtPayload, PermissionCheckpoints, RequirePermission } from '@app/authorization';
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
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
import {
  AttendanceSettingsDto,
  LeaveBatchDto,
  LeaveDayDto,
  PunchDto,
  UpdateWorksiteDto,
  WorksiteDto,
} from '../dto/attendance.dto';

@Controller('attendance')
@UseGuards(ActiveAttendanceStaffGuard)
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly repo: AttendanceRepository,
    private readonly calendar: AttendanceCalendarService,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @Get('me')
  @RequirePermission('attendance.own.write')
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
      isMaster: this.checkpoints.check('attendance.manager_view', { roles: user.roles ?? [] }, [
        'attendance.staff.read',
      ]),
    };
  }

  @Post('punch')
  @RequirePermission('attendance.own.write')
  punch(@CurrentUser() user: JwtPayload, @Body() dto: PunchDto) {
    return this.service.punch(user.id, dto);
  }

  @Get('records')
  @RequirePermission('attendance.own.write')
  async records(
    @CurrentUser() user: JwtPayload,
    @Query('userId', new ParseUUIDPipe({ optional: true })) userId?: string,
  ) {
    if (
      userId &&
      userId !== user.id &&
      !this.checkpoints.check('attendance.staff_records', { roles: user.roles ?? [] }, ['attendance.staff.read'])
    ) {
      throw new ForbiddenException('다른 직원의 상세 기록은 마스터만 조회할 수 있어요.');
    }

    return (await this.repo.records(userId ?? user.id)).map(serializeSession);
  }

  @Get('calendar')
  @RequirePermission('attendance.own.write')
  calendarList(@Query('from') from: string, @Query('to') to: string) {
    return this.calendar.list(from, to);
  }

  @Get('recommendations')
  @RequirePermission('attendance.own.write')
  recommendations(@CurrentUser() user: JwtPayload) {
    return this.calendar.recommendations(user.id);
  }

  @Post('leaves')
  @RequirePermission('attendance.own.write')
  saveLeaves(@CurrentUser() user: JwtPayload, @Body() dto: LeaveBatchDto) {
    return this.calendar.save(user.id, dto.days, {
      recurrence: dto.recurrence,
      showDday: dto.showDday,
      reminderMinutes: dto.reminderMinutes,
    });
  }

  @Delete('leaves/:id')
  @RequirePermission('attendance.own.write')
  removeLeave(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(user.id, id);
  }

  @Put('leaves/:id')
  @RequirePermission('attendance.own.write')
  updateLeave(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LeaveDayDto) {
    return this.calendar.update(user.id, id, dto);
  }

  @Get('overview')
  @RequirePermission('attendance.own.write')
  overview() {
    return this.calendar.overview();
  }

  @Put('settings')
  @RequirePermission('attendance.own.write')
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
  @RequirePermission('attendance.own.write')
  async sites(@CurrentUser() user: JwtPayload) {
    const sites = await this.repo.db
      .select()
      .from(attendanceWorksites)
      .where(
        this.checkpoints.check('attendance.worksite_inactive', { roles: user.roles ?? [] }, ['attendance.staff.read'])
          ? undefined
          : eq(attendanceWorksites.active, true),
      );

    return sites.map((site) => ({
      ...site,
      latitude: Number(site.latitude),
      longitude: Number(site.longitude),
    }));
  }

  @Post('worksites')
  @RequirePermission('attendance.worksite.write')
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

  @Put('worksites/:id')
  @RequirePermission('attendance.worksite.write')
  async updateSite(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorksiteDto,
  ) {
    if (dto.accuracyMeters >= dto.radiusMeters || !dto.name.trim()) {
      throw new BadRequestException('근무지 이름과 반경·정확도를 확인해 주세요.');
    }

    return this.repo.db.transaction(async (tx) => {
      const [before] = await tx.select().from(attendanceWorksites).where(eq(attendanceWorksites.id, id)).for('update');

      if (!before || before.version !== dto.version) {
        throw new ConflictException('근무지 설정이 변경됐어요. 새로 확인한 뒤 다시 저장해 주세요.');
      }

      const [row] = await tx
        .update(attendanceWorksites)
        .set({
          name: dto.name,
          address: dto.address,
          latitude: String(dto.latitude),
          longitude: String(dto.longitude),
          radiusMeters: dto.radiusMeters,
          accuracyMeters: dto.accuracyMeters,
          active: dto.active,
          version: before.version + 1,
        })
        .where(and(eq(attendanceWorksites.id, id), eq(attendanceWorksites.version, dto.version)))
        .returning();

      await tx.insert(attendanceAudit).values({
        actorId: user.id,
        subjectId: user.id,
        kind: 'worksite.updated',
        entityId: id,
        before,
        after: row,
      });

      return { ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) };
    });
  }
}
