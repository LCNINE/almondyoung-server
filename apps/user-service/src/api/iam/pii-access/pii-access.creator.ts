import type { PiiAccessRecord } from '@app/authorization';
import { Injectable } from '@nestjs/common';
import { PiiAccessRepository } from './pii-access.repository';

/**
 * 저장 입력. 라이브러리의 `PiiAccessRecord` 보다 느슨하다 — 이벤트·HTTP 로 들어온 문자열을 그대로 받는다
 * (종류·대상 이름은 보낸 쪽 계약이 검사한다).
 */
export type StoredPiiAccess = Omit<PiiAccessRecord, 'sourceService' | 'kinds' | 'subjects'> & {
  readonly sourceService: string;
  readonly kinds: readonly string[];
  readonly subjects: readonly { readonly type: string; readonly id: string }[];
};

/** 접속기록 1행. 같은 eventId 가 다시 와도(이벤트 재시도) 한 번만 남는다. */
@Injectable()
export class PiiAccessCreator {
  constructor(private readonly repository: PiiAccessRepository) {}

  record(entry: StoredPiiAccess): Promise<void> {
    return this.repository.insert({
      eventId: entry.eventId,
      occurredAt: entry.occurredAt,
      actorUserId: entry.actorUserId,
      actorLoginId: entry.actorLoginId?.slice(0, 30) ?? null,
      claimedIp: entry.claimedIp,
      peerIp: entry.peerIp,
      forwardedFor: entry.forwardedFor,
      userAgent: entry.userAgent,
      requestId: entry.requestId?.slice(0, 100) ?? null,
      sourceService: entry.sourceService,
      method: entry.method,
      route: entry.route,
      action: entry.action,
      subjects: entry.subjects.map((s) => ({ type: s.type, id: s.id })),
      subjectCount: entry.subjectCount,
      kinds: [...entry.kinds],
      queryKeys: [...entry.queryKeys],
      reason: entry.reason,
    });
  }
}
