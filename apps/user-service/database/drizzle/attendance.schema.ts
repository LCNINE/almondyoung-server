import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AiAttendanceReview, AttendanceSession, AttendanceSettings } from '@packages/domain-types/attendance';
import { users } from './schema';

const instant = (name: string) => timestamp(name, { withTimezone: true });
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id);

export const attendanceWorksites = pgTable('attendance_worksites', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
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

export const attendanceTables = {
  attendanceWorksites,
  attendancePreferences,
  attendanceSessions,
  attendancePunches,
  attendanceLeaves,
  attendanceRequests,
  attendanceAudit,
  attendanceJobs,
};
