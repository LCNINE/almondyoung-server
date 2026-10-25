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
