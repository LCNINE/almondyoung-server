import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/** physical·consignment SKU 에 배송 프로필이 없다. 전역 필터가 코드를 응답 `error` 로 내보낸다. */
export class SkuDeliveryProfileRequiredError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_DELIVERY_PROFILE_REQUIRED';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/** 존재하지 않는 배송 프로필 id. 검사하지 않으면 FK 위반이 500 으로 샌다. */
export class SkuDeliveryProfileNotFoundError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_DELIVERY_PROFILE_NOT_FOUND';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/** drop_shipped SKU 에 직배 공급사 연결이 정확히 하나가 아니다(K3 §4.2). 주문이 오면 이 연결로 입점사를 정한다. */
export class SkuDirectSupplierRequiredError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_DIRECT_SUPPLIER_REQUIRED';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}

/** 존재하지 않는 공급사 id. 검사하지 않으면 FK 위반이 500 으로 샌다. */
export class SkuSupplierNotFoundError extends ApplicationException {
  getErrorCode(): string {
    return 'SKU_SUPPLIER_NOT_FOUND';
  }
  getHttpStatus(): number {
    return HttpStatus.BAD_REQUEST;
  }
}
