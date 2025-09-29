import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 모듈에서 사용할 기본 예외 클래스
 */
export class SubscriptionException extends HttpException {
  constructor(
    message: string,
    public readonly code: string,
    statusCode: HttpStatus,
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

// =================================================================
// 리팩토링 후에도 계속 사용할 핵심 예외들
// =================================================================

/**
 * 구독 계약을 찾을 수 없을 때 사용합니다.
 */
export class SubscriptionNotFoundException extends SubscriptionException {
  constructor() {
    super(
      '활성 구독 계약이 없습니다.',
      'SUBSCRIPTION_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 사용자에게 부여된 권한을 찾을 수 없을 때 사용합니다.
 */
export class EntitlementNotFoundException extends SubscriptionException {
  constructor() {
    super(
      '유효한 구독 권한이 없습니다.',
      'ENTITLEMENT_NOT_FOUND',
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * 요청된 플랜을 찾을 수 없을 때 사용합니다.
 */
export class PlanNotFoundException extends SubscriptionException {
  constructor() {
    super('유효하지 않은 플랜입니다.', 'PLAN_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

/**
 * 사용자가 이미 활성 구독을 가지고 있을 때 사용합니다.
 */
export class ActiveSubscriptionExistsException extends SubscriptionException {
  constructor() {
    super(
      '이미 활성 구독이 존재합니다.',
      'ACTIVE_SUBSCRIPTION_EXISTS',
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * [변경] 정책 위반 시 사용합니다.
 * 생성자가 단일 메시지(string)를 받도록 수정되었습니다.
 */
export class PolicyViolationException extends SubscriptionException {
  constructor(message: string) {
    super(`정책 위반: ${message}`, 'POLICY_VIOLATION', HttpStatus.BAD_REQUEST);
  }
}

export class BadRequestException extends SubscriptionException {
  constructor(message: string) {
    super(message, 'BAD_REQUEST', HttpStatus.BAD_REQUEST);
  }
}

// =================================================================
// [제거] 아래 예외들은 PolicyViolationException으로 대체되거나,
// 서비스 로직 내 일반 예외로 처리되어 더 이상 필요하지 않습니다.
// =================================================================
// export class InvalidPlanChangeException extends SubscriptionException { ... }
// export class PauseQuotaExceededException extends SubscriptionException { ... }
// export class SubscriptionPausedException extends SubscriptionException { ... }
// export class InsufficientPermissionException extends SubscriptionException { ... }
// export class EventPublishException extends SubscriptionException { ... }
