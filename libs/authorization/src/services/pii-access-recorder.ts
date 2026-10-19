import type { PiiKind } from '@app/shared/pii';
import type { PiiSubjectType } from '../decorators/pii-response.decorator';
import type { OwnerService } from '../permissions/permission.types';

/** 한 행에 담는 대상 식별자 상한. 실제 건수는 `subjectCount` 로 따로 남는다. */
export const PII_ACCESS_SUBJECT_CAP = 1000;

export type PiiAccessAction = 'view' | 'reveal' | 'export';

/**
 * 개인정보 접속기록 1행 — 원문 값은 담지 않는다(대상 식별자·종류·건수만).
 * 개인정보의 안전성 확보조치 기준의 접속기록 항목(식별자·일시·접속지·정보주체·수행업무)을 채운다.
 */
export interface PiiAccessRecord {
  readonly eventId: string;
  readonly actorUserId: string;
  readonly actorLoginId: string | null;
  readonly claimedIp: string | null;
  readonly peerIp: string | null;
  readonly forwardedFor: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly sourceService: OwnerService;
  readonly method: string;
  readonly route: string;
  readonly action: PiiAccessAction;
  readonly subjects: readonly { readonly type: PiiSubjectType; readonly id: string }[];
  readonly subjectCount: number;
  readonly kinds: readonly PiiKind[];
  readonly queryKeys: readonly string[];
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/**
 * 앱마다 구현한다 — 아웃박스가 있는 앱은 이벤트로, 없는 앱은 user-service 기록 API 로, user-service 는 직접.
 * 실패하면 throw 한다: 기록을 남기지 못한 원문은 내보내지 않는다.
 */
export abstract class PiiAccessRecorder {
  abstract record(entry: PiiAccessRecord): Promise<void>;
}

/** 기록할 경로가 없는 환경(이벤트 브로커 없이 띄운 로컬 등) — 항상 실패해서 원문 대신 가린 값이 나간다. */
export class UnavailablePiiAccessRecorder extends PiiAccessRecorder {
  record(): Promise<void> {
    return Promise.reject(new Error('pii access log is not available in this environment'));
  }
}
