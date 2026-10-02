import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@app/shared';
import { NhnAlimtalkClient } from '../clients/nhn-alimtalk.client';
import { AlimtalkRepository, AutoSendRow } from '../repositories/alimtalk.repository';
import { maskPhone } from '../utils/mask-phone';
import { outcomeOf } from './alimtalk-campaign.reader';
import { billingFailedNoticeKey, terminatedNoticeKey } from '../../dispatcher/handlers/membership-notice-keys';
import { LookupMembershipNoticesDto } from '../dto';

const PAGE_SIZE = 50;

export interface AlimtalkAutoSendItem {
  notificationId: string;
  eventKey: string | null;
  eventName: string | null;
  templateCode: string | null;
  recipientName: string;
  /** 010-****-1234. 번호가 없으면 빈 문자열 */
  phone: string;
  /** 우리 쪽 상태: SENT = NHN 이 접수, FAILED = 접수 거절·오류, 그 밖은 처리 전 */
  status: string;
  createdAt: string;
  sentAt: string | null;
  /** 밤 시간이라 NHN 예약 발송으로 미룬 시각(KST, 'YYYY-MM-DD HH:mm') */
  scheduledFor: string | null;
  /** NHN 요청 번호. 있어야 받았는지를 물을 수 있다 */
  requestId: string | null;
  error: string | null;
}

export interface AlimtalkAutoSendResult {
  notificationId: string;
  /** NHN 에 물어본 수신 결과. 접수되지 않은 건은 NOT_ACCEPTED */
  outcome: 'kakao' | 'sms' | 'failed' | 'inProgress' | 'NOT_ACCEPTED';
  detail: string | null;
}

/** 멤버십 요금 안내 한 건의 발송 기록. 기록이 없으면 found=false(이벤트를 아직 못 받았거나 꺼져 있던 때) */
export interface MembershipNoticeStatus {
  /** 묻는 쪽이 넘긴 것을 그대로 돌려준다: 'attempt:<invoiceId>:<회차>' | 'terminated:<contractId>' */
  ref: string;
  found: boolean;
  notificationId: string | null;
  status: string | null;
  sentAt: string | null;
  scheduledFor: string | null;
  error: string | null;
}

const text = (source: Record<string, unknown> | null | undefined, key: string): string | null => {
  const value = source?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nested = (source: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null => {
  const value = source?.[key];
  return isRecord(value) ? value : null;
};

export function toAutoSendItem(row: AutoSendRow): AlimtalkAutoSendItem {
  const phoneNumber = text(row.payload, 'phoneNumber');
  return {
    notificationId: row.notificationId,
    eventKey: row.eventKey,
    eventName: row.eventName,
    templateCode: text(row.metadata, 'templateCode'),
    recipientName: text(row.payload, 'name') ?? text(nested(row.metadata, 'templateParameters'), 'name') ?? '',
    phone: phoneNumber ? maskPhone(phoneNumber) : '',
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    scheduledFor: text(row.metadata, 'requestDate'),
    requestId: text(row.metadata, 'messageId'),
    error: row.errorDetails?.message ?? null,
  };
}

/**
 * 사건이 생겨 자동으로 나간 알림톡(출금 실패·해지 안내 등)의 기록. 관리자 캠페인 목록과 따로 본다.
 * 받았는지(카카오·문자 대체·못 받음)는 저장하지 않고 볼 때 NHN 에 묻는다 — 캠페인 결과와 같은 판정을 쓴다.
 */
@Injectable()
export class AlimtalkAutoSendReader {
  constructor(
    private readonly repository: AlimtalkRepository,
    private readonly client: NhnAlimtalkClient,
  ) {}

  async list(before?: Date): Promise<{ items: AlimtalkAutoSendItem[]; nextBefore: string | null }> {
    const rows = await this.repository.listAutoSends(PAGE_SIZE, before);
    const items = rows.map(toAutoSendItem);
    return { items, nextBefore: rows.length === PAGE_SIZE ? items[items.length - 1].createdAt : null };
  }

  /** 받았는지(카카오 도착)는 묻지 않는다 — 건마다 NHN 을 부르면 화면 한 장이 외부 호출 수백 번이 된다 */
  async lookupMembershipNotices(dto: LookupMembershipNoticesDto): Promise<MembershipNoticeStatus[]> {
    const refs = [
      ...(dto.attempts ?? []).map((a) => ({
        ref: `attempt:${a.invoiceId}:${a.attemptNo}`,
        key: billingFailedNoticeKey(a.invoiceId, a.attemptNo),
      })),
      ...(dto.terminations ?? []).map((t) => ({
        ref: `terminated:${t.contractId}`,
        key: terminatedNoticeKey(t.contractId),
      })),
    ];
    const rows = await this.repository.findAutoSendsByKeys([...new Set(refs.map((r) => r.key))]);
    const byKey = new Map(rows.map((row) => [row.idempotencyKey, toAutoSendItem(row)]));
    return refs.map(({ ref, key }) => {
      const item = byKey.get(key);
      return {
        ref,
        found: !!item,
        notificationId: item?.notificationId ?? null,
        status: item?.status ?? null,
        sentAt: item?.sentAt ?? null,
        scheduledFor: item?.scheduledFor ?? null,
        error: item?.error ?? null,
      };
    });
  }

  async result(notificationId: string): Promise<AlimtalkAutoSendResult> {
    const row = await this.repository.findAutoSend(notificationId);
    if (!row) throw new NotFoundError(`자동 발송 알림톡을 찾을 수 없습니다: ${notificationId}`);
    const item = toAutoSendItem(row);
    if (!item.requestId) return { notificationId, outcome: 'NOT_ACCEPTED', detail: item.error };

    const [message] = await this.client.listMessageResults(item.requestId);
    if (!message) return { notificationId, outcome: 'inProgress', detail: null };
    const outcome = outcomeOf(message);
    return {
      notificationId,
      outcome,
      detail: outcome === 'failed' ? message.resendStatusName || message.resultCodeName : null,
    };
  }
}
