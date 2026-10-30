import { ConflictError, ForbiddenError } from '@app/shared';

/**
 * 역할·권한 관리 규칙 위반. 화면은 `code` 로 사유를 구분한다(버전 충돌만 «다시 적용»을 권한다).
 * 권한 상승은 권한 부족과 같은 성격이라 403, 나머지는 대상의 지금 상태와 부딪히는 것이라 409.
 */
export class IamEscalationError extends ForbiddenError {
  getErrorCode(): string {
    return 'IAM_ESCALATION';
  }
}

export class RoleVersionStaleError extends ConflictError {
  constructor() {
    super('다른 사람이 먼저 이 역할을 바꿨습니다. 새로 불러온 뒤 다시 저장하세요.');
  }

  getErrorCode(): string {
    return 'ROLE_VERSION_STALE';
  }
}

export class SystemRoleImmutableError extends ConflictError {
  getErrorCode(): string {
    return 'SYSTEM_ROLE_IMMUTABLE';
  }
}

export class RoleNameTakenError extends ConflictError {
  getErrorCode(): string {
    return 'ROLE_NAME_TAKEN';
  }
}

export class RoleHasMembersError extends ConflictError {
  getErrorCode(): string {
    return 'ROLE_HAS_MEMBERS';
  }
}

export class IamSelfChangeError extends ConflictError {
  constructor() {
    super('자기 역할은 다른 관리자가 바꿔야 합니다.');
  }

  getErrorCode(): string {
    return 'IAM_SELF_CHANGE';
  }
}

export class IamLastOperatorError extends ConflictError {
  constructor() {
    super('로그인할 수 있는 플랫폼 운영자가 최소 1명 남아야 합니다.');
  }

  getErrorCode(): string {
    return 'IAM_LAST_OPERATOR';
  }
}

export class IamNotTenantMemberError extends ConflictError {
  constructor() {
    super('이 테넌트 소속이 아닌 계정에는 직원 역할을 줄 수 없습니다.');
  }

  getErrorCode(): string {
    return 'IAM_NOT_TENANT_MEMBER';
  }
}

/** 부여 행은 사람·역할마다 하나라(테넌트 칸 contract 전까지) 같은 역할을 두 테넌트에서 받을 수 없다. */
export class IamGrantedElsewhereError extends ConflictError {
  constructor() {
    super('이 역할은 다른 테넌트에서 이미 받은 역할입니다.');
  }

  getErrorCode(): string {
    return 'IAM_GRANTED_ELSEWHERE';
  }
}

/** 요청자가 어느 테넌트에서 일하는지 정할 수 없다 — 토큰 테넌트가 들어오기 전에는 소속이 정확히 하나여야 한다. */
export class IamTenantUnresolvedError extends ForbiddenError {
  constructor() {
    super('작업할 테넌트를 정할 수 없습니다.');
  }

  getErrorCode(): string {
    return 'IAM_TENANT_UNRESOLVED';
  }
}

export class IamOperatorOnlyError extends ForbiddenError {
  constructor() {
    super('플랫폼 운영자만 할 수 있습니다.');
  }

  getErrorCode(): string {
    return 'IAM_OPERATOR_ONLY';
  }
}

export class IamStaffCannotLeaveError extends ConflictError {
  constructor() {
    super('직원 계정은 탈퇴할 수 없습니다. 관리자에게 역할 회수를 요청해 주세요.');
  }

  getErrorCode(): string {
    return 'IAM_STAFF_CANNOT_LEAVE';
  }
}

export class TenantExistsError extends ConflictError {
  getErrorCode(): string {
    return 'TENANT_EXISTS';
  }
}

export class TenantDomainTakenError extends ConflictError {
  getErrorCode(): string {
    return 'TENANT_DOMAIN_TAKEN';
  }
}

/** 준비 → 활성 ↔ 정지 밖의 전환, 준비가 아닌 테넌트 삭제. */
export class TenantStatusConflictError extends ConflictError {
  getErrorCode(): string {
    return 'TENANT_STATUS_CONFLICT';
  }
}

/** 운영자가 지금 일하는 테넌트를 정지하면 정지를 풀 사람의 세션도 함께 끊긴다. */
export class TenantOwnSuspendError extends ConflictError {
  constructor() {
    super('지금 일하는 테넌트는 정지할 수 없습니다.');
  }

  getErrorCode(): string {
    return 'TENANT_OWN_SUSPEND';
  }
}
