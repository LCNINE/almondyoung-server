import type { StartBlockerView } from './allocation.types';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Canonical: `discrete` (byte-identical to `pick_to_tote`). */
export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/** 빠지는(withdrawing)·빠진(excluded) 박스의 전진 명령(스펙 §12). 앱은 «빠진 박스 · 송장은 버리세요» 로 안내한다. */
export function shipmentWithdrawn(shipmentId: string): ConflictException {
  return new ConflictException({
    code: 'SHIPMENT_WITHDRAWN',
    message: `Shipment ${shipmentId} is leaving (or has left) its batch; forward work is not accepted`,
  });
}

/**
 * Errors batch preparation treats as a business rejection (a durable `preparation_blocked` marker)
 * rather than "the request blew up". Anything else propagates untouched.
 */
export function isPlanValidationError(
  error: unknown,
): error is BadRequestException | ConflictException | NotFoundException {
  return (
    error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
  );
}

/**
 * 시작 거절 — 아무것도 쓰지 않았다. `errors` 는 전역 필터가 응답 본문에 그대로 싣는 필드다(`details` 는
 * 준비 차단 전용 허용 목록이라 쓰지 않는다).
 */
export function startBlocked(batchId: string, blockers: StartBlockerView[]): ConflictException {
  return new ConflictException({
    code: 'BATCH_START_BLOCKED',
    message: `Batch ${batchId} cannot start: ${blockers.length} blocker(s)`,
    errors: blockers,
  });
}

/** 합류 거절 — 아무것도 쓰지 않았다. 모양은 시작 거절과 같다(사유 표 스펙 §6). */
export function joinBlocked(shipmentId: string, blockers: StartBlockerView[]): ConflictException {
  return new ConflictException({
    code: 'BATCH_JOIN_BLOCKED',
    message: `Shipment ${shipmentId} cannot join the running batch: ${blockers.length} blocker(s)`,
    errors: blockers,
  });
}
