import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/**
 * 직배 SKU 가 이 공급사에 묶여 있다(K3 §4.2). «직배 아님»으로 바꾸거나 지우면 그 SKU 의 주문이 갈 입점사가 사라진다 —
 * 삭제는 `sku_suppliers` 가 cascade 라 연결이 조용히 지워진다.
 */
export class SupplierHasDropShippedSkusError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_HAS_DROP_SHIPPED_SKUS';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

/** 이 입점사의 상자·넘김 묶음·알릴 취소가 있다(K3). FK 가 restrict 라 세지 않고 지우면 설명 없는 500 이 된다. */
export class SupplierHasShipmentsError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_HAS_SHIPMENTS';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}
