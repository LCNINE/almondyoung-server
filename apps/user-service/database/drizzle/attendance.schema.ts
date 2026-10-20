import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  AiAttendanceReview,
  AttendanceSession,
  AttendanceSettings,
  LeaveRecurrence,
} from '@packages/domain-types/attendance';
import type {
  AbsenceKind,
  PayBasis,
  ScheduleDay,
  SettlementResult,
  WageRules,
} from '@packages/domain-types/attendance-wage';
import { users } from './schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id);

export const attendanceWorksites = pgTable('attendance_worksites', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  latitude: text('latitude').notNull(),
  longitude: text('longitude').notNull(),
  radiusMeters: integer('radius_meters').notNull(),
  accuracyMeters: integer('accuracy_meters').notNull(),
  version: integer('version').notNull().default(1),
  active: boolean('active').notNull().default(true),
});

export const attendancePreferences = pgTable('attendance_preferences', {
  userId: userId().primaryKey(),
  settings: jsonb('settings').$type<AttendanceSettings>().notNull(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
});

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    workDate: date('work_date').notNull(),
    checkIn: instant('check_in').notNull(),
    checkOut: instant('check_out'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('attendance_session_daily').on(t.userId, t.workDate),
    uniqueIndex('attendance_session_open')
      .on(t.userId)
      .where(sql`${t.checkOut} IS NULL`),
  ],
);

export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => attendanceSessions.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => attendanceWorksites.id),
    policyVersion: integer('policy_version').notNull(),
    recordedAt: instant('recorded_at').notNull().defaultNow(),
    result: jsonb('result').$type<AttendanceSession>().notNull(),
  },
  (t) => [uniqueIndex('attendance_punch_idempotency').on(t.userId, t.requestId)],
);

export const attendanceLeaves = pgTable(
  'attendance_leaves',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    date: date('date').notNull(),
    type: text('type').$type<'full' | 'am' | 'pm'>().notNull(),
    start: text('start'),
    end: text('end'),
    seriesId: uuid('series_id'),
    recurrence: jsonb('recurrence').$type<LeaveRecurrence>(),
    showDday: boolean('show_dday').notNull().default(false),
    reminderMinutes: jsonb('reminder_minutes').$type<number[]>().notNull().default([]),
    reminderSetAt: instant('reminder_set_at'),
    deletedAt: instant('deleted_at'),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attendance_leave_active_date')
      .on(t.userId, t.date)
      .where(sql`${t.deletedAt} IS NULL`),
    index('attendance_leave_calendar').on(t.date),
  ],
);

export const attendanceRequests = pgTable(
  'attendance_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    workDate: date('work_date').notNull(),
    sessionId: uuid('session_id').references(() => attendanceSessions.id),
    targetVersion: integer('target_version'),
    checkIn: instant('check_in'),
    checkOut: instant('check_out'),
    reason: text('reason').notNull(),
    fileIds: jsonb('file_ids').$type<string[]>().notNull().default([]),
    status: text('status')
      .$type<'pending' | 'needs_information' | 'approved' | 'rejected' | 'cancelled'>()
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    decisionReason: text('decision_reason'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: instant('decided_at'),
    createdAt: instant('created_at').notNull().defaultNow(),
    aiStatus: text('ai_status').notNull().default('queued'),
    aiResult: jsonb('ai_result').$type<AiAttendanceReview>(),
  },
  (t) => [index('attendance_requests_queue').on(t.status, t.createdAt)],
);

export const attendanceAudit = pgTable('attendance_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  subjectId: uuid('subject_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  entityId: uuid('entity_id').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  createdAt: instant('created_at').notNull().defaultNow(),
});

export const attendanceJobs = pgTable(
  'attendance_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull().unique(),
    kind: text('kind').notNull(),
    userId: userId(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: instant('run_after').notNull().defaultNow(),
    leaseUntil: instant('lease_until'),
    expiresAt: instant('expires_at').notNull(),
  },
  (t) => [index('attendance_jobs_due').on(t.status, t.runAfter)],
);

