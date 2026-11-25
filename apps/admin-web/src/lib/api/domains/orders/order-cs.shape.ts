// 정체 보드 «CS» 응답 정형·표기 순수 함수.
// 서버 원형: apps/core/src/modules/fulfillment/order-progress/order-cs.reader.ts,
// apps/core/src/modules/customer-service/dto/order-contact.dto.ts

import { toShipmentPhase, type ShipmentPhase } from './shipment-phase.shape';

export type ContactOutcome = 'reached' | 'no_answer' | 'messaged';

export const CONTACT_OUTCOMES: { key: ContactOutcome; label: string }[] = [
  { key: 'reached', label: '통화함' },
  { key: 'no_answer', label: '부재' },
  { key: 'messaged', label: '문자·카톡 보냄' },
];

export interface LastContact {
  outcome: ContactOutcome;
  authorId: string;
  at: string;
  followUpOn: string | null;
}
export interface CsBrief {
  customerPhone: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  totalAmount: number | null;
  firstItemName: string | null;
  firstItemQty: number | null;
  itemCount: number;
  hasMemo: boolean;
  lastContact: LastContact | null;
}
export interface CsBox {
  shipmentId: string;
  fulfillmentOrderId: string;
  status: string;
  carrier: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
}
export interface CsOtherOrder {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  orderedAt: string;
  totalAmount: number | null;
  phase: ShipmentPhase | null;
  sameAddress: boolean;
  matchedBy: 'customer' | 'phone';
}
export interface CsContext {
  boxes: CsBox[];
  otherOrders: CsOtherOrder[];
  moreOtherOrders: boolean;
}
export interface OrderContact extends LastContact {
  id: string;
  body: string;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const unwrap = (body: unknown): unknown => {
  const v = rec(body);
  return v && v.success === true && 'data' in v ? v.data : body;
};
const outcomeOf = (v: unknown): ContactOutcome | null =>
  CONTACT_OUTCOMES.find((o) => o.key === v)?.key ?? null;

function toLastContact(value: unknown): LastContact | null {
  const v = rec(value);
  const outcome = outcomeOf(v?.outcome);
  const authorId = str(v?.authorId);
  const at = str(v?.at);
  if (!v || !outcome || !authorId || !at) return null;
  return { outcome, authorId, at, followUpOn: str(v.followUpOn) };
}

/** 옛 core 응답이면 null — 빈 값으로 그리지 않는다. */
export function toCsBrief(value: unknown): CsBrief | null {
  const v = rec(value);
  const itemCount = num(v?.itemCount);
  if (!v || itemCount === null) return null;
  return {
    customerPhone: str(v.customerPhone),
    recipientName: str(v.recipientName),
    recipientPhone: str(v.recipientPhone),
    totalAmount: num(v.totalAmount),
    firstItemName: str(v.firstItemName),
    firstItemQty: num(v.firstItemQty),
    itemCount,
    hasMemo: v.hasMemo === true,
    lastContact: toLastContact(v.lastContact),
  };
}

/** 모양이 다르면 던진다 — «없음»이 아니라 «못 읽음»으로 보여야 한다. */
export function toCsContext(body: unknown): CsContext {
  const v = rec(unwrap(body));
  if (!v || !Array.isArray(v.boxes) || !Array.isArray(v.otherOrders))
    throw new Error('CS 상세 응답을 읽지 못했습니다.');
  return {
    boxes: v.boxes.map((raw) => {
      const b = rec(raw) ?? {};
      return {
        shipmentId: String(b.shipmentId),
        fulfillmentOrderId: String(b.fulfillmentOrderId),
        status: String(b.status),
        carrier: str(b.carrier),
        trackingNo: str(b.trackingNo),
        shippedAt: str(b.shippedAt),
      };
    }),
    otherOrders: v.otherOrders.map((raw) => {
      const o = rec(raw) ?? {};
      return {
        salesOrderId: String(o.salesOrderId),
        orderNo: String(o.orderNo),
        channelOrderId: String(o.channelOrderId),
        salesChannel: String(o.salesChannel),
        orderedAt: String(o.orderedAt),
        totalAmount: num(o.totalAmount),
        phase: toShipmentPhase(o.phase),
        sameAddress: o.sameAddress === true,
        matchedBy: o.matchedBy === 'customer' ? 'customer' : 'phone',
      };
    }),
    moreOtherOrders: v.moreOtherOrders === true,
  };
}

export function toOrderContacts(body: unknown): OrderContact[] {
  const v = rec(unwrap(body));
  if (!v || !Array.isArray(v.items))
    throw new Error('연락 기록 응답을 읽지 못했습니다.');
  return v.items.flatMap((raw) => {
    const r = rec(raw);
    const last = toLastContact({ ...r, at: r?.createdAt });
    return last && r
      ? [{ ...last, id: String(r.id), body: str(r.body) ?? '' }]
      : [];
  });
}

export const outcomeLabel = (outcome: ContactOutcome): string =>
  CONTACT_OUTCOMES.find((o) => o.key === outcome)?.label ?? outcome;

const digits = (phone: string) => phone.replace(/\D/g, '');

/** 가려진 값이면 복사해도 쓸 수 없다 */
export const isMaskedText = (value: string): boolean =>
  value.includes('*') || value === '[가림]';

export interface ContactPerson {
  who: string;
  name: string | null;
  phone: string | null;
}

/** 줄에 보일 사람 — 받는 분이 주문자와 같으면 한 사람으로 합친다. */
export function contactPeople(
  customerName: string | null,
  cs: CsBrief
): ContactPerson[] {
  const customer = {
    who: '주문자',
    name: customerName,
    phone: cs.customerPhone,
  };
  const recipient = {
    who: '받는 분',
    name: cs.recipientName,
    phone: cs.recipientPhone,
  };
  if (!recipient.name && !recipient.phone) return [customer];
  const sameName = !recipient.name || recipient.name === customer.name;
  const samePhone =
    !recipient.phone ||
    (customer.phone !== null &&
      digits(customer.phone) === digits(recipient.phone));
  if (sameName && samePhone) return [customer];
  // 주문자 연락처가 없는 채널 — 받는 분이 같은 사람이면 그 번호가 연락처다
  if (sameName && !customer.phone)
    return [{ ...customer, phone: recipient.phone }];
  return [customer, recipient];
}

export function goodsText(cs: CsBrief): string {
  if (!cs.firstItemName) return '상품 없음';
  const first = `${cs.firstItemName} ${(cs.firstItemQty ?? 0).toLocaleString('ko-KR')}개`;
  return cs.itemCount > 1
    ? `${first} 외 ${(cs.itemCount - 1).toLocaleString('ko-KR')}종`
    : first;
}

/** today 는 한국 날짜(YYYY-MM-DD) */
export function followUpText(
  followUpOn: string | null,
  today: string
): { text: string; due: boolean } | null {
  if (!followUpOn) return null;
  const md = followUpOn.slice(5);
  if (followUpOn > today) return { text: `${md} 다시 연락`, due: false };
  return {
    text: followUpOn === today ? '오늘 다시 연락' : `${md} 다시 연락 — 지남`,
    due: true,
  };
}
