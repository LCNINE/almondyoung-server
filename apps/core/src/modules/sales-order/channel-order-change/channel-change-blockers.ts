import { HttpException } from '@nestjs/common';
import type { ChannelBlocker, ChannelBlockerCode } from './channel-order-change.types';

const ADDRESS_BLOCKER_BY_CODE: Record<string, ChannelBlockerCode> = {
  SHIPMENT_ACTIVE_INVOICE: 'WAYBILL_ISSUED',
  SHIPMENT_ACTIVE_WORK_ITEM: 'SHIPMENT_IN_BATCH',
  SHIPMENT_CUSTODY_EXISTS: 'SHIPMENT_IN_BATCH',
  SHIPMENT_RECIPIENT_INCOMPLETE: 'RECIPIENT_INCOMPLETE',
  SHIPMENT_CONSOLIDATED: 'CONSOLIDATED_SHIPMENT',
};

function responseField(error: unknown, field: 'code' | 'message'): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null || !(field in response)) return undefined;
  const value: unknown = Reflect.get(response, field);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ');
  return undefined;
}

export function errorDetail(error: unknown): string {
  return responseField(error, 'message') ?? (error instanceof Error ? error.message : String(error));
}

/** 박스 수령인 수정 거절(스펙 §7.1 표) → 화면 사유. */
export function toAddressBlocker(error: unknown, shipmentId?: string): ChannelBlocker {
  const code = responseField(error, 'code');
  return {
    code: (code && ADDRESS_BLOCKER_BY_CODE[code]) || 'SHIPMENT_NOT_REVISABLE',
    ...(shipmentId ? { shipmentId } : {}),
    detail: errorDetail(error),
  };
}
