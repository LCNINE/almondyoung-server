'use client';

import { USER_SERVICE_BASE_URL } from '@/const/api-const';
import { client } from '@/lib/api/client';
import type {
  AttendanceMe,
  MonthlyAttendanceStatistics,
  AttendanceRequest,
  AttendanceRequestHistory,
  AttendanceSession,
  AttendanceSettings,
  CalendarLeave,
  LeaveBatchOptions,
  LeaveInput,
  LocationSample,
  StaffAttendance,
  Worksite,
} from '@packages/domain-types/attendance';
import type {
  AbsenceKind,
  MinimumWage,
  MyWage,
  PayBasis,
  PayGroup,
  PayPolicy,
  ScheduleDay,
  SettlementRecord,
  SettlementResult,
  SettlementSummary,
  WageDecisions,
  WageRate,
  WageRules,
  WageWorker,
  WageWorkerDetail,
  WorkSchedule,
} from '@packages/domain-types/attendance-wage';

const base = `${USER_SERVICE_BASE_URL}/attendance`;
export interface CorrectionInput {
  workDate: string;
  checkIn?: string;
  checkOut?: string;
  reason: string;
  fileIds: string[];
}

export const attendanceApi = {
  monthlyStatistics: async (month: string) =>
    (
      await client.get<MonthlyAttendanceStatistics>(
        `${base}/statistics/monthly`,
        { params: { month } }
      )
    ).data,
  me: async () => (await client.get<AttendanceMe>(`${base}/me`)).data,
  records: async (userId?: string) =>
    (
      await client.get<AttendanceSession[]>(`${base}/records`, {
        params: userId ? { userId } : undefined,
      })
    ).data,
  calendar: async (from: string, to: string) =>
    (
      await client.get<CalendarLeave[]>(`${base}/calendar`, {
        params: { from, to },
      })
    ).data,
  overview: async () =>
    (
      await client.get<{
        date: string;
        updatedAt: string;
        people: StaffAttendance[];
      }>(`${base}/overview`)
    ).data,
  saveLeaves: async (days: LeaveInput[], options: LeaveBatchOptions = {}) =>
    (await client.post(`${base}/leaves`, { days, ...options })).data,
  removeLeave: async (id: string) =>
    (await client.delete(`${base}/leaves/${id}`)).data,
  updateLeave: async (id: string, day: LeaveInput) =>
    (await client.put(`${base}/leaves/${id}`, day)).data,
  punch: async (input: {
    kind: 'in' | 'out';
    requestId: string;
    siteId: string;
    location: LocationSample;
  }) => (await client.post<AttendanceSession>(`${base}/punch`, input)).data,
  settings: async (settings: AttendanceSettings) =>
    (await client.put<AttendanceSettings>(`${base}/settings`, settings)).data,
  requests: async (review = false) =>
    (
      await client.get<AttendanceRequest[]>(
        `${base}/${review ? 'review' : 'requests'}`
      )
    ).data,
  history: async (id: string) =>
    (
      await client.get<AttendanceRequestHistory[]>(
        `${base}/requests/${id}/history`
      )
    ).data,
  cancelRequest: async (input: { id: string; version: number }) =>
    (
      await client.post(`${base}/requests/${input.id}/cancel`, {
        version: input.version,
      })
    ).data,
  recommendations: async () =>
    (
      await client.get<
        Record<'am' | 'pm', { start: string; end: string } | null>
      >(`${base}/recommendations`)
    ).data,
  createRequest: async (input: CorrectionInput) =>
    (await client.post(`${base}/requests`, input)).data,
  resubmit: async (id: string, input: CorrectionInput) =>
    (await client.post(`${base}/requests/${id}/resubmit`, input)).data,
  decide: async (
    id: string,
    input: {
      version: number;
      status: 'approved' | 'rejected' | 'needs_information';
      reason: string;
    }
  ) => (await client.post(`${base}/requests/${id}/decision`, input)).data,
  worksites: async () =>
    (await client.get<Worksite[]>(`${base}/worksites`)).data,
  updateSite: async ({ id, ...site }: Worksite) =>
    (await client.put<Worksite>(`${base}/worksites/${id}`, site)).data,
  createSite: async (site: {
    name: string;
    address?: string | null;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    accuracyMeters: number;
  }) => (await client.post(`${base}/worksites`, site)).data,
};

