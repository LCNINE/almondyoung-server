import { CronOnce } from '@app/cron-once';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { seoulClock, seoulDate, type AttendanceSettings, type LeaveType } from '@packages/domain-types/attendance';
import {
  attendanceAudit,
  attendanceJobs,
  attendanceLeaves,
  attendanceRequests,
  attendanceSessions,
  roles,
  userRoleAssignments,
  users,
} from '../../../../database/drizzle/schema';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { attendanceAiResponseSchema, unwrapAttendanceResponse } from '@packages/domain-types/attendance-review';
import { dueLeaveReminders, LEAVE_REMINDER_GRACE_MS, MAX_LEAVE_REMINDER_MINUTES } from './leave-reminders';

interface ReminderContext {
  now: Date;
  date: string;
  clock: string;
  settings: AttendanceSettings;
  leave: { type: LeaveType; start: string | null; end: string | null } | null;
  hasTodayRecord: boolean;
  hasOpenSession: boolean;
}

export function reminderDue(kind: 'in' | 'out', context: ReminderContext): boolean {
  const { settings, date, clock, leave, now, hasOpenSession, hasTodayRecord } = context;
  const weekday = new Date(now.getTime() + 9 * 3600000).getUTCDay();

  if (settings.skipDate === date || !settings.weekdays.includes(weekday) || leave?.type === 'full') {
    return false;
  }

  if (kind === 'in' && (!settings.inEnabled || hasTodayRecord || hasOpenSession)) {
    return false;
  }

  if (kind === 'out' && (!settings.outEnabled || !hasOpenSession)) {
    return false;
  }

  const target = leave ? (kind === 'in' ? leave.start : leave.end) : kind === 'in' ? settings.inTime : settings.outTime;

  return target === clock;
}

@Injectable()
export class AttendanceJobsService {
  private readonly logger = new Logger(AttendanceJobsService.name);

  constructor(private readonly repo: AttendanceRepository) {}

  @CronOnce('*/30 * * * * *', { name: 'attendance-jobs', timeZone: 'Asia/Seoul' })
  async tick() {
    if (process.env.APP_STAGE === 'demo') {
      return;
    }

    await this.scheduleReminders();

    await this.scheduleVacationReminders();

    for (let index = 0; index < 10; index++) {
      const job = await this.claim();

      if (!job) {
        break;
      }

      try {
        await this.run(job);

        await this.finish(job, true);
      } catch {
        this.logger.warn(`Attendance background job failed: kind=${job.kind} id=${job.id}`);

        await this.finish(job, false);
      }
    }
  }

  private async context(userId: string, now: Date): Promise<ReminderContext> {
    const date = seoulDate(now);

    const [settings, leaves, sessions] = await Promise.all([
      this.repo.settings(userId),
      this.repo.db
        .select()
        .from(attendanceLeaves)
        .where(
          and(eq(attendanceLeaves.userId, userId), eq(attendanceLeaves.date, date), isNull(attendanceLeaves.deletedAt)),
        ),
      this.repo.db
        .select()
        .from(attendanceSessions)
        .where(
          and(
            eq(attendanceSessions.userId, userId),
            or(eq(attendanceSessions.workDate, date), isNull(attendanceSessions.checkOut)),
          ),
        ),
    ]);

    return {
      now,
      date,
      clock: seoulClock(now),
      settings,
      leave: leaves[0] ?? null,
      hasTodayRecord: sessions.some((session) => session.workDate === date),
      hasOpenSession: sessions.some((session) => !session.checkOut),
    };
  }

  private async scheduleReminders(now = new Date()) {
    const staff = await this.repo.staff();

    for (const employee of staff) {
      const context = await this.context(employee.userId, now);

      for (const kind of ['in', 'out'] as const) {
        if (!reminderDue(kind, context)) {
          continue;
        }

        await this.repo.db
          .insert(attendanceJobs)
          .values({
            key: `reminder:${employee.userId}:${context.date}:${kind}:${context.clock}`,
            kind: 'reminder',
            userId: employee.userId,
            payload: { date: context.date, clock: context.clock, kind },
            expiresAt: new Date(Math.floor(now.getTime() / 60000) * 60000 + 60000),
          })
          .onConflictDoNothing();
      }
    }
  }

