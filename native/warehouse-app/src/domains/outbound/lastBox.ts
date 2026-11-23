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

const BATCH_KEY = 'almondwms.outbound.lastBatch';

/**
 * 이 기기가 배치 현황에서 마지막으로 시작·인쇄한 배치 — 출고 검수가 송장을 찍기 전에도 지금 배치를 보이게.
 * 시작만 하고 아직 아무 박스도 찍지 않은 배치는 진행 중 목록에 없어 번호·이름도 함께 남긴다
 */
export interface LastBatch {
  id: string;
  batchNumber: string;
  name: string | null;
}

export function readLastBatch(prefs: DevicePrefs): LastBatch | null {
  const raw = prefs.get(BATCH_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastBatch>;
    if (typeof parsed?.id !== 'string' || typeof parsed.batchNumber !== 'string') return null;
    return { id: parsed.id, batchNumber: parsed.batchNumber, name: typeof parsed.name === 'string' ? parsed.name : null };
  } catch {
    return null;
  }
}

export function writeLastBatch(prefs: DevicePrefs, batch: LastBatch): void {
  prefs.set(BATCH_KEY, JSON.stringify(batch));
}
