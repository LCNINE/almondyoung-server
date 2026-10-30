// 관리자·권한(역할·부여·변경 이력) DTO — user-service iam 모듈 응답과 같은 모양.

export type RoleAudience = 'staff' | 'customer';

export interface RoleSummary {
  readonly roleId: string;
  /** 토큰에 실리는 역할 ID(만든 뒤 바뀌지 않는다) */
  readonly name: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly audience: RoleAudience;
  readonly isSystem: boolean;
  readonly version: number;
  readonly landingPath: string | null;
  readonly memberCount: number;
  readonly permissionCount: number;
  readonly dangerousCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleDetail extends RoleSummary {
  readonly permissions: readonly string[];
  readonly deprecatedPermissions: readonly string[];
}

export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string;
  landingPath?: string;
  permissions?: string[];
  copyFromRoleId?: string;
}

export interface UpdateRoleInput {
  displayName?: string;
  description?: string;
  landingPath?: string | null;
  version: number;
}

export interface Assignment {
  readonly roleId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly audience: RoleAudience;
  readonly isSystem: boolean;
  readonly assignedAt: string;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StaffAssignmentInput {
  roleId: string;
  /** YYYY-MM-DD(이날까지, 한국 시각) 또는 null(무기한) */
  expiresAt: string | null;
}

export interface StaffRoleBadge {
  readonly name: string;
  readonly displayName: string;
  readonly expiresAt: string | null;
}

export interface RoleMember {
  readonly userId: string;
  readonly loginId: string;
  readonly username: string;
  readonly assignedAt: string;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly canSignIn: boolean;
}

export const IAM_AUDIT_ACTIONS = [
  'role.create',
  'role.update',
  'role.delete',
  'role.permissions.replace',
  'user.roles.replace',
  'role.members.add',
  'role.member.remove',
  'admin_user.create',
  'pii_access_log.view',
] as const;
export type IamAuditAction = (typeof IAM_AUDIT_ACTIONS)[number];

export interface IamAuditLog {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorUserId: string;
  readonly actorLoginId: string | null;
  readonly action: IamAuditAction;
  readonly targetType: 'role' | 'user' | 'pii_access_log';
  readonly targetId: string;
  readonly targetLabel: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

export interface IamAuditFilter {
  from?: string;
  to?: string;
  actorUserId?: string;
  targetType?: 'role' | 'user' | 'pii_access_log';
  targetId?: string;
  roleId?: string;
  action?: IamAuditAction;
}

export interface IamAuditPage {
  readonly items: readonly IamAuditLog[];
  readonly nextCursor: string | null;
}

/** 서버 규칙 위반 code — 화면은 이걸로 사유를 나눈다(버전 충돌만 «다시 적용»). */
export const IAM_ERROR_CODES = {
  versionStale: 'ROLE_VERSION_STALE',
  escalation: 'IAM_ESCALATION',
  selfChange: 'IAM_SELF_CHANGE',
  lastOperator: 'IAM_LAST_OPERATOR',
  notTenantMember: 'IAM_NOT_TENANT_MEMBER',
  grantedElsewhere: 'IAM_GRANTED_ELSEWHERE',
  tenantUnresolved: 'IAM_TENANT_UNRESOLVED',
  operatorOnly: 'IAM_OPERATOR_ONLY',
  hasMembers: 'ROLE_HAS_MEMBERS',
  systemRole: 'SYSTEM_ROLE_IMMUTABLE',
  nameTaken: 'ROLE_NAME_TAKEN',
} as const;

export type PiiAccessAction = 'view' | 'reveal' | 'export';

export interface PiiAccessSubject {
  readonly type: string;
  readonly id: string;
}

export interface PiiAccessLog {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorUserId: string;
  readonly actorLoginId: string | null;
  readonly claimedIp: string | null;
  readonly peerIp: string | null;
  readonly userAgent: string | null;
  readonly sourceService: string;
  readonly method: string;
  readonly route: string;
  readonly action: PiiAccessAction;
  readonly subjects: readonly PiiAccessSubject[];
  readonly subjectCount: number;
  readonly kinds: readonly string[];
  readonly queryKeys: readonly string[];
  readonly reason: string | null;
}

export interface PiiAccessFilter {
  from?: string;
  to?: string;
  actorUserId?: string;
  action?: PiiAccessAction;
  subjectType?: string;
  subjectId?: string;
}

export interface PiiAccessPage {
  readonly items: readonly PiiAccessLog[];
  readonly nextCursor: string | null;
}

export interface PiiAccessActorSummary {
  readonly actorUserId: string;
  readonly actorLoginId: string | null;
  readonly accessCount: number;
  readonly subjectTotal: number;
  readonly exportCount: number;
  readonly afterHoursCount: number;
}

export interface PiiAccessSummary {
  readonly from: string;
  readonly to: string;
  readonly actors: readonly PiiAccessActorSummary[];
}

export interface PiiAccessReview {
  readonly id: string;
  readonly period: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly reviewedBy: string;
  readonly reviewedByLoginId: string | null;
  readonly reviewedAt: string;
  readonly note: string | null;
}

export interface CreatePiiAccessReviewInput {
  readonly period: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly note?: string;
}
