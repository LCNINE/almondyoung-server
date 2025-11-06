/**
 * Test Stream
 *
 * 테스트용 간단한 이벤트 스트림
 */

import { event, stream } from '../types';

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

// ===== Stream Config (타입 안전 버전) =====

export const TEST_STREAM = stream({
  topic: 'test.events.v1',
  partitions: 6,  // Confluent Cloud 실제 파티션 수와 일치
  aggregateType: 'Test',
  events: {
    TestEventCreated: event<'TestEventCreated', TestEventCreatedPayload>('TestEventCreated'),
    TestEventProcessed: event<'TestEventProcessed', TestEventProcessedPayload>('TestEventProcessed'),
    TestEventDeleted: event<'TestEventDeleted', TestEventDeletedPayload>('TestEventDeleted'),
  },
});

// ===== 타입 추론 =====

export type TestEvents = typeof TEST_STREAM.events;
