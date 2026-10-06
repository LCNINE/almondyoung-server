// src/lib/api/domains/orders/sales-order-amendments.shape.ts
//
// 정정(amendment) 응답의 순수 정형화·문구 함수. admin-web 은 컴포넌트 테스트가 안 되므로
// 화면이 읽는 판정은 전부 여기서 하고 스펙으로 지킨다. 인터셉터가 `{ success, data }` 를 이미
// 벗기지만, 술어가 바뀌어도 화면이 조용히 비지 않게 두 모양을 다 받는다(order-collection-failures.shape 와 같은 이유).

import { parseServerError } from '@/lib/api/server-error';

export type AmendmentDelta = Record<string, unknown> & { type?: unknown };

export interface AmendmentRecord {
  id: string;
  salesOrderId: string;
  origin: string;
  status: string;
  deltas: AmendmentDelta[];
  occurredAt: string;
  dismissedAt?: string | null;
  dismissNote?: string | null;
  resyncRequestedAt?: string | null;
}

export interface AmendmentListItem extends AmendmentRecord {
  salesChannel: string;
  channelOrderId: string;
  displayOrderNo: string | null;
}

export interface AmendmentPage {
  items: AmendmentListItem[];
  nextCursor: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap(body: unknown): unknown {
  return isRecord(body) && body.success === true && 'data' in body ? body.data : body;
}

export function toAmendmentPage(body: unknown): AmendmentPage {
  const value = unwrap(body);
  if (!isRecord(value) || !Array.isArray(value.items)) return { items: [], nextCursor: null };
  return {
    items: value.items.filter(isRecord) as unknown as AmendmentListItem[],
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
  };
}

export function toAmendmentRecords(body: unknown): AmendmentRecord[] {
  const value = unwrap(body);
  return Array.isArray(value) ? (value.filter(isRecord) as unknown as AmendmentRecord[]) : [];
}

const number = new Intl.NumberFormat('ko-KR');

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function addressText(value: unknown): string {
  if (!isRecord(value)) return '';
  return [str(value.roadAddress), str(value.detailAddress)].filter(Boolean).join(' ');
}

export function summarizeDelta(delta: AmendmentDelta): string {
  const line = str(delta.channelOrderItemId);
  switch (delta.type) {
    case 'shipping_address_change':
      return `배송지 ${addressText(delta.before)} → ${addressText(delta.after)}`;
    case 'quantity_correction':
      return Number(delta.correctedQuantity) === 0
        ? `라인 ${line} 제거 (${str(delta.quantityBefore)} → 0)`
        : `라인 ${line} 수량 ${str(delta.quantityBefore)} → ${str(delta.correctedQuantity)}`;
    case 'add_product':
      return `라인 ${line} 추가 ×${str(delta.quantity)}`;
    case 'replace_product':
      return `라인 ${line} 상품 ${str(delta.channelProductIdBefore)} → ${str(delta.channelProductIdAfter)}`;
    case 'amount_correction':
      return `라인 ${line} 단가 ${number.format(Number(delta.unitPriceBefore))} → ${number.format(Number(delta.unitPriceAfter))}`;
    case 'unmatched_line':
      return '채널 라인 id 없는 라인';
    default:
      return str(delta.type);
  }
}

const BLOCKER_LABELS: Record<string, string> = {
  WAYBILL_ISSUED: '송장 발급됨',
  SHIPMENT_IN_BATCH: '출고 작업 중',
  SHIPMENT_NOT_REVISABLE: '박스 수정 불가',
  CONSOLIDATED_SHIPMENT: '합포장 박스',
  RECIPIENT_INCOMPLETE: '주소 불완전',
  CANCEL_NOT_IMMEDIATE: '즉시 취소 불가',
  ALL_LINES_REMOVED: '전 라인 제거',
  LINE_IDENTITY_MISSING: '라인 식별 불가',
  OUT_OF_SCOPE: '자동 반영 범위 밖',
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABELS[code] ?? code;
}

/** pending 델타의 사유 코드들. */
export function blockerCodes(delta: AmendmentDelta): string[] {
  return Array.isArray(delta.blockers)
    ? delta.blockers.flatMap((blocker) => (isRecord(blocker) && typeof blocker.code === 'string' ? [blocker.code] : []))
    : [];
}

/** «다시 확인»은 결과가 돌아오지 않는다(스펙 D5) — 요청 시각만 보여 주고, 오래 그대로면 사람이 알아챈다. */
export function resyncLabel(resyncRequestedAt: string | null | undefined, now: Date): string | null {
  if (!resyncRequestedAt) return null;
  const at = new Date(resyncRequestedAt).getTime();
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) return '확인 요청 방금';
  if (minutes < 60) return `확인 요청 ${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `확인 요청 ${hours}시간 전`;
  return `확인 요청 ${Math.floor(hours / 24)}일 전`;
}

const shortDate = new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });

export function dismissedLabel(record: Pick<AmendmentRecord, 'dismissedAt' | 'dismissNote'>): string {
  const parts = ['무시됨'];
  if (record.dismissedAt) parts.push(shortDate.format(new Date(record.dismissedAt)));
  if (record.dismissNote) parts.push(record.dismissNote);
  return parts.join(' · ');
}

/**
 * 무시·다시 확인이 409 로 거절됐는가. 409 는 그 행이 이미 닫혔거나 새 변경에 대체됐다는 뜻이라 다시 읽은 목록이 답이다 —
 * 알릴 것이 없다. 그 밖의 실패는 아무것도 바뀌지 않았으니 알려야 한다(안 알리면 클릭이 먹힌 줄 안다).
 */
export function isConflict(error: unknown): boolean {
  return parseServerError(error).conflict;
}
