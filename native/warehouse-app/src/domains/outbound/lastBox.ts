import type { DevicePrefs } from '../../core/data/devicePrefs';
import type { ShipmentByWaybill } from './types';

const KEY = 'almondwms.outbound.lastBox';

/** 마지막으로 열었던 박스. 교차 배치 work item 조회 API 가 없어 기기에 남긴다. */
export function readLastBox(prefs: DevicePrefs): ShipmentByWaybill | null {
  const raw = prefs.get(KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as ShipmentByWaybill;
    return typeof parsed?.shipmentId === 'string' ? parsed : null;
  } catch {
    // 깨진 값 하나가 화면을 못 띄우게 하면 안 된다 — 없는 것으로 취급한다.
    return null;
  }
}

export function writeLastBox(prefs: DevicePrefs, shipment: ShipmentByWaybill): void {
  prefs.set(KEY, JSON.stringify(shipment));
}

export function clearLastBox(prefs: DevicePrefs): void {
  prefs.remove(KEY);
}
