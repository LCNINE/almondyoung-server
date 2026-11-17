import type { PiiAccessRecord } from '@app/authorization';
import { TENANT_CONTEXT_KEY } from '@app/tenancy';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
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

/**
 * 접속기록 1행. 같은 eventId 가 다시 와도(이벤트 재시도) 한 번만 남는다.
 *
 * 테넌트는 열람이 일어난 맥락의 테넌트다 — 이벤트는 봉투(이벤트 문), 직원 토큰 기록은 토큰, 내부 키 기록은 호출자의 테넌트 헤더,
 * user-service 자신의 응답은 그 요청(요청 문)이 CLS 에 세운다. payload·본문에는 테넌트를 싣지 않는다. 맥락이 없으면 던진다 —
 * 기본 테넌트는 없고, 기록을 못 남긴 원문은 가린 값으로 나간다(이벤트는 DLQ).
 */
@Injectable()
export class PiiAccessCreator {
  constructor(
    private readonly repository: PiiAccessRepository,
    private readonly cls: ClsService,
  ) {}

  async record(entry: StoredPiiAccess): Promise<void> {
    const tenantId = this.cls.isActive() ? this.cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined;
    if (!tenantId) throw new Error('개인정보 접속기록의 테넌트를 모른다 — 요청·이벤트 맥락에 테넌트가 없다');
    await this.repository.insert({
      tenantId,
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
