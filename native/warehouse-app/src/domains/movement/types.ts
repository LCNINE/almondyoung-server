/** GET /inventory/stocks/location/:locationId 의 items[] 한 행. */
export interface LocationContentItem {
  skuId: string;
  skuCode: string;
  skuName: string;
  /** ON_HAND | DEFECTIVE | IN_TRANSFER. 이동 대상은 ON_HAND 뿐이다. */
  stockState: string;
  quantity: number;
}

/** GET /inventory/stocks/location/:locationId 응답. */
export interface LocationContents {
  locationId: string;
  locationCode: string;
  warehouseId: string;
  items: LocationContentItem[];
}

/** MovementScreen → useMoveStock 입력. 라인 1개 MoveBatchDto 로 조립된다. */
export interface MoveInput {
  warehouseId: string;
  skuId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  /** 선택 사유. MoveLineDto.memo 로 전달된다. */
  reason?: string;
  /** (c) 시트 진입 시 1회 생성, 재시도에 재사용. */
  idempotencyKey: string;
}
