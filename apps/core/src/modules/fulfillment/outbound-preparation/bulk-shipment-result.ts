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
  ['WAYBILL_ISSUE_IN_PROGRESS', '진행 중인 송장 발급 결과를 확인해 주세요'],
  ['SHIPMENT_NOT_DRAFT', '상자 상태가 바뀌었어요'],
  ['SHIPMENT_NOT_FULLY_RESERVED', '재고 예약이 모자라요'],
  ['SHIPMENT_PROFILE_INCOMPATIBLE', '배송 프로필을 정할 수 없어요'],
  ['SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE', '배송 프로필 설정이 비어 있어요'],
  ['SHIPMENT_ACTIVE_WORK_ITEM', '이미 다른 배치에 들어 있어요'],
]);

function errorCode(e: unknown): string {
  if (e instanceof ApplicationException) {
    return e.getErrorCode();
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
