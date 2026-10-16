'use client';

import { USER_SERVICE_BASE_URL } from '@/const/api-const';
import { client } from '@/lib/api/client';
import type {
  AttendanceMe,
  AttendanceRequest,
  AttendanceRequestHistory,
  AttendanceSession,
  AttendanceSettings,
  CalendarLeave,
  LeaveInput,
  LocationSample,
  StaffAttendance,
} from '@packages/domain-types/attendance';

const base = `${USER_SERVICE_BASE_URL}/attendance`;
export interface CorrectionInput {
  workDate: string;
  checkIn?: string;
  checkOut?: string;
  reason: string;
  fileIds: string[];
}

export const attendanceApi = {
  me: async () => (await client.get<AttendanceMe>(`${base}/me`)).data,
  records: async () =>
    (await client.get<AttendanceSession[]>(`${base}/records`)).data,
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
  saveLeaves: async (days: LeaveInput[]) =>
    (await client.post(`${base}/leaves`, { days })).data,
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
  createSite: async (site: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    accuracyMeters: number;
  }) => (await client.post(`${base}/worksites`, site)).data,
};
