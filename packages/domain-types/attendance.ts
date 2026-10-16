/** Shared attendance contracts. These planned times do not calculate payroll or legal compliance. */
export type LeaveType = 'full' | 'am' | 'pm';
export type AttendanceStatus = 'before' | 'working' | 'done';
export type RequestStatus = 'pending' | 'needs_information' | 'approved' | 'rejected' | 'cancelled';
export interface PlannedTimes {
  start: string;
  end: string;
}
export interface LocationSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}
export interface Worksite {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  accuracyMeters: number;
  version: number;
}
export interface AttendanceSettings {
  normalStart: string;
  normalEnd: string;
  inEnabled: boolean;
  outEnabled: boolean;
  inTime: string;
  outTime: string;
  weekdays: number[];
  skipDate: string | null;
  sound: boolean;
}
export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  normalStart: '09:00',
  normalEnd: '18:00',
  inEnabled: false,
  outEnabled: false,
  inTime: '09:00',
  outTime: '18:00',
  weekdays: [1, 2, 3, 4, 5],
  skipDate: null,
  sound: true,
};
export interface AttendanceSession {
  id: string;
  userId: string;
  workDate: string;
  checkIn: string;
  checkOut: string | null;
  version: number;
}
export interface CalendarLeave {
  id: string;
  userId: string;
  name: string;
  date: string;
  type: LeaveType;
  start: string | null;
  end: string | null;
}
export interface LeaveInput {
  date: string;
  type: LeaveType;
  start?: string;
  end?: string;
}
export interface AttendanceMe {
  userId: string;
  name: string;
  today: string;
  status: AttendanceStatus;
  session: AttendanceSession | null;
  leave: CalendarLeave | null;
  settings: AttendanceSettings;
  worksites: Worksite[];
  isMaster: boolean;
}
export interface StaffAttendance {
  userId: string;
  name: string;
  status: AttendanceStatus;
  leave: Pick<CalendarLeave, 'type' | 'start' | 'end'> | null;
}
export interface AttendanceRequest {
  id: string;
  userId: string;
  name?: string;
  workDate: string;
  sessionId: string | null;
  targetVersion: number | null;
  checkIn: string | null;
  checkOut: string | null;
  reason: string;
  fileIds: string[];
  status: RequestStatus;
  version: number;
  decisionReason: string | null;
  createdAt: string;
  aiStatus: string;
  aiResult?: AiAttendanceReview | null;
  original?: { checkIn: string; checkOut: string | null; version: number } | null;
}

export interface AttendanceRequestHistory {
  id: string;
  kind: string;
  actor: string;
  createdAt: string;
  status?: string;
  reason?: string;
  checkIn?: string;
  checkOut?: string;
}
export interface AiAttendanceReview {
  summary: string;
  evidence: string[];
  questions: string[];
  opinion: 'reviewable' | 'needs_information' | 'undetermined';
}

export const LEAVE_LABELS: Record<LeaveType, string> = { full: '종일 휴가', am: '오전 반차', pm: '오후 반차' };
export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  before: '출근 기록 없음',
  working: '근무 중',
  done: '퇴근',
};

export function clockMinutes(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }

  const [hour, minute] = value.split(':').map(Number);

  return hour * 60 + minute;
}

export function recommendPlannedClock(history: string[]): string | null {
  const values = history.slice(0, 10).map(clockMinutes).filter((value): value is number => value !== null).sort((a, b) => a - b);

  if (values.length < 5) {
    return null;
  }

  const median = values[Math.floor(values.length / 2)];
  const consistent = values.filter((value) => Math.abs(value - median) <= 30).length;

  if (consistent / values.length < 0.8) {
    return null;
  }

  return `${String(Math.floor(median / 60)).padStart(2, '0')}:${String(median % 60).padStart(2, '0')}`;
}

function addHours(start: string, hours: number): string {
  const minutes = clockMinutes(start);

  if (minutes === null || minutes + hours * 60 >= 1440) {
    throw new Error('같은 날짜 안의 근무 시각을 입력해 주세요.');
  }

  const total = minutes + hours * 60;

  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function normalSchedule(start: string): PlannedTimes {
  return { start, end: addHours(start, 9) };
}

export function halfDaySchedule(normalStart: string, type: LeaveType): PlannedTimes {
  const normal = normalSchedule(normalStart);

  if (type === 'am') {
    return { start: addHours(normalStart, 4), end: normal.end };
  }

  if (type === 'pm') {
    return { start: normalStart, end: '' };
  }

  return { start: '', end: '' };
}

export function validatePlannedTimes(start: string, end: string): string | null {
  const a = clockMinutes(start);
  const b = clockMinutes(end);

  if (a === null || b === null) {
    return '출근·퇴근 예정 시각을 입력해 주세요.';
  }

  if (b <= a) {
    return '퇴근 예정은 출근 예정 이후로 입력해 주세요.';
  }

  return null;
}

export function isWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(value + 'T00:00:00Z');

  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function seoulDate(now: Date): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

export function seoulClock(now: Date): string {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(11, 16);
}

export function verifyLocation(point: LocationSample, site: Worksite, now: Date): void {
  if (
    ![point.latitude, point.longitude, point.accuracy, point.timestamp].every(Number.isFinite) ||
    Math.abs(point.latitude) > 90 ||
    Math.abs(point.longitude) > 180 ||
    point.accuracy < 0
  ) {
    throw new Error('유효한 위치를 확인하지 못했어요.');
  }

  const age = now.getTime() - point.timestamp;

  if (age > 60000 || age < -10000) {
    throw new Error('위치를 다시 확인해 주세요.');
  }

  if (point.accuracy > site.accuracyMeters) {
    throw new Error('위치 정확도가 부족해요. 창가 등에서 다시 시도해 주세요.');
  }

  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(point.latitude - site.latitude);
  const deltaLng = radians(point.longitude - site.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(site.latitude)) * Math.cos(radians(point.latitude)) * Math.sin(deltaLng / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));

  if (distance + point.accuracy > site.radiusMeters) {
    throw new Error('회사 위치를 확인하지 못했어요. 다시 시도하거나 예외 요청을 남겨 주세요.');
  }
}
