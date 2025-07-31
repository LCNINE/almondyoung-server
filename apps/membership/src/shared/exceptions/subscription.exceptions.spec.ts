import { HttpStatus } from '@nestjs/common';
import {
  SubscriptionException,
  SubscriptionNotFoundException,
  InvalidPlanChangeException,
  PauseQuotaExceededException,
  SubscriptionPausedException,
  PlanNotFoundException,
  ActiveSubscriptionExistsException,
  InsufficientPermissionException,
  EventPublishException,
  PolicyViolationException,
} from './subscription.exceptions';

describe('Subscription Exceptions', () => {
  describe('SubscriptionException', () => {
    it('should create base exception with correct properties', () => {
      const exception = new SubscriptionException(
        'Test message',
        'TEST_CODE',
        HttpStatus.BAD_REQUEST,
      );

      expect(exception.message).toBe('Test message');
      expect(exception.code).toBe('TEST_CODE');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('should use default status code when not provided', () => {
      const exception = new SubscriptionException('Test message', 'TEST_CODE');

      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('SubscriptionNotFoundException', () => {
    it('should create exception with correct properties', () => {
      const exception = new SubscriptionNotFoundException();

      expect(exception.message).toBe('활성 구독이 없습니다');
      expect(exception.code).toBe('SUBSCRIPTION_NOT_FOUND');
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('InvalidPlanChangeException', () => {
    it('should create exception with custom reason', () => {
      const reason = '동일한 티어로는 변경할 수 없습니다';
      const exception = new InvalidPlanChangeException(reason);

      expect(exception.message).toBe(`플랜 변경이 불가능합니다: ${reason}`);
      expect(exception.code).toBe('INVALID_PLAN_CHANGE');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('PauseQuotaExceededException', () => {
    it('should create exception with usage information', () => {
      const used = 3;
      const limit = 2;
      const exception = new PauseQuotaExceededException(used, limit);

      expect(exception.message).toBe(`연간 일시정지 한도를 초과했습니다 (${used}/${limit})`);
      expect(exception.code).toBe('PAUSE_QUOTA_EXCEEDED');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('SubscriptionPausedException', () => {
    it('should create exception with action information', () => {
      const action = '플랜 변경';
      const exception = new SubscriptionPausedException(action);

      expect(exception.message).toBe(`일시정지 중에는 ${action}을(를) 할 수 없습니다`);
      expect(exception.code).toBe('SUBSCRIPTION_PAUSED');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('PlanNotFoundException', () => {
    it('should create exception with correct properties', () => {
      const exception = new PlanNotFoundException();

      expect(exception.message).toBe('유효하지 않은 플랜입니다');
      expect(exception.code).toBe('PLAN_NOT_FOUND');
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('ActiveSubscriptionExistsException', () => {
    it('should create exception with correct properties', () => {
      const exception = new ActiveSubscriptionExistsException();

      expect(exception.message).toBe('이미 활성 구독이 있습니다');
      expect(exception.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
      expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    });
  });

  describe('InsufficientPermissionException', () => {
    it('should create exception with action information', () => {
      const action = '관리자 기능 접근';
      const exception = new InsufficientPermissionException(action);

      expect(exception.message).toBe(`${action}에 대한 권한이 없습니다`);
      expect(exception.code).toBe('INSUFFICIENT_PERMISSION');
      expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('EventPublishException', () => {
    it('should create exception with event type information', () => {
      const eventType = 'SUBSCRIPTION_CREATED';
      const exception = new EventPublishException(eventType);

      expect(exception.message).toBe(`이벤트 발행에 실패했습니다: ${eventType}`);
      expect(exception.code).toBe('EVENT_PUBLISH_FAILED');
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('PolicyViolationException', () => {
    it('should create exception with policy information', () => {
      const policyType = 'MAX_PAUSES_PER_YEAR';
      const details = '연간 최대 2회까지만 일시정지 가능';
      const exception = new PolicyViolationException(policyType, details);

      expect(exception.message).toBe(`정책 위반: ${policyType} - ${details}`);
      expect(exception.code).toBe('POLICY_VIOLATION');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});