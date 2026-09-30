import type { DevicePrefs } from '../../core/data/devicePrefs';

export const RETURN_BIN_KEY = 'almondwms.returnBin';
const RETURN_BIN_CODE = /^RB-[A-Za-z0-9._-]{1,125}$/;

/** 되돌림 바구니 바코드 — `RB-` 접두어(서버 `ck_return_bins_barcode_prefix`). 토트·상품·로케이션과 섞이지 않는다. */
export function isReturnBinCode(code: string): boolean {
  return RETURN_BIN_CODE.test(code.trim());
}

/**
 * 이 기기(PC)의 «내 되돌림 바구니»(스펙 §8 — 송장 프린터처럼 기기별 설정). 바구니는 창고에 매이므로 창고와 같이 적고,
 * 지금 창고의 것일 때만 돌려준다 — 창고를 바꾼 PC 가 다른 창고의 바구니로 빼면 서버가 거절한다.
 */
export function readReturnBin(prefs: DevicePrefs, warehouseId: string | null): string | null {
  const raw = prefs.get(RETURN_BIN_KEY);
  if (!raw || !warehouseId) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'warehouseId' in value &&
      'barcode' in value &&
      value.warehouseId === warehouseId &&
      typeof value.barcode === 'string' &&
      isReturnBinCode(value.barcode)
    )
      return value.barcode;
  } catch {
    // 깨진 값은 없는 것으로 본다.
  }
  return null;
}

export function writeReturnBin(prefs: DevicePrefs, value: { warehouseId: string; barcode: string } | null): void {
  if (!value) prefs.remove(RETURN_BIN_KEY);
  else prefs.set(RETURN_BIN_KEY, JSON.stringify({ warehouseId: value.warehouseId, barcode: value.barcode.trim() }));
}
