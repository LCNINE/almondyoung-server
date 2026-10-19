/**
 * IAM Stream — 관리자 권한·개인정보 접속기록.
 *
 * `PiiAccessed` 는 개인정보 원문을 직원에게 내보낸 서비스가 아웃박스로 적재하고 user-service 가 접속기록 표에 모은다.
 * 원문 값은 싣지 않는다 — 대상 식별자·종류·건수만.
 */

import { z } from 'zod';
import { event, stream } from '../types';

export const PII_ACCESS_SUBJECT_LIMIT = 1000;

export const PiiAccessedSchema = z
  .object({
    eventId: z.string().uuid(),
    actorUserId: z.string().min(1),
    actorLoginId: z.string().nullable(),
    claimedIp: z.string().max(45).nullable(),
    peerIp: z.string().max(45).nullable(),
    forwardedFor: z.string().max(500).nullable(),
    userAgent: z.string().max(500).nullable(),
    requestId: z.string().max(500).nullable(),
    sourceService: z.string().min(1).max(40),
    method: z.string().min(1).max(10),
    route: z.string().min(1).max(500),
    action: z.enum(['view', 'reveal', 'export']),
    subjects: z
      .array(z.object({ type: z.string().min(1).max(40), id: z.string().min(1).max(200) }))
      .max(PII_ACCESS_SUBJECT_LIMIT),
    subjectCount: z.number().int().nonnegative(),
    kinds: z.array(z.string().min(1).max(20)),
    queryKeys: z.array(z.string().max(100)).max(100),
    reason: z.string().max(200).nullable(),
    occurredAt: z.string().datetime(),
  })
  .refine((payload) => payload.action !== 'export' || (payload.reason ?? '').trim().length > 0, {
    message: 'export needs a reason',
    path: ['reason'],
  })
  .refine((payload) => payload.subjectCount >= payload.subjects.length, {
    message: 'subjectCount must cover the subjects carried',
    path: ['subjectCount'],
  });

export type PiiAccessedPayload = z.infer<typeof PiiAccessedSchema>;

export function iamEventPartitionKey<TPayload extends { actorUserId: string }>(payload: TPayload): string {
  return payload.actorUserId;
}

export const IAM_STREAM = stream({
  topic: 'iam.events.v1',
  partitions: 3,
  aggregateType: 'PiiAccess',
  events: {
    PiiAccessed: event('PiiAccessed', PiiAccessedSchema),
  },
  partitionKey: iamEventPartitionKey,
});

export type IamEvents = typeof IAM_STREAM.events;
