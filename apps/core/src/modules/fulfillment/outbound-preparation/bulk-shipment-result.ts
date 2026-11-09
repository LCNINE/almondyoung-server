import { ApplicationException } from '@app/shared';
import type { BatchResultItem } from '../waybill/waybill.types';
import { HttpException } from '@nestjs/common';

export interface PreparationWaybillResult extends BatchResultItem {
  transient?: boolean;
  code?: string;
}

export interface BulkShipmentFailure {
  shipmentId: string;
  code: string;
  message: string;
  transient: boolean;
}

export interface BulkShipmentResult {
  succeeded: string[];
  failed: BulkShipmentFailure[];
}

const messages = new Map([
  ['SHIPMENT_NOT_FOUND', '상자를 찾을 수 없어요'],
  ['WAYBILL_NEEDS_REVIEW', '멈춘 송장이 있어요 — 상자 보기에서 중단하고 다시 발급해요'],
  ['WAYBILL_ISSUE_RACED', '다른 송장 발급과 겹쳤어요'],
  ['SHIPMENT_NOT_DRAFT', '상자 상태가 바뀌었어요'],
  ['SHIPMENT_NOT_FULLY_RESERVED', '재고 예약이 모자라요'],
  ['SHIPMENT_PROFILE_INCOMPATIBLE', '배송 프로필을 정할 수 없어요'],
  ['SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE', '배송 프로필 설정이 비어 있어요'],
  ['SHIPMENT_ACTIVE_WORK_ITEM', '이미 다른 배치에 들어 있어요'],
]);

// 도메인 예외는 종류별 코드(CONFLICT 등)만 가지므로 waybill 모듈처럼 메시지 앞 `CODE:` 로 세부 코드를 싣는다.
// 다시 쓰는 단건 명령들(계획 확정·배치 담기)은 `HttpException({ code })` 로 던지므로 그 모양도 읽는다.
const MESSAGE_CODE = /^([A-Z][A-Z0-9_]*):/;

function errorCode(e: unknown): string {
  if (e instanceof ApplicationException) {
    return MESSAGE_CODE.exec(e.message)?.[1] ?? e.getErrorCode();
  }

  const response = e instanceof HttpException ? e.getResponse() : undefined;

  return typeof response === 'object' && response !== null && 'code' in response && typeof response.code === 'string'
    ? response.code
    : 'UNKNOWN';
}

export function isTransientError(e: unknown): boolean {
  if (e instanceof ApplicationException) {
    return e.getHttpStatus() >= 500;
  }

  if (!(e instanceof HttpException) || errorCode(e) === 'FULFILLMENT_COMMAND_IN_PROGRESS') {
    return true;
  }

  return e.getStatus() < 400 || e.getStatus() >= 500;
}

export function bulkShipmentFailure(shipmentId: string, error: unknown): BulkShipmentFailure {
  const code = errorCode(error);

  return {
    shipmentId,
    code,
    message: messages.get(code) ?? '처리하지 못했어요',
    transient: isTransientError(error),
  };
}

export async function runPerShipment(
  shipmentIds: string[],
  run: (shipmentId: string) => Promise<'done' | 'already'>,
): Promise<BulkShipmentResult> {
  const result: BulkShipmentResult = { succeeded: [], failed: [] };

  for (const shipmentId of shipmentIds) {
    try {
      await run(shipmentId);
      result.succeeded.push(shipmentId);
    } catch (error) {
      result.failed.push(bulkShipmentFailure(shipmentId, error));
    }
  }

  return result;
}
