import type { Permission } from '@app/authorization';

/** 근태를 쓰는 «직원»은 이 권한을 가진 역할의 보유자다. */
export const ATTENDANCE_STAFF_PERMISSION = 'attendance.own.write' as const satisfies Permission;

/** 새 출결 요청 알림을 받는 사람은 이 권한을 가진 역할의 보유자다. */
export const ATTENDANCE_REVIEWER_PERMISSION = 'attendance.request.review' as const satisfies Permission;

export {
  RoleHoldersUnavailableError as AttendanceStaffUnavailableError,
  rolesHoldingOrThrow,
} from '../iam/role-holders';
export type { RoleHolderLookup } from '../iam/role-holders';
