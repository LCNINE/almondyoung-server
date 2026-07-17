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
}

export function assembleWaybillRequest(input: AssembleInput): WaybillRequest {
  const rc = parseRecipient(input.recipientSnapshot);
  const items = input.lines.map((l) => ({ name: l.productName, quantity: l.quantity }));
  const head = input.lines[0]?.productName ?? '';
  const commodityName = input.lines.length > 1 ? `${head} 외 ${input.lines.length - 1}건` : head;
  return {
    custOrdNo: deriveCustOrdNo(input.shipmentId),
    recipient: {
      name: rc.recipientName,
      zip: rc.postalCode,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
      mobile: rc.phone, // 스냅샷은 phone 단일필드 → mobile 로(§조사4). tel 은 생략.
      message: rc.deliveryNote,
    },
    sender: input.config.sender,
    items,
    commodityName,
    boxType: input.config.boxType,
    payType: input.config.payType,
  };
}
