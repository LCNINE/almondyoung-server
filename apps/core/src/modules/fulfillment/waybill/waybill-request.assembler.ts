import { BadRequestError } from '@app/shared';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import type { WaybillRequest } from './carrier/carrier-gateway.interface';
import { deriveCustOrdNo } from './cust-ord-no';
import { WAYBILL } from './waybill.constants';
import type { ManifestLineLite, WaybillRecipient } from './waybill.types';

const REQUIRED = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'] as const;

export function parseRecipient(snapshot: unknown): WaybillRecipient {
  const r = (snapshot ?? {}) as Record<string, unknown>;
  const missing = REQUIRED.filter((k) => typeof r[k] !== 'string' || !r[k].trim());
  if (missing.length) {
    throw new BadRequestError(`${WAYBILL.ERROR.RECIPIENT_INCOMPLETE}: missing ${missing.join(',')}`);
  }
  const note = typeof r.deliveryNote === 'string' && r.deliveryNote.trim() ? r.deliveryNote : undefined;
  return {
    recipientName: r.recipientName as string,
    phone: r.phone as string,
    postalCode: r.postalCode as string,
    roadAddress: r.roadAddress as string,
    detailAddress: r.detailAddress as string,
    deliveryNote: note,
  };
}

export interface AssembleInput {
  shipmentId: string;
  recipientSnapshot: unknown;
  lines: ManifestLineLite[];
  config: HanjinConfig;
  /** 송장에만 싣고 저장하지 않는다. shipments.entrance_password 에서 온다. */
  entrancePassword?: string | null;
}

/**
 * 배송 메시지 = 메모 라벨 + 공동현관 비번. 합성 결과는 어디에도 저장하지 않는다.
 * 운송장 라벨(#913)도 이 함수를 쓴다 — 한진에 보낸 문자열과 라벨 문자열이 같은 함수에서 나와야 한다.
 */
export function composeMessage(deliveryNote: string | undefined, entrancePassword: string | null | undefined) {
  const parts = [deliveryNote, entrancePassword ? `공동현관 ${entrancePassword}` : undefined].filter(
    (part): part is string => !!part,
  );
  if (parts.length === 0) return undefined;
  return parts.length === 2 ? `${parts[0]} (${parts[1]})` : parts[0];
}

/** 품명 = 첫 상품명 + 「외 N건」. 한진 등록값과 라벨 품명이 같은 함수에서 나온다(#913). */
export function commodityNameOf(lines: readonly ManifestLineLite[]): string {
  const head = lines[0]?.productName ?? '';
  return lines.length > 1 ? `${head} 외 ${lines.length - 1}건` : head;
}

export function assembleWaybillRequest(input: AssembleInput): WaybillRequest {
  const rc = parseRecipient(input.recipientSnapshot);
  const items = input.lines.map((l) => ({ name: l.productName, quantity: l.quantity }));
  const commodityName = commodityNameOf(input.lines);
  return {
    custOrdNo: deriveCustOrdNo(input.shipmentId),
    recipient: {
      name: rc.recipientName,
      zip: rc.postalCode,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
      // 스냅샷의 연락처는 단일 phone 필드(=휴대폰)뿐이라 carrier 중립 요청에는 mobile 로만 싣는다.
      // 한진은 rcvrTelNo(전화번호)가 필수·rcvrMobileNo 가 선택이므로(정본 §4.2 19·20번)
      // 그 폴백은 한진 게이트웨이가 한다 — 여기서 tel 이 비는 것은 누락이 아니라 위임이다.
      mobile: rc.phone,
      message: composeMessage(rc.deliveryNote, input.entrancePassword),
    },
    sender: input.config.sender,
    items,
    commodityName,
    boxType: input.config.boxType,
    payType: input.config.payType,
  };
}
