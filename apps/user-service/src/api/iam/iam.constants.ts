import { roles, userRoleAssignments } from 'apps/user-service/database/drizzle/schema';
import { gt, isNull, notInArray, sql, type SQL } from 'drizzle-orm';

/**
 * 역할 «이름»을 코드가 아는 유일한 곳.
 *
 * 나머지 코드는 권한만 본다. master 는 «권한 목록 전체»를 계산해서 받는 시스템 역할이라
 * 화면에서 편집·삭제할 수 없고 최소 1명이 남아야 한다 — 그 규칙이 여기 이름에 걸려 있다.
 */
export const SYSTEM_ROLE_NAME = 'master';

/** 고객 역할. 관리자 권한 배포·관리 화면 대상이 아니다. */
export const CUSTOMER_ROLE_NAMES: readonly string[] = ['user', 'membership'];

/**
 * 지금 유효한 직원 역할 부여 — 고객 역할이 아니고 기간이 없거나 끝나지 않은 것. `roles` 와 `user_role_assignments`
 * 를 조인한 질의의 where 에 쓴다. «직원인가» 는 토큰이 아니라 DB 의 지금 부여로 판정한다.
 */
export const liveStaffAssignment = (): SQL =>
  sql`${notInArray(roles.name, [...CUSTOMER_ROLE_NAMES])} and (${isNull(userRoleAssignments.expiresAt)} or ${gt(userRoleAssignments.expiresAt, new Date())})`;