const wageBase = `${base}/wage`;

export interface PayGroupInput {
  name: string;
  payBasis: PayBasis;
  payday: number;
  periodCloseDay: number;
  payMonthOffset: 0 | 1;
  rules?: WageRules;
  rulesEffectiveFrom?: string;
}

export interface WorkerInput {
  groupId: string;
  hireDate?: string | null;
  leaveDate?: string | null;
  label?: string | null;
  note?: string | null;
  version?: number;
}

export interface OvertimeDecisionInput {
  status: 'recognized' | 'rejected';
  recognizedMinutes: number;
  recordedMinutes: number;
  reason?: string;
  version?: number;
}

export interface AbsenceDecisionInput {
  kind: AbsenceKind;
  reason?: string;
  version?: number;
}

export const attendanceWageApi = {
  groups: async () => (await client.get<PayGroup[]>(`${wageBase}/groups`)).data,
  decisionGroups: async () =>
    (await client.get<PayGroup[]>(`${wageBase}/decisions/groups`)).data,
  createGroup: async (input: PayGroupInput) =>
    (await client.post<PayGroup>(`${wageBase}/groups`, input)).data,
  updateGroup: async ({
    id,
    ...input
  }: Partial<PayGroupInput> & {
    id: string;
    version: number;
    active?: boolean;
  }) => (await client.patch<PayGroup>(`${wageBase}/groups/${id}`, input)).data,
  policies: async (groupId: string) =>
    (await client.get<PayPolicy[]>(`${wageBase}/groups/${groupId}/policies`))
      .data,
  addPolicy: async ({
    groupId,
    ...input
  }: {
    groupId: string;
    effectiveFrom: string;
    rules: WageRules;
  }) =>
    (
      await client.post<PayPolicy>(
        `${wageBase}/groups/${groupId}/policies`,
        input
      )
    ).data,
  workers: async () =>
    (await client.get<WageWorker[]>(`${wageBase}/workers`)).data,
  worker: async (userId: string) =>
    (await client.get<WageWorkerDetail>(`${wageBase}/workers/${userId}`)).data,
  saveWorker: async ({ userId, ...input }: WorkerInput & { userId: string }) =>
    (await client.put<WageWorkerDetail>(`${wageBase}/workers/${userId}`, input))
      .data,
  addRate: async ({
    userId,
    ...input
  }: {
    userId: string;
    effectiveFrom: string;
    hourlyWage: number;
  }) =>
    (await client.post<WageRate>(`${wageBase}/workers/${userId}/rates`, input))
      .data,
  addSchedule: async ({
    userId,
    ...input
  }: {
    userId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    days: ScheduleDay[];
  }) =>
    (
      await client.post<WorkSchedule>(
        `${wageBase}/workers/${userId}/schedules`,
        input
      )
    ).data,
  deleteGroup: async (id: string) =>
    (await client.delete(`${wageBase}/groups/${id}`)).data,
  updatePolicy: async ({
    groupId,
    policyId,
    ...input
  }: {
    groupId: string;
    policyId: string;
    effectiveFrom?: string;
    rules?: WageRules;
  }) =>
    (
      await client.patch<PayPolicy>(
        `${wageBase}/groups/${groupId}/policies/${policyId}`,
        input
      )
    ).data,
  deletePolicy: async ({
    groupId,
    policyId,
  }: {
    groupId: string;
    policyId: string;
  }) =>
    (await client.delete(`${wageBase}/groups/${groupId}/policies/${policyId}`))
      .data,
  removeWorker: async (userId: string) =>
    (await client.delete(`${wageBase}/workers/${userId}`)).data,
  updateRate: async ({
    userId,
    rateId,
    ...input
  }: {
    userId: string;
    rateId: string;
    effectiveFrom?: string;
    hourlyWage?: number;
  }) =>
    (
      await client.patch<WageRate>(
        `${wageBase}/workers/${userId}/rates/${rateId}`,
        input
      )
    ).data,
  deleteRate: async ({ userId, rateId }: { userId: string; rateId: string }) =>
    (await client.delete(`${wageBase}/workers/${userId}/rates/${rateId}`)).data,
  updateSchedule: async ({
    userId,
    scheduleId,
    ...input
  }: {
    userId: string;
    scheduleId: string;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    days?: ScheduleDay[];
  }) =>
    (
      await client.patch<WorkSchedule>(
        `${wageBase}/workers/${userId}/schedules/${scheduleId}`,
        input
      )
    ).data,
  deleteSchedule: async ({
    userId,
    scheduleId,
  }: {
    userId: string;
    scheduleId: string;
  }) =>
    (
      await client.delete(
        `${wageBase}/workers/${userId}/schedules/${scheduleId}`
      )
    ).data,
  updateMinimumWage: async ({ effectiveFrom, hourlyWage }: MinimumWage) =>
    (
      await client.patch<MinimumWage>(
        `${wageBase}/minimum-wages/${effectiveFrom}`,
        { hourlyWage }
      )
    ).data,
  deleteMinimumWage: async (effectiveFrom: string) =>
    (await client.delete(`${wageBase}/minimum-wages/${effectiveFrom}`)).data,
  clearDecision: async ({
    kind,
    userId,
    workDate,
  }: {
    kind: 'overtime' | 'absence';
    userId: string;
    workDate: string;
  }) =>
    (
      await client.delete(
        `${wageBase}/${kind === 'overtime' ? 'overtime' : 'absences'}/${userId}/${workDate}`
      )
    ).data,
  minimumWages: async () =>
    (await client.get<MinimumWage[]>(`${wageBase}/minimum-wages`)).data,
  addMinimumWage: async (input: MinimumWage) =>
    (await client.post<MinimumWage>(`${wageBase}/minimum-wages`, input)).data,
  decisions: async (groupId: string, paydayMonth: string) =>
    (
      await client.get<WageDecisions>(`${wageBase}/decisions`, {
        params: { groupId, paydayMonth },
      })
    ).data,
  decideOvertime: async ({
    userId,
    workDate,
    ...input
  }: OvertimeDecisionInput & { userId: string; workDate: string }) =>
    (await client.put(`${wageBase}/overtime/${userId}/${workDate}`, input))
      .data,
  decideAbsence: async ({
    userId,
    workDate,
    ...input
  }: AbsenceDecisionInput & { userId: string; workDate: string }) =>
    (await client.put(`${wageBase}/absences/${userId}/${workDate}`, input))
      .data,
  preview: async (groupId: string, paydayMonth: string) =>
    (
      await client.get<SettlementResult>(`${wageBase}/settlements/preview`, {
        params: { groupId, paydayMonth },
      })
    ).data,
  settlements: async (groupId: string) =>
    (
      await client.get<SettlementSummary[]>(`${wageBase}/settlements`, {
        params: { groupId },
      })
    ).data,
  settlement: async (id: string) =>
    (await client.get<SettlementRecord>(`${wageBase}/settlements/${id}`)).data,
  confirm: async (input: { groupId: string; paydayMonth: string }) =>
    (await client.post<SettlementRecord>(`${wageBase}/settlements`, input))
      .data,
  reopen: async ({ id, reason }: { id: string; reason: string }) =>
    (
      await client.post<SettlementRecord>(
        `${wageBase}/settlements/${id}/reopen`,
        { reason }
      )
    ).data,
  exportSettlement: async (id: string) =>
    (await client.get<SettlementRecord>(`${wageBase}/settlements/${id}/export`))
      .data,
  exportPreview: async (input: { groupId: string; paydayMonth: string }) =>
    (
      await client.get<SettlementResult>(
        `${wageBase}/settlements/preview/export`,
        { params: input }
      )
    ).data,
  mine: async (paydayMonth: string) =>
    (await client.get<MyWage>(`${wageBase}/me`, { params: { paydayMonth } }))
      .data,
};
