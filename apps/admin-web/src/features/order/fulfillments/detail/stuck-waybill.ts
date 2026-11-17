// 멈춘 송장 발급(pending/allocated)을 운영자가 끊고 다시 발급하는 화면의 판정·문구 (#1241).
// 서버(waybill.manager.ts abandon)가 실제 경계다 — 여기는 보여 줄지와 무엇을 경고할지만 정한다.

import { getServerDenyMessage, parseServerError } from '@/lib/api/server-error';
import { retryNoticeOf } from '@/lib/services/orders/waybill-policy';
import type { ShipmentWaybillHistory } from '@/lib/types/dto/fulfillment';

export interface StuckWaybill {
  waybill: ShipmentWaybillHistory;
  // 상자 내용이 발급을 시작할 때와 다르다 — 이어 가면 옛 내용으로 등록되므로 끊고 다시 발급해야 한다.
  // 수하인만 바뀐 경우는 화면이 알 수 없다(서버만 recipientHash 를 본다). 그때도 멈춘 행은 보이므로 끊을 수 있다.
  contentChanged: boolean;
  retryNotice: string | null;
}

export function stuckWaybillOf(
  shipment: { manifestVersion: number; waybills?: ShipmentWaybillHistory[] },
  now: Date = new Date()
): StuckWaybill | null {
  const waybill = (shipment.waybills ?? []).find(
    (w) => w.status === 'pending' || w.status === 'allocated'
  );
  if (!waybill) return null;
  return {
    waybill,
    contentChanged: waybill.manifestVersion !== shipment.manifestVersion,
    retryNotice: retryNoticeOf(waybill.status, waybill.nextAttemptAt, now),
  };
}

export function stuckReason(stuck: StuckWaybill): string | null {
  if (stuck.contentChanged) {
    return '상자 내용이 발급을 시작할 때와 달라 이어서 발급할 수 없어요.';
  }
  return stuck.retryNotice;
}

// 누르기 전에 읽어야 할 위험. «한진에 무엇이 남는지»가 상태마다 다르다.
export function abandonRisks(stuck: StuckWaybill): string[] {
  const { waybill } = stuck;
  const first =
    waybill.status === 'allocated'
      ? `한진 송장번호 ${waybill.trackingNo ?? ''}는 받았지만, 한진에 주문이 등록됐는지는 확인되지 않았어요. 이 번호는 버리고 새 번호를 받아요. 이 번호로 뽑은 송장이 있으면 붙이지 마세요.`
      : '한진에서 송장번호를 받았는지 확인되지 않았어요. 받았더라도 그 번호는 쓰지 않고 새 번호를 받아요.';
  return [
    first,
    '집하하지 않은 번호는 비용이 들지 않아요.',
    '다른 화면에서 지금 발급하는 중이면 끝날 때까지 기다리세요.',
  ];
}

// core 의 waybill 거절은 상태 코드(CONFLICT 등)만 code 에 싣고 세부 코드는 메시지 앞 `WAYBILL_…:` 로 싣는다.
const WAYBILL_CODE = /^(WAYBILL_[A-Z_]+):?\s*([\s\S]*)$/;

function abandonNotAllowed(detail: string): string {
  if (detail.includes('reason required')) return '중단 사유를 적어 주세요.';
  if (detail.includes('operator abandon required')) {
    return '멈춘 발급이 있어요. 먼저 발급을 중단하세요.';
  }
  if (detail.includes('changed concurrently')) {
    return '그 사이 송장 상태가 바뀌었어요. 화면을 다시 확인하세요.';
  }
  if (/\bis (registered|used)\b/.test(detail)) {
    return '그 사이 발급이 끝났어요. 중단할 필요가 없어요.';
  }
  return '이미 끝난 발급이에요. 새로 발급하면 돼요.';
}

function notDispatchable(detail: string): string {
  return /^shipment [a-z_]+$/.test(detail)
    ? '계획을 확정한 상자만 송장을 발급할 수 있어요. 출고 준비 화면에서 다시 준비하세요.'
    : '발송할 수 있는 송장이 없어요.';
}

const COPY: Record<string, string | ((detail: string) => string)> = {
  WAYBILL_ABANDON_NOT_ALLOWED: abandonNotAllowed,
  WAYBILL_NOT_DISPATCHABLE: notDispatchable,
  WAYBILL_NOT_FOUND: '송장을 찾을 수 없어요. 화면을 새로 고쳐 주세요.',
  WAYBILL_SHIPMENT_NOT_FOUND: '상자를 찾을 수 없어요. 화면을 새로 고쳐 주세요.',
  WAYBILL_ACTIVE_EXISTS: '이 상자에 이미 진행 중인 송장이 있어요.',
  WAYBILL_STALE_MANIFEST_VERSION:
    '그 사이 상자 내용이 바뀌었어요. 화면을 다시 확인하고 발급하세요.',
  WAYBILL_NEEDS_REVIEW:
    '상자 내용이 바뀌어 멈춘 송장을 이어 갈 수 없어요. 발급을 중단하고 다시 발급하세요.',
  WAYBILL_CARRIER_NOT_CONFIGURED:
    '택배사 연동 설정이 비어 있어요. 개발팀에 알려 주세요.',
  WAYBILL_RECIPIENT_INCOMPLETE: '받는 분 정보가 비어 있어요.',
  WAYBILL_ALREADY_DISPATCHED: '이미 발송에 쓴 송장이에요.',
  WAYBILL_NOT_VOIDABLE: '발송 전 송장만 무효화할 수 있어요.',
  WAYBILL_TRACKING_EXISTS: '이미 등록된 송장번호예요.',
  WAYBILL_TRANSIENT_CAP_EXCEEDED:
    '한진이 계속 거절해 발급을 멈췄어요. 잠시 뒤 다시 발급하세요.',
};

export function waybillErrorMessage(error: unknown, fallback: string): string {
  const { message } = parseServerError(error, fallback);
  const match = WAYBILL_CODE.exec(message.trim());
  const copy = match ? COPY[match[1]] : undefined;
  if (copy === undefined) return getServerDenyMessage(error, fallback);
  return typeof copy === 'function' ? copy(match?.[2] ?? '') : copy;
}
