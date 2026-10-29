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

export class IamLastMasterError extends ConflictError {
  constructor() {
    super('기간 없이 시스템 역할을 가진 관리자가 최소 1명 남아야 합니다.');
  }

  getErrorCode(): string {
    return 'IAM_LAST_MASTER';
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
