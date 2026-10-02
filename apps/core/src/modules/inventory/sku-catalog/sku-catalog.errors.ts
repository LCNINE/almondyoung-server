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
