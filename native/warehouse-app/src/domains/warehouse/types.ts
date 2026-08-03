/** WarehouseDto 중 현장에서 쓰는 필드만. */
export interface Warehouse {
  id: string;
  name: string;
  location: string | null;
}

/** BaseLocationResponseDto 중 현장에서 쓰는 필드만. */
export interface LocationItem {
  id: string;
  code: string;
  displayName: string;
}