  private async scheduleVacationReminders(now = new Date()) {
    const staff = await this.repo.staff();

    if (!staff.length) {
      return;
    }

    const leaves = await this.repo.db
      .select()
      .from(attendanceLeaves)
      .where(
        and(
          inArray(
            attendanceLeaves.userId,
            staff.map((person) => person.userId),
          ),
          isNull(attendanceLeaves.deletedAt),
          gte(attendanceLeaves.date, seoulDate(new Date(now.getTime() - LEAVE_REMINDER_GRACE_MS))),
          lte(attendanceLeaves.date, seoulDate(new Date(now.getTime() + MAX_LEAVE_REMINDER_MINUTES * 60000))),
          sql`jsonb_array_length(${attendanceLeaves.reminderMinutes}) > 0`,
        ),
      );

    const settingsByUser = new Map<string, AttendanceSettings>();

    for (const leave of leaves) {
      let settings = settingsByUser.get(leave.userId);

      if (!settings) {
        settings = await this.repo.settings(leave.userId);

        settingsByUser.set(leave.userId, settings);
      }

      for (const trigger of dueLeaveReminders(leave, settings.normalStart, now)) {
        await this.repo.db
          .insert(attendanceJobs)
          .values({
            key: `leave-reminder:${leave.id}:${trigger.startAt}:${trigger.minutes}`,
            kind: 'leave-reminder',
            userId: leave.userId,
            payload: { leaveId: leave.id, ...trigger },
            expiresAt: new Date(new Date(trigger.scheduledFor).getTime() + LEAVE_REMINDER_GRACE_MS),
          })
          .onConflictDoNothing();
      }
    }
  }

  private async claim() {
    const now = new Date();

    return this.repo.db.transaction(async (tx) => {
      const terminated = await tx
        .update(attendanceJobs)
        .set({ status: 'failed', leaseUntil: null })
        .where(
          and(
            inArray(attendanceJobs.status, ['pending', 'running']),
            or(
              lte(attendanceJobs.expiresAt, now),
              and(
                gte(attendanceJobs.attempts, 3),
                or(eq(attendanceJobs.status, 'pending'), lte(attendanceJobs.leaseUntil, now)),
              ),
            ),
          ),
        )
        .returning();

      for (const job of terminated) {
        if (job.kind !== 'ai') {
          continue;
        }

        await tx
          .update(attendanceRequests)
          .set({ aiStatus: 'failed' })
          .where(
            and(
              eq(attendanceRequests.id, String(job.payload.requestId)),
              eq(attendanceRequests.version, Number(job.payload.version)),
              eq(attendanceRequests.status, 'pending'),
              inArray(attendanceRequests.aiStatus, ['queued', 'running']),
            ),
          );
      }

      const [candidate] = await tx
        .select()
        .from(attendanceJobs)
        .where(
          and(
            or(
              eq(attendanceJobs.status, 'pending'),
              and(eq(attendanceJobs.status, 'running'), lt(attendanceJobs.leaseUntil, now)),
            ),
            lte(attendanceJobs.runAfter, now),
            gt(attendanceJobs.expiresAt, now),
            lt(attendanceJobs.attempts, 3),
          ),
        )
        .orderBy(attendanceJobs.runAfter)
        .limit(1)
        .for('update', { skipLocked: true });

      if (!candidate) {
        return null;
      }

      const [claimed] = await tx
        .update(attendanceJobs)
        .set({ status: 'running', attempts: candidate.attempts + 1, leaseUntil: new Date(now.getTime() + 120000) })
        .where(eq(attendanceJobs.id, candidate.id))
        .returning();

      return claimed;
    });
  }

  private async finish(job: typeof attendanceJobs.$inferSelect, success: boolean) {
    const failed = !success && job.attempts >= 3;

    await this.repo.db
      .update(attendanceJobs)
      .set({
        status: success ? 'done' : failed ? 'failed' : 'pending',
        leaseUntil: null,
        runAfter: new Date(Date.now() + 30000 * job.attempts),
      })
      .where(
        and(
          eq(attendanceJobs.id, job.id),
          eq(attendanceJobs.status, 'running'),
          eq(attendanceJobs.leaseUntil, job.leaseUntil!),
        ),
      );

    if (failed && job.kind === 'ai') {
      await this.repo.db
        .update(attendanceRequests)
        .set({ aiStatus: 'failed' })
        .where(
          and(
            eq(attendanceRequests.id, String(job.payload.requestId)),
            eq(attendanceRequests.version, Number(job.payload.version)),
            eq(attendanceRequests.status, 'pending'),
          ),
        );
    }
  }

  private async internalCall(
    base: string | undefined,
    key: string | undefined,
    path: string,
    body: Record<string, unknown>,
  ) {
    if (!base || !key) {
      throw new Error('Attendance integration is not configured');
    }

    const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error('Attendance integration request failed');
    }

    const raw: unknown = await response.json();

