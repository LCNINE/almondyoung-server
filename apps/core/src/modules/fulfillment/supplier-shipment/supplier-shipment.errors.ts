import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/** 입점사 상자가 지금 이 명령을 받을 수 없다(넘기지 않음·창고 상자·회수 중·이미 발송·활성 송장 있음). 409. */
export class SupplierShipmentNotShippableError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_SHIPMENT_NOT_SHIPPABLE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 그 송장번호의 살아 있는 송장이 이미 다른 상자에 있다(`uq_waybills_tracking_live`). 409. */
export class SupplierTrackingInUseError extends ApplicationException {
  getErrorCode(): string {
    return 'TRACKING_IN_USE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 나누기·합포장 대상이 아니다(입점사 상자가 아님·draft 아님·회수 중·라인이 그 상자 것이 아님). 409. */
export class SupplierShipmentNotEditableError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_SHIPMENT_NOT_EDITABLE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 합포장할 상자들의 수령인이 정규화 뒤에도 다르다(또는 정규화할 수 없다). 409. */
export class SupplierMergeRecipientMismatchError extends ApplicationException {
  getErrorCode(): string {
    return 'MERGE_RECIPIENT_MISMATCH';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 발송된(또는 입점사가 아닌) 상자의 라인에는 «못 보냄»을 기록할 수 없다. 409. */
export class SupplierReasonOnShippedError extends ApplicationException {
  getErrorCode(): string {
    return 'REASON_ON_SHIPPED';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 넘길 상자가 없다(넘기지 않은 정상 상자가 0). 409. */
export class SupplierHandoffEmptyError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_HANDOFF_EMPTY';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 넘길 상자가 있지만 전부 수령인 정보가 불완전하다. 409 — 메시지에 상자 id 들이 있다. */
export class SupplierHandoffRecipientIncompleteError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_HANDOFF_RECIPIENT_INCOMPLETE';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 올린 직배 시트에 읽어야 할 머리글이 없다. 400 — 메시지와 `missingHeaders` 에 빠진 머리글 이름들이 있다. */
export class SupplierSheetHeaderMissingError extends ApplicationException {
  constructor(readonly missingHeaders: readonly string[]) {
    super(`직배 시트에 머리글이 없습니다: ${missingHeaders.join(', ')}`);
  }
  getErrorCode(): string {
    return 'SUPPLIER_SHEET_HEADER_MISSING';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/** 올린 직배 시트의 줄이 상한을 넘는다. 400. */
export class SupplierSheetTooManyRowsError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_SHEET_TOO_MANY_ROWS';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}
