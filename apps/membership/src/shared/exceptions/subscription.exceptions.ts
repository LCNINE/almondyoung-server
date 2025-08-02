import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 기본 구독 예외 클래스
 */
export class SubscriptionException extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
      statusCode,
    );
  }
}

/**
 * 구독을 찾을 수 없음
 */
export class SubscriptionNotFoundException extends SubscriptionException {
  constructor() {
    super(
      '활성 구독이 없습니다',
      'SUBSCRIPTION_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 잘못된 플랜 변경 요청
 */
export class InvalidPlanChangeException extends SubscriptionException {
  constructor(reason: string) {
    super(
      `플랜 변경이 불가능합니다: ${reason}`,
      'INVALID_PLAN_CHANGE',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 일시정지 쿼터 초과
 */
export class PauseQuotaExceededException extends SubscriptionException {
  constructor(used: number, limit: number) {
    super(
      `연간 일시정지 한도를 초과했습니다 (${used}/${limit})`,
      'PAUSE_QUOTA_EXCEEDED',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 일시정지 중 작업 불가
 */
export class SubscriptionPausedException extends SubscriptionException {
  constructor(action: string) {
    super(
      `일시정지 중에는 ${action}을(를) 할 수 없습니다`,
      'SUBSCRIPTION_PAUSED',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 플랜을 찾을 수 없음
 */
export class PlanNotFoundException extends SubscriptionException {
  constructor() {
    super('유효하지 않은 플랜입니다', 'PLAN_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

/**
 * 이미 활성 구독이 존재
 */
export class ActiveSubscriptionExistsException extends SubscriptionException {
  constructor() {
    super(
      '이미 활성 구독이 있습니다',
      'ACTIVE_SUBSCRIPTION_EXISTS',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 권한 없음
 */
export class InsufficientPermissionException extends SubscriptionException {
  constructor(action: string) {
    super(
      `${action}에 대한 권한이 없습니다`,
      'INSUFFICIENT_PERMISSION',
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 이벤트 발행 실패
 */
export class EventPublishException extends SubscriptionException {
  constructor(eventType: string) {
    super(
      `이벤트 발행에 실패했습니다: ${eventType}`,
      'EVENT_PUBLISH_FAILED',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * 정책 위반
 */
export class PolicyViolationException extends SubscriptionException {
  constructor(policyType: string, details: string) {
    super(
      `정책 위반: ${policyType} - ${details}`,
      'POLICY_VIOLATION',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * 권한을 찾을 수 없음
 */
export class RightsNotFoundException extends SubscriptionException {
  constructor() {
    super('활성 권한이 없습니다', 'RIGHTS_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}