    return unwrapAttendanceResponse(raw);
  }

  private async notify(userId: string, key: string, title: string, body: string, url: string) {
    await this.internalCall(
      process.env.NOTIFICATION_SERVICE_URL,
      process.env.NOTIFICATION_INTERNAL_KEY,
      '/internal/web-push/send',
      {
        userId,
        key,
        title,
        body,
        url,
      },
    );
  }

  private async run(job: typeof attendanceJobs.$inferSelect) {
    const now = new Date();

    const staff = await this.repo.staff();

    if (!staff.some((person) => person.userId === job.userId) || job.expiresAt <= now) {
      return;
    }

    if (job.kind === 'leave-reminder') {
      const [leave] = await this.repo.db
        .select()
        .from(attendanceLeaves)
        .where(and(eq(attendanceLeaves.id, String(job.payload.leaveId)), isNull(attendanceLeaves.deletedAt)));

      if (!leave || leave.userId !== job.userId) {
        return;
      }

      const settings = await this.repo.settings(job.userId);
      const trigger = dueLeaveReminders(leave, settings.normalStart, now).find(
        (item) =>
          item.minutes === job.payload.minutes &&
          item.startAt === job.payload.startAt &&
          item.scheduledFor === job.payload.scheduledFor,
      );

      if (!trigger) {
        return;
      }

      await this.notify(
        job.userId,
        job.key,
        '휴가 일정 알림',
        `${leave.date} ${seoulClock(new Date(trigger.startAt))}에 시작하는 휴가를 확인해 주세요.`,
        '/attendance/calendar',
      );

      return;
    }

    if (job.kind === 'reminder') {
      const context = await this.context(job.userId, now);

      const kind = job.payload.kind;

      if (
        (kind !== 'in' && kind !== 'out') ||
        job.payload.date !== context.date ||
        job.payload.clock !== context.clock ||
        !reminderDue(kind, context)
      ) {
        return;
      }

      await this.notify(
        job.userId,
        job.key,
        kind === 'in' ? '출근 시간이에요' : '퇴근 시간이에요',
        kind === 'in'
          ? '오늘도 좋은 하루 보내세요. 출근했다면 출근 기록을 남겨 주세요.'
          : '오늘도 수고하셨어요. 업무를 마쳤다면 퇴근 기록을 남겨 주세요.',
        '/attendance',
      );

      return;
    }

    const [request] = await this.repo.db
      .select()
      .from(attendanceRequests)
      .where(eq(attendanceRequests.id, String(job.payload.requestId)));

    if (!request) {
      return;
    }

    if (job.kind === 'ai') {
      if (request.status !== 'pending' || request.version !== job.payload.version) {
        return;
      }

      await this.repo.db
        .update(attendanceRequests)
        .set({ aiStatus: 'running' })
        .where(
          and(
            eq(attendanceRequests.id, request.id),
            eq(attendanceRequests.version, request.version),
            eq(attendanceRequests.status, 'pending'),
          ),
        );

      const response = await this.internalCall(
        process.env.AI_SERVICE_URL,
        process.env.AI_INTERNAL_KEY,
        '/internal/attendance/review',
        {
          requestId: request.id,
          userId: request.userId,
          version: request.version,
          reason: request.reason,
          checkIn: request.checkIn?.toISOString(),
          checkOut: request.checkOut?.toISOString(),
          fileIds: request.fileIds,
        },
      );

      const result = attendanceAiResponseSchema.parse(response);

      await this.repo.withUserLock(request.userId, async (tx) => {
        const changed = await tx
          .update(attendanceRequests)
          .set({ aiStatus: 'succeeded', aiResult: result.result })
          .where(
            and(
              eq(attendanceRequests.id, request.id),
              eq(attendanceRequests.version, request.version),
              eq(attendanceRequests.status, 'pending'),
            ),
          )
          .returning({ id: attendanceRequests.id });

        if (changed.length) {
          await tx.insert(attendanceAudit).values({
            actorId: request.userId,
            subjectId: request.userId,
            kind: 'request.ai_reviewed',
            entityId: request.id,
            after: {
              inputVersion: request.version,
              model: result.model,
              promptVersion: result.promptVersion,
              result: result.result,
            },
          });
        }
      });

      return;
    }

    if (job.kind === 'decision') {
      await this.notify(
        request.userId,
        job.key,
        '출결 요청에 답변이 있어요',
        '내 요청 내역에서 담당자의 답변을 확인해 주세요.',
        '/company/attendance/requests',
      );

      return;
    }

    if (job.kind === 'new_request') {
      const masters = await this.repo.db
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(userRoleAssignments, eq(userRoleAssignments.userId, users.id))
        .innerJoin(roles, eq(roles.roleId, userRoleAssignments.roleId))
        .where(
          and(
            eq(roles.name, 'master'),
            isNull(users.deletedAt),
            isNull(users.dormantAt),
            or(isNull(userRoleAssignments.expiresAt), gt(userRoleAssignments.expiresAt, now)),
          ),
        );

      for (const master of masters) {
        await this.notify(
          master.id,
          job.key,
          '새 출결 요청이 있어요',
          '요청 검토에서 내용을 확인해 주세요.',
          '/company/attendance/review',
        );
      }
    }
  }
}
