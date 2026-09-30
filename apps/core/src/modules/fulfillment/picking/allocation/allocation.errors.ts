import type { StartBlockerView } from './allocation.types';
import type { AllocationDecrement } from './reconcile-allocation';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Canonical: `discrete` (byte-identical to `pick_to_tote`). */
export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
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

/** PR 2: 집은 몫이 있는 박스의 이탈 거절(PR 3 이 되돌림으로 연다). errors = 줄·로케이션·수량. */
export function boxHasPickedItems(shipmentId: string, items: AllocationDecrement[]): ConflictException {
  return new ConflictException({
    code: 'BOX_HAS_PICKED_ITEMS',
    message: `Shipment ${shipmentId} has picked items; they must be returned before it can leave the batch`,
    errors: items,
  });
}