export const attendancePayGroups = pgTable('attendance_pay_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  payBasis: text('pay_basis').$type<PayBasis>().notNull(),
  payday: integer('payday').notNull(),
  periodCloseDay: integer('period_close_day').notNull(),
  payMonthOffset: integer('pay_month_offset').$type<0 | 1>().notNull(),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: instant('created_at').notNull().defaultNow(),
  updatedAt: instant('updated_at').notNull().defaultNow(),
});

export const attendancePayPolicies = pgTable(
  'attendance_pay_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => attendancePayGroups.id),
    effectiveFrom: date('effective_from').notNull(),
    rules: jsonb('rules').$type<WageRules>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_pay_policy_effective').on(t.groupId, t.effectiveFrom)],
);

export const attendanceWorkers = pgTable(
  'attendance_workers',
  {
    userId: userId().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => attendancePayGroups.id),
    hireDate: date('hire_date'),
    leaveDate: date('leave_date'),
    label: text('label'),
    note: text('note'),
    version: integer('version').notNull().default(1),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [index('attendance_workers_group').on(t.groupId)],
);

export const attendanceWageRates = pgTable(
  'attendance_wage_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    hourlyWage: integer('hourly_wage').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_wage_rate_effective').on(t.userId, t.effectiveFrom)],
);

export const attendanceWorkSchedules = pgTable(
  'attendance_work_schedules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    days: jsonb('days').$type<ScheduleDay[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_work_schedule_effective').on(t.userId, t.effectiveFrom)],
);

export const attendanceOvertimeDecisions = pgTable(
  'attendance_overtime_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    workDate: date('work_date').notNull(),
    sessionId: uuid('session_id').references(() => attendanceSessions.id),
    recordedMinutes: integer('recorded_minutes').notNull(),
    recognizedMinutes: integer('recognized_minutes').notNull(),
    status: text('status').$type<'recognized' | 'rejected'>().notNull(),
    reason: text('reason'),
    decidedBy: uuid('decided_by')
      .notNull()
      .references(() => users.id),
    decidedAt: instant('decided_at').notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('attendance_overtime_decision_daily').on(t.userId, t.workDate)],
);

export const attendanceAbsenceDecisions = pgTable(
  'attendance_absence_decisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: userId(),
    workDate: date('work_date').notNull(),
    kind: text('kind').$type<AbsenceKind>().notNull(),
    reason: text('reason'),
    decidedBy: uuid('decided_by')
      .notNull()
      .references(() => users.id),
    decidedAt: instant('decided_at').notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('attendance_absence_decision_daily').on(t.userId, t.workDate)],
);

export const attendancePaySettlements = pgTable(
  'attendance_pay_settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => attendancePayGroups.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    payday: date('payday').notNull(),
    status: text('status').$type<'confirmed' | 'reopened'>().notNull(),
    snapshot: jsonb('snapshot').$type<SettlementResult>().notNull(),
    total: integer('total').notNull(),
    confirmedBy: uuid('confirmed_by')
      .notNull()
      .references(() => users.id),
    confirmedAt: instant('confirmed_at').notNull().defaultNow(),
    reopenedBy: uuid('reopened_by').references(() => users.id),
    reopenedAt: instant('reopened_at'),
    reopenReason: text('reopen_reason'),
  },
  (t) => [
    uniqueIndex('attendance_pay_settlement_confirmed')
      .on(t.groupId, t.periodStart)
      .where(sql`${t.status} = 'confirmed'`),
    index('attendance_pay_settlement_group').on(t.groupId, t.periodStart),
  ],
);

export const attendanceMinimumWages = pgTable('attendance_minimum_wages', {
  effectiveFrom: date('effective_from').primaryKey(),
  hourlyWage: integer('hourly_wage').notNull(),
});

export const attendanceTables = {
  attendanceWorksites,
  attendancePreferences,
  attendanceSessions,
  attendancePunches,
  attendanceLeaves,
  attendanceRequests,
  attendanceAudit,
  attendanceJobs,
  attendancePayGroups,
  attendancePayPolicies,
  attendanceWorkers,
  attendanceWageRates,
  attendanceWorkSchedules,
  attendanceOvertimeDecisions,
  attendanceAbsenceDecisions,
  attendancePaySettlements,
  attendanceMinimumWages,
};
