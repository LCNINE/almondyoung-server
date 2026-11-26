import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/** 공급처에 맡길 수 있는 창고 상자가 아니다(작성 중 창고 상자가 아님·회수 중·직배 상품이 든 상자). 409. */
export class DirectDeliveryNotEligibleError extends ApplicationException {
  getErrorCode(): string {
    return 'DIRECT_DELIVERY_NOT_ELIGIBLE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 창을 연 뒤 상자 구성이 바뀌었다 — 새로 읽고 다시 고른다. 409. */
export class DirectDeliveryChangedError extends ApplicationException {
  getErrorCode(): string {
    return 'DIRECT_DELIVERY_CHANGED';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 셀메이트로 넘긴 주문이라 셀메이트가 보낸다 — 공급처에도 맡기면 두 번 나간다. 409. */
export class DirectDeliverySellmateHandedOverError extends ApplicationException {
  getErrorCode(): string {
    return 'DIRECT_DELIVERY_SELLMATE_HANDED_OVER';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 받는 분 이름·연락처·주소가 다 있어야 공급처가 보낼 수 있다. 409. */
export class DirectDeliveryRecipientIncompleteError extends ApplicationException {
  getErrorCode(): string {
    return 'DIRECT_DELIVERY_RECIPIENT_INCOMPLETE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 창고 출고로 되돌릴 수 있는 공급처 상자가 아니다(발송됨·송장 있음·회수 중·직배 상품·창고 없는 주문). 409. */
export class DirectDeliveryReturnNotEligibleError extends ApplicationException {
  getErrorCode(): string {
    return 'DIRECT_DELIVERY_RETURN_NOT_ELIGIBLE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}
