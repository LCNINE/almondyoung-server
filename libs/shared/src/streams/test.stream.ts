/**
 * Test Stream
 *
 * 테스트용 간단한 이벤트 스트림
 */

import { StreamConfig, EventType } from '@app/events';

// ===== Payload 타입 정의 =====

export interface TestEventCreatedPayload {
  testId: string;
  message: string;
  timestamp: number;
}

export interface TestEventProcessedPayload {
  testId: string;
  result: 'success' | 'failure';
  processingTime: number;
}

export interface TestEventDeletedPayload {
  testId: string;
  reason: string;
}

// ===== Event Types Map =====

export type TestEvents = {
  TestEventCreated: EventType<TestEventCreatedPayload>;
  TestEventProcessed: EventType<TestEventProcessedPayload>;
  TestEventDeleted: EventType<TestEventDeletedPayload>;
};

// ===== Stream Config =====

export const TEST_STREAM: StreamConfig<TestEvents> = {
  topic: {
    topic: 'test.events.v1',
    partitions: 6,  // Confluent Cloud 실제 파티션 수와 일치
  },
  aggregateType: 'Test',
  events: {
    TestEventCreated: {
      messageType: 'TestEventCreated',
      payloadType: {} as TestEventCreatedPayload,
    },
    TestEventProcessed: {
      messageType: 'TestEventProcessed',
      payloadType: {} as TestEventProcessedPayload,
    },
    TestEventDeleted: {
      messageType: 'TestEventDeleted',
      payloadType: {} as TestEventDeletedPayload,
    },
  },
};

// ===== Event Type Constants (for easy reference) =====

export const TestEventTypes = {
  CREATED: 'TestEventCreated',
  PROCESSED: 'TestEventProcessed',
  DELETED: 'TestEventDeleted',
} as const;
